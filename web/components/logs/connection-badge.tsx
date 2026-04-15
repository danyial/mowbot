"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLogsStore } from "@/lib/store/logs-store";

// Phase 6 / Plan 03 — Connection state badge per UI-SPEC.md state table.
// live = bg-primary dot "Live"; reconnecting = bg-amber-500 + Loader2 "Verbinde…";
// stopped = bg-destructive "Gestoppt". Hidden in idle state.

const LABELS: Record<"live" | "reconnecting" | "stopped", string> = {
  live: "Live",
  reconnecting: "Verbinde…",
  stopped: "Gestoppt",
};

const ARIA_LABELS: Record<"live" | "reconnecting" | "stopped", string> = {
  live: "Verbindung live",
  reconnecting: "Verbindung wird aufgebaut",
  stopped: "Verbindung gestoppt",
};

export function ConnectionBadge() {
  const state = useLogsStore((s) => s.connectionState);
  if (state === "idle") return null;

  const dotClass =
    state === "live"
      ? "bg-primary"
      : state === "reconnecting"
        ? "bg-amber-500 animate-pulse"
        : "bg-destructive";

  return (
    <span
      role="status"
      aria-label={ARIA_LABELS[state]}
      className="inline-flex h-6 items-center gap-1.5 rounded-full bg-secondary px-2 text-xs font-semibold"
    >
      <span className={cn("h-2 w-2 rounded-full", dotClass)} aria-hidden="true" />
      {state === "reconnecting" && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      )}
      <span>{LABELS[state]}</span>
    </span>
  );
}
