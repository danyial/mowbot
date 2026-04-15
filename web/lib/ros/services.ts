"use client";

import * as ROSLIB from "roslib";
import { getRos } from "./ros-client";
import { useMapStore } from "@/lib/store/map-store";

/**
 * Phase 4 Plan 04-02 — Reset map view (client-side clear).
 *
 * NOTE: slam_toolbox in Humble online_async mode does NOT expose a
 * /slam_toolbox/reset service (verified via `ros2 service list` on the Pi).
 * There is no clean "wipe the SLAM graph" service in Humble async mode; the
 * only true reset path is a container restart, tracked for v1.
 *
 * For v0, this is a client-side-only clear, which matches the UX the Eraser
 * button promises: wipe the accumulated backing canvas so the user sees a
 * fresh picture when /map republishes (~1 Hz, so <= ~2 s).
 *
 * Behavior:
 *   1. Clear useMapStore immediately — this is the real UX effect.
 *   2. Best-effort call to /slam_toolbox/clear_changes (exists in Humble,
 *      harmless no-op in async mode) so the user gets a successful server
 *      round-trip as feedback. Failure is swallowed silently; the client
 *      clear is what matters.
 */
export function callSlamReset(): Promise<void> {
  // Step 1: client-side clear — the real UX effect.
  useMapStore.getState().clear();

  // Step 2: best-effort server-side nudge. Fire-and-forget; never reject.
  return new Promise((resolve) => {
    const ros = getRos();
    if (!ros) {
      resolve();
      return;
    }
    try {
      const svc = new ROSLIB.Service<Record<string, never>, Record<string, never>>({
        ros,
        name: "/slam_toolbox/clear_changes",
        serviceType: "slam_toolbox/srv/Clear",
      });
      svc.callService(
        {},
        () => resolve(),
        () => resolve() // swallow server errors; client clear already happened
      );
    } catch {
      resolve();
    }
  });
}
