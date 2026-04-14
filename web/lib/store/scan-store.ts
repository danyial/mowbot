"use client";

import { create } from "zustand";
import type { LaserScan } from "@/lib/types/ros-messages";

// Phase 3 Commit B / VIZ-01 / VIZ-03.
// Per CONTEXT D-12: latest-only, no persistence, no ring buffer.
// Per D-09: stale threshold = 1500 ms; flag flipped by a separate setInterval(200ms)
// inside <ScanOverlay> so the store stays data-focused and free of timers.
interface ScanState {
  latest: LaserScan | null;
  lastMessageAt: number | null;
  isStale: boolean;

  updateScan: (msg: LaserScan) => void;
  setStale: (stale: boolean) => void;
}

export const useScanStore = create<ScanState>((set) => ({
  latest: null,
  lastMessageAt: null,
  // Start stale: no scan has arrived yet, so the UI should show "LIDAR: stale"
  // until the first /scan message lands (at which point updateScan clears it).
  isStale: true,

  updateScan: (msg) =>
    set({ latest: msg, lastMessageAt: Date.now(), isStale: false }),

  setStale: (stale) => set({ isStale: stale }),
}));
