"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Convert from "ansi-to-html";
import { ArrowDown, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLogsStore } from "@/lib/store/logs-store";
import type { LogFrame } from "@/lib/types/logs";
import { ContainerList } from "@/components/logs/container-list";
import { SincePresetChips } from "@/components/logs/since-preset-chips";
import { ConnectionBadge } from "@/components/logs/connection-badge";

// Phase 6 / Plan 03 — Log viewer.
//
// Contract:
//   - WS URL: ws(s)://<host>/logs/stream/<id>?since=<preset>&tail=200
//   - Reconnect ladder: 500ms → 5000ms (matches ros-client.ts)
//   - ANSI render: ansi-to-html Convert instance with XML escaping on (T-06-04
//     XSS mitigation — HTML-escape BEFORE emitting color spans) and streaming
//     mode on (keeps palette state across chunks).
//   - Ring buffer: useRef<string[]> capped at 10000 lines (never in Zustand).
//   - Auto-scroll threshold: 24px from bottom (UI-SPEC §Performance).

const INITIAL_RECONNECT_DELAY = 500;
const MAX_RECONNECT_DELAY = 5000;
const MAX_LINES = 10000;
// Auto-scroll pause threshold (px from bottom); literal per UI-SPEC §Performance.

interface RenderedRow {
  /** Monotonic id for React key. */
  key: number;
  /** Pre-formatted HH:MM:SS.sss. */
  ts: string;
  /** HTML emitted by ansi-to-html (already XML-escaped). */
  html: string;
  /** true → stderr: rendered with destructive left border. */
  isStderr: boolean;
  /** true → synthetic system message (not from Docker). */
  isSystem: boolean;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const mss = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${mss}`;
}

interface LogViewerProps {
  className?: string;
}

export function LogViewer({ className }: LogViewerProps) {
  const selectedId = useLogsStore((s) => s.selectedContainerId);
  const sincePreset = useLogsStore((s) => s.sincePreset);
  const setConnectionState = useLogsStore((s) => s.setConnectionState);

  // Ring buffer lives in a ref so 100 lines/s doesn't trigger re-renders.
  const bufRef = useRef<RenderedRow[]>([]);
  const keyRef = useRef<number>(0);
  const [version, setVersion] = useState(0);
  const bumpVersion = () => setVersion((v) => v + 1);

  // Persistent ANSI converter. Recreated per container switch so palette
  // state doesn't bleed between streams.
  const ansiRef = useRef<Convert | null>(null);

  // Auto-scroll state.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef<boolean>(true);
  const [pillVisible, setPillVisible] = useState(false);

  // Mobile drawer open state.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const pushRow = (row: Omit<RenderedRow, "key">) => {
    const buf = bufRef.current;
    buf.push({ ...row, key: keyRef.current++ });
    if (buf.length > MAX_LINES) {
      buf.splice(0, buf.length - MAX_LINES);
    }
    bumpVersion();
  };

  const clearBuffer = () => {
    bufRef.current = [];
    bumpVersion();
  };

  const pushSystemRow = (line: string) => {
    pushRow({
      ts: "— —",
      html: line, // already plain text; we render via textContent path for system rows
      isStderr: false,
      isSystem: true,
    });
  };

  // WS lifecycle — re-runs whenever selectedId or sincePreset changes.
  useEffect(() => {
    if (!selectedId) {
      setConnectionState("idle");
      return;
    }

    clearBuffer();
    ansiRef.current = new Convert({ escapeXML: true, stream: true });

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = INITIAL_RECONNECT_DELAY;
    let disposed = false;
    let everOpened = false;

    const connect = () => {
      if (disposed) return;
      const protocol =
        window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        tail: "200",
        ...(sincePreset ? { since: sincePreset } : {}),
      });
      const url = `${protocol}//${window.location.host}/logs/stream/${encodeURIComponent(selectedId)}?${params.toString()}`;

      setConnectionState(everOpened ? "reconnecting" : "reconnecting");
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.addEventListener("open", () => {
        if (disposed) return;
        everOpened = true;
        delay = INITIAL_RECONNECT_DELAY;
        setConnectionState("live");
      });

      ws.addEventListener("message", (evt) => {
        if (disposed) return;
        let frame: LogFrame;
        try {
          frame = JSON.parse(evt.data as string) as LogFrame;
        } catch {
          return;
        }
        if (!ansiRef.current) return;
        const ts = formatTimestamp(frame.ts);
        const html = ansiRef.current.toHtml(frame.line);
        pushRow({
          ts,
          html,
          isStderr: frame.stream === "stderr",
          isSystem: false,
        });
      });

      ws.addEventListener("close", () => {
        if (disposed) return;
        setConnectionState("reconnecting");
        pushSystemRow("Verbindung getrennt, Wiederverbindung…");
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        if (disposed) return;
        // close event will follow; avoid double-pushing system row.
      });
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        delay = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        connect();
      }, delay);
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
      setConnectionState("idle");
    };
  }, [selectedId, sincePreset, setConnectionState]);

  // Auto-scroll effect — runs after each render that pushed a new row.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (autoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [version]);

  // Scroll listener — detect user scroll-up (pause) and scroll-to-bottom (resume).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
      autoScrollRef.current = atBottom;
      setPillVisible(!atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const resumeAutoScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    autoScrollRef.current = true;
    setPillVisible(false);
  };

  const rows = bufRef.current;

  const emptyState = useMemo(
    () => (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-base font-semibold">Kein Container ausgewählt</p>
        <p className="text-sm text-muted-foreground">
          Wähle links einen Container, um Logs zu sehen.
        </p>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="md:hidden mt-2 h-11 rounded-md bg-secondary px-4 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
        >
          Container öffnen
        </button>
      </div>
    ),
    []
  );

  return (
    <div
      className={cn(
        "grid h-full w-full grid-cols-1 md:grid-cols-[280px_1fr]",
        className
      )}
    >
      {/* Left pane: desktop */}
      <div className="hidden md:block h-full min-h-0">
        <ContainerList />
      </div>

      {/* Mobile drawer */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="md:hidden fixed inset-0 z-40 bg-background/80" />
          <Dialog.Content
            className="md:hidden fixed left-0 top-0 z-50 h-full w-[85vw] max-w-[320px] bg-card shadow-xl focus:outline-none"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">Container-Liste</Dialog.Title>
            <ContainerList />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Right pane */}
      <div className="flex h-full min-h-0 flex-col bg-background">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
          <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                aria-label="Container-Liste öffnen"
                className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent/50"
              >
                <Menu className="h-5 w-5" />
              </button>
            </Dialog.Trigger>
          </Dialog.Root>

          <span className="text-base font-semibold truncate max-w-[240px]">
            {selectedId ? selectedId.slice(0, 12) : "Logs"}
          </span>

          <ConnectionBadge />

          <SincePresetChips disabled={!selectedId} className="flex-wrap" />

          <div className="flex-1" />

          {pillVisible && (
            <button
              type="button"
              onClick={resumeAutoScroll}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary px-2 text-xs font-semibold text-primary hover:bg-primary/10"
            >
              <ArrowDown className="h-3 w-3" aria-hidden="true" />
              Neueste anzeigen
            </button>
          )}
        </div>

        {/* Stream scroller */}
        <div
          ref={scrollerRef}
          role="log"
          tabIndex={0}
          aria-live={autoScrollRef.current ? "polite" : undefined}
          className="flex-1 overflow-y-auto bg-background font-mono text-[13px] leading-[1.5] text-foreground focus:outline-none"
        >
          {!selectedId ? (
            emptyState
          ) : rows.length === 0 ? (
            <div className="px-4 py-1 italic text-muted-foreground">
              <span className="mr-4 tabular-nums select-none">— —</span>
              <span>Verbinde mit {selectedId.slice(0, 12)}…</span>
            </div>
          ) : (
            rows.map((row) => {
              if (row.isSystem) {
                return (
                  <div
                    key={row.key}
                    className="px-4 py-1 italic text-muted-foreground"
                  >
                    <span className="mr-4 tabular-nums select-none">{row.ts}</span>
                    <span>{row.html}</span>
                  </div>
                );
              }
              return (
                <div
                  key={row.key}
                  aria-label={row.isStderr ? "Fehlerausgabe" : undefined}
                  className={cn(
                    "py-1 whitespace-pre-wrap break-all",
                    row.isStderr
                      ? "border-l-2 border-destructive/60 pl-[14px] pr-4"
                      : "px-4"
                  )}
                >
                  <span className="mr-4 tabular-nums select-none text-muted-foreground">
                    {row.ts}
                  </span>
                  <span
                    className="text-foreground"
                    dangerouslySetInnerHTML={{ __html: row.html }}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
