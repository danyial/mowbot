import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

// Load .env.local before reading env vars
loadEnvConfig(process.cwd());

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const ROSBRIDGE_URL = process.env.ROSBRIDGE_URL || "ws://mower.local:9090";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/**
 * Replace NaN literals in JSON strings with null.
 * rosbridge sends NaN for GPS fields without a fix,
 * but NaN is not valid JSON and causes JSON.parse errors in roslib.
 */
function sanitizeNaN(data) {
  if (typeof data === "string") {
    return data.replace(/:\s*NaN\b/g, ": null").replace(/,\s*NaN\b/g, ", null").replace(/\[\s*NaN\b/g, "[ null");
  }
  // Binary message — convert to string, sanitize, return as string
  const str = data.toString("utf-8");
  if (str.includes("NaN")) {
    return str.replace(/:\s*NaN\b/g, ": null").replace(/,\s*NaN\b/g, ", null").replace(/\[\s*NaN\b/g, "[ null");
  }
  return str;
}

// Prevent uncaught errors from crashing the server
process.on("uncaughtException", (err) => {
  if (
    err.code === "ECONNRESET" ||
    err.code === "EPIPE" ||
    err.code === "ECONNREFUSED"
  ) {
    console.error(`[rosbridge-proxy] ${err.code}: ${err.message}`);
    return;
  }
  console.error("Uncaught exception:", err);
  process.exit(1);
});

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const pathname = (req.url || "").split("?")[0];

    // Don't let Next.js handle /rosbridge
    if (pathname === "/rosbridge") {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("WebSocket connections only");
      return;
    }

    handle(req, res, parse(req.url || "", true));
  });

  server.on("upgrade", (req, socket, head) => {
    const pathname = (req.url || "").split("?")[0];

    socket.on("error", (err) => {
      console.error(`[ws] Socket error on ${pathname}: ${err.message}`);
    });

    if (pathname === "/rosbridge") {
      // Manual WebSocket proxy with NaN sanitization
      // Accept the client connection
      const wss = new WebSocketServer({ noServer: true });

      wss.handleUpgrade(req, socket, head, (clientWs) => {
        // Open a connection to the real rosbridge server
        const rosbridgeWs = new WebSocket(ROSBRIDGE_URL);

        rosbridgeWs.on("open", () => {
          console.log("[rosbridge-proxy] Connected to rosbridge");
        });

        // rosbridge -> client
        //   - text frames: sanitize NaN (existing behavior for uninitialized GPS fields)
        //   - binary frames (CBOR): pass through untouched to preserve byte stream
        //     Per ws 8.x: `isBinary` is the second arg to the "message" event.
        //     Required for Phase 3 CBOR retrofit (D-06); see 03-RESEARCH.md §P2.
        rosbridgeWs.on("message", (data, isBinary) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          if (isBinary) {
            clientWs.send(data, { binary: true });
          } else {
            clientWs.send(sanitizeNaN(data));
          }
        });

        // client -> rosbridge (pass through)
        clientWs.on("message", (data) => {
          if (rosbridgeWs.readyState === WebSocket.OPEN) {
            rosbridgeWs.send(data);
          }
        });

        // Cleanup on close
        clientWs.on("close", () => {
          console.log("[rosbridge-proxy] Client disconnected");
          if (rosbridgeWs.readyState === WebSocket.OPEN || rosbridgeWs.readyState === WebSocket.CONNECTING) {
            rosbridgeWs.close();
          }
        });

        rosbridgeWs.on("close", () => {
          console.log("[rosbridge-proxy] rosbridge connection closed");
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
          }
        });

        // Error handling
        clientWs.on("error", (err) => {
          console.error(`[rosbridge-proxy] Client WS error: ${err.message}`);
        });

        rosbridgeWs.on("error", (err) => {
          console.error(`[rosbridge-proxy] rosbridge WS error: ${err.message}`);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
          }
        });
      });
    } else if (pathname.startsWith("/logs/stream/")) {
      // Phase 6 — per-container live log stream.
      // Path: /logs/stream/<id>?since=<preset>&tail=<int>
      //
      // Security / correctness boundaries:
      //   - id must be in the current listContainers() allowlist (T-06-04)
      //   - since must be in the preset allowlist (T-06-04)
      //   - tail clamped to [0, 5000]
      //   - Non-TTY containers are demuxed via container.modem (T-06-03)
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const id = pathname.slice("/logs/stream/".length);
      const since = url.searchParams.get("since") || "";
      const tailRaw = parseInt(url.searchParams.get("tail") || "200", 10);
      const tail = Math.max(0, Math.min(Number.isFinite(tailRaw) ? tailRaw : 200, 5000));

      const ALLOWED_PRESETS = new Set(["", "1m", "5m", "15m", "1h", "6h", "24h"]);
      if (!ALLOWED_PRESETS.has(since)) {
        socket.destroy();
        return;
      }

      const wss = new WebSocketServer({ noServer: true });
      wss.handleUpgrade(req, socket, head, async (clientWs) => {
        console.log("[logs-stream] Client connected to", id);
        let raw;
        let stdoutPT;
        let stderrPT;

        try {
          const { listContainers, getContainer } = await import("./lib/server/docker-adapter.mjs");
          const { parseSincePreset } = await import("./lib/server/since-preset.mjs");

          // id allowlist: must be present in the current compose project
          const known = await listContainers();
          if (!known.some((c) => c.id === id || id.startsWith(c.id) || c.id.startsWith(id.slice(0, 12)))) {
            console.error("[logs-stream] unknown container:", id);
            clientWs.close(1008, "unknown container");
            return;
          }

          const container = getContainer(id);
          const info = await container.inspect();

          const opts = {
            follow: true,
            stdout: true,
            stderr: true,
            tail,
            timestamps: true,
            ...(since ? { since: parseSincePreset(since) } : {}),
          };
          raw = await container.logs(opts);

          const { PassThrough } = await import("node:stream");
          stdoutPT = new PassThrough();
          stderrPT = new PassThrough();

          const emit = (streamName) => {
            let buf = "";
            return (chunk) => {
              buf += chunk.toString("utf8");
              let nl;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const lineRaw = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                // Docker timestamp prefix: "<RFC3339> <line>"
                const sp = lineRaw.indexOf(" ");
                const tsStr = sp > 0 ? lineRaw.slice(0, sp) : "";
                const line = sp > 0 ? lineRaw.slice(sp + 1) : lineRaw;
                const parsed = tsStr ? Date.parse(tsStr) : NaN;
                const ts = Number.isFinite(parsed) ? parsed : Date.now();
                if (clientWs.readyState === clientWs.OPEN) {
                  clientWs.send(JSON.stringify({ ts, stream: streamName, line }));
                }
              }
            };
          };
          stdoutPT.on("data", emit("stdout"));
          stderrPT.on("data", emit("stderr"));

          if (info && info.Config && info.Config.Tty === false) {
            // Non-TTY container (every ROS2 container here) — strip Docker's
            // 8-byte stream-header framing before forwarding.
            container.modem.demuxStream(raw, stdoutPT, stderrPT);
          } else {
            raw.pipe(stdoutPT);
          }

          raw.on("error", (e) => {
            console.error("[logs-stream] upstream error:", e && e.message);
            if (clientWs.readyState === clientWs.OPEN) clientWs.close(1011);
          });
          raw.on("end", () => {
            if (clientWs.readyState === clientWs.OPEN) clientWs.close(1000);
          });
        } catch (err) {
          console.error("[logs-stream] setup error:", err && err.message);
          if (clientWs.readyState === clientWs.OPEN) clientWs.close(1011);
        }

        clientWs.on("close", () => {
          console.log("[logs-stream] Client disconnected from", id);
          try { raw && raw.destroy && raw.destroy(); } catch {}
          try { stdoutPT && stdoutPT.destroy(); } catch {}
          try { stderrPT && stderrPT.destroy(); } catch {}
        });

        clientWs.on("error", (err) => {
          console.error("[logs-stream] client WS error:", err && err.message);
        });
      });
    } else {
      // Let Next.js handle HMR WebSocket upgrades
      const upgradeHandler = app.getUpgradeHandler();
      if (upgradeHandler) {
        upgradeHandler(req, socket, head);
      } else {
        socket.destroy();
      }
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> MowerControl ready on http://${hostname}:${port}`);
    console.log(`> rosbridge proxy: /rosbridge -> ${ROSBRIDGE_URL}`);
    console.log(`> NaN sanitization: enabled`);
    console.log(`> Mode: ${dev ? "development" : "production"}`);
  });
});
