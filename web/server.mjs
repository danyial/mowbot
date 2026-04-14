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
