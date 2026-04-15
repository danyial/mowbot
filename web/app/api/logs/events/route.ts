import { NextResponse } from "next/server";
import { getEvents } from "@/lib/server/docker-adapter.mjs";

export const dynamic = "force-dynamic";

const INITIAL_RECONNECT_DELAY = 500;
const MAX_RECONNECT_DELAY = 5000;

/**
 * SSE channel pushing Docker container lifecycle events (start | die |
 * destroy) filtered to the mower Compose project. Replaces client-side
 * polling entirely (CONTEXT.md §Container set & refresh — "no polling
 * fallback").
 *
 * Frames emitted:
 *   event: hello        — on handshake
 *   event: container    — {id, action, name}
 *   event: reconnecting — backoff running
 *   event: resumed      — events stream re-established
 *   event: error        — docker.sock unreachable on (re)connect
 */
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  const send = (
    controller: ReadableStreamDefaultController,
    event: string,
    data: unknown
  ) => {
    controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    );
  };

  const stream = new ReadableStream({
    async start(controller) {
      let rawStream: NodeJS.ReadableStream | null = null;
      let backoff = INITIAL_RECONNECT_DELAY;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let closed = false;

      const cleanup = () => {
        closed = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rawStream as any)?.removeAllListeners?.();
        } catch {}
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rawStream as any)?.destroy?.();
        } catch {}
        try {
          controller.close();
        } catch {}
      };

      req.signal.addEventListener("abort", cleanup);

      send(controller, "hello", { ok: true });

      const connect = async (): Promise<void> => {
        if (closed) return;
        try {
          rawStream = (await getEvents()) as unknown as NodeJS.ReadableStream;
          backoff = INITIAL_RECONNECT_DELAY;
          send(controller, "resumed", {});

          rawStream.on("data", (chunk: Buffer) => {
            try {
              const evt = JSON.parse(chunk.toString("utf8"));
              if (
                evt?.Type === "container" &&
                ["start", "die", "destroy"].includes(evt?.Action)
              ) {
                send(controller, "container", {
                  id: String(evt.id || "").slice(0, 12),
                  action: evt.Action,
                  name:
                    (evt.Actor?.Attributes?.name as string | undefined) || "",
                });
              }
            } catch {
              /* partial/invalid frame — ignore */
            }
          });

          const onClose = () => {
            if (closed) return;
            send(controller, "reconnecting", {});
            reconnectTimer = setTimeout(connect, backoff);
            backoff = Math.min(backoff * 2, MAX_RECONNECT_DELAY);
          };
          rawStream.on("close", onClose);
          rawStream.on("error", (e: Error) => {
            console.error("[logs/events] stream error:", e.message);
            onClose();
          });
        } catch (err) {
          console.error("[logs/events] connect error:", err);
          send(controller, "error", { error: "Docker nicht erreichbar" });
          if (!closed) {
            reconnectTimer = setTimeout(connect, backoff);
            backoff = Math.min(backoff * 2, MAX_RECONNECT_DELAY);
          }
        }
      };

      connect();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
