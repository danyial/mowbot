"use client";

import { create } from "zustand";
import type { OccupancyGrid } from "@/lib/types/ros-messages";

// Phase 4 Plan 04-02 (MAP-04) — slam_toolbox OccupancyGrid store.
// Mirrors useScanStore's latest-only shape. `clear()` is the optimistic-UI
// handle used by the Reset button in ScanCanvas (wipes bitmap immediately
// without waiting for the next /map publish post-/slam_toolbox/reset).
interface MapState {
  latest: OccupancyGrid | null;
  lastMessageAt: number | null;
  isStale: boolean;

  updateMap: (m: OccupancyGrid) => void;
  setStale: (s: boolean) => void;
  clear: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  latest: null,
  lastMessageAt: null,
  isStale: true,

  updateMap: (m) =>
    set({ latest: m, lastMessageAt: Date.now(), isStale: false }),

  setStale: (s) => set({ isStale: s }),

  clear: () => set({ latest: null, lastMessageAt: null, isStale: true }),
}));
