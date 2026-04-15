"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLogsStore } from "@/lib/store/logs-store";
import type { ContainerSummary } from "@/lib/types/logs";

// Phase 6 / Plan 03 — Left-pane container list.
//
// CONTRACT (enforced by acceptance-criteria greps):
//   - Initial hydrate: ONE-SHOT GET /api/logs/containers.
//   - Live updates: EventSource("/api/logs/events") — NO polling timers.
//   - On `container` events mutate the in-memory map; `start` triggers a cheap
//     re-hydrate (one fetch) so we pick up full ContainerSummary for the new id.
//   - Cleanup in effect teardown: es.close() + abort in-flight hydrate fetch.

type EventsHealth = "live" | "reconnecting" | "stopped";

interface ContainerEventMsg {
  id: string;
  action: "start" | "die" | "destroy";
  name?: string;
}

export function ContainerList() {
  const [containers, setContainers] = useState<Map<string, ContainerSummary>>(
    () => new Map()
  );
  const [hydrateError, setHydrateError] = useState<boolean>(false);
  const [eventsHealth, setEventsHealth] = useState<EventsHealth>("reconnecting");
  const selectedId = useLogsStore((s) => s.selectedContainerId);
  const selectContainer = useLogsStore((s) => s.selectContainer);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function hydrate() {
      try {
        const res = await fetch("/api/logs/containers", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          if (!cancelled) setHydrateError(true);
          return;
        }
        const data: ContainerSummary[] = await res.json();
        if (cancelled) return;
        const next = new Map<string, ContainerSummary>();
        for (const c of data) next.set(c.id, c);
        setContainers(next);
        setHydrateError(false);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        if (!cancelled) setHydrateError(true);
      }
    }

    hydrate();

    // NOTE: No polling timers. EventSource-only live refresh.
    const es = new EventSource("/api/logs/events");

    const onHello = () => setEventsHealth("live");
    const onResumed = () => {
      setEventsHealth("live");
      // Re-hydrate so we pick up any state change we missed during the outage.
      hydrate();
    };
    const onReconnecting = () => setEventsHealth("reconnecting");
    const onErrorEvt = () => setEventsHealth("stopped");

    const onContainer = (ev: MessageEvent) => {
      let msg: ContainerEventMsg;
      try {
        msg = JSON.parse(ev.data) as ContainerEventMsg;
      } catch {
        return;
      }
      if (!msg?.id || !msg?.action) return;

      setContainers((prev) => {
        const next = new Map(prev);
        if (msg.action === "destroy") {
          next.delete(msg.id);
          return next;
        }
        if (msg.action === "die") {
          const existing = next.get(msg.id);
          if (existing) {
            next.set(msg.id, { ...existing, state: "exited" });
          }
          return next;
        }
        if (msg.action === "start") {
          const existing = next.get(msg.id);
          if (existing) {
            next.set(msg.id, { ...existing, state: "running" });
          } else if (msg.name) {
            next.set(msg.id, {
              id: msg.id,
              name: msg.name,
              image: "",
              state: "running",
            });
          }
          // Defer fetch outside of setState.
          queueMicrotask(() => hydrate());
          return next;
        }
        return next;
      });
    };

    es.addEventListener("hello", onHello);
    es.addEventListener("resumed", onResumed);
    es.addEventListener("reconnecting", onReconnecting);
    es.addEventListener("error", onErrorEvt as EventListener);
    es.addEventListener("container", onContainer as EventListener);

    return () => {
      cancelled = true;
      controller.abort();
      es.close();
    };
  }, []);

  const rows = Array.from(containers.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const healthDotClass =
    eventsHealth === "live"
      ? "bg-primary"
      : eventsHealth === "reconnecting"
        ? "bg-amber-500"
        : "bg-destructive";

  return (
    <div className="flex h-full w-full flex-col bg-card border-r border-border">
      {/* Header */}
      <div className="flex h-14 items-center justify-between px-4 border-b border-border">
        <span className="text-sm font-semibold">Container</span>
        <span
          className={cn("h-2 w-2 rounded-full", healthDotClass)}
          aria-hidden="true"
        />
      </div>

      {/* Body */}
      {hydrateError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm font-semibold text-destructive">
            Docker nicht erreichbar
          </p>
          <p className="text-xs text-muted-foreground">
            Der Docker-Daemon antwortet nicht. Neuer Versuch läuft…
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Keine Container gefunden
          </p>
          <p className="text-xs text-muted-foreground">
            Docker-Compose läuft nicht oder kein{" "}
            <code className="font-mono">mowerbot</code>-Projekt aktiv.
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {rows.map((c) => {
            const isActive = selectedId === c.id;
            const isRunning = c.state === "running";
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => selectContainer(c.id)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-accent/50",
                    !isRunning && "opacity-60"
                  )}
                  aria-pressed={isActive}
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      isRunning ? "bg-primary" : "bg-muted-foreground"
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.image || "—"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
