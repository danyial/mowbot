"use client";

import * as ROSLIB from "roslib";
import { getRos } from "./ros-client";

/**
 * Phase 4 Plan 04-02 — Reset slam_toolbox map in place (no container restart).
 * Service spec: slam_toolbox/srv/Reset — empty request, empty response.
 *
 * Called from the Reset (Eraser) button in ScanCanvas. The button also calls
 * useMapStore.getState().clear() optimistically BEFORE awaiting this — that
 * pair is how the /lidar bitmap clears within 2 s of press (P3 assertion) even
 * though the next /map publish is up to map_update_interval (2 s) away.
 */
export function callSlamReset(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ros = getRos();
    if (!ros) {
      reject(new Error("ROS not connected"));
      return;
    }
    const svc = new ROSLIB.Service<Record<string, never>, Record<string, never>>({
      ros,
      name: "/slam_toolbox/reset",
      serviceType: "slam_toolbox/srv/Reset",
    });
    svc.callService(
      {},
      () => resolve(),
      (err: unknown) =>
        reject(err instanceof Error ? err : new Error(String(err)))
    );
  });
}
