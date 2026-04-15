"use client";

import { create } from "zustand";
import type { SincePreset } from "@/lib/types/logs";

// Phase 6 / Plan 03. Analog: scan-store.ts (latest-only, no storage layer,
// no timers, no buffer-in-store). The 10k log-line ring buffer lives in a
// useRef<string[]> inside <LogViewer> so the store doesn't re-render at
// 100 lines/s. This store only holds operator selection + derived UI state.

type ConnectionState = "idle" | "live" | "reconnecting" | "stopped";

interface LogsState {
  selectedContainerId: string | null;
  sincePreset: SincePreset | null;
  connectionState: ConnectionState;

  selectContainer: (id: string | null) => void;
  setSincePreset: (p: SincePreset | null) => void;
  setConnectionState: (s: ConnectionState) => void;
}

export const useLogsStore = create<LogsState>((set) => ({
  selectedContainerId: null,
  sincePreset: null,
  connectionState: "idle",
  selectContainer: (id) => set({ selectedContainerId: id }),
  setSincePreset: (p) => set({ sincePreset: p }),
  setConnectionState: (s) => set({ connectionState: s }),
}));
