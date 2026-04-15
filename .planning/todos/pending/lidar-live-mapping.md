---
title: /lidar page — map-scan alignment while mower is moving (post-Phase 4 residuals)
area: web + ros2
created: 2026-04-14
updated: 2026-04-15
source: post-phase-3 user feedback → Phase 4 residuals
priority: medium
related: Phase 4 (slam_toolbox), quick 260414-w8p, quick 260415-9ww, 5v-rail-transient-measurement, lidar-heading-gps-fusion
---

# /lidar — residuals after Phase 4

Original todo captured 2026-04-14 after Phase 3 covered "live SLAM map during scanning". **Most of this shipped in Phase 4 (2026-04-15)** — `slam_toolbox` containerized, `/map` OccupancyGrid published live, rendered on `/lidar` as MapBitmap with zoom/pan/reset UX, stale-badge + viridis legend preserved, robot marker + scale bar added, Eraser (client-side clear + `/slam_toolbox/clear_changes`).

## What's still open

### Map ↔ Scan alignment while moving

Current v0: scan is drawn in laser_frame (not rotated by TF), map in map-frame. When the robot physically rotates, map stays fixed in world-frame and scan stays fixed in robot-frame — so they visibly misalign. When stationary with EKF IMU drifting, map→base_link yaw spins unchecked.

Blocker: a stable `map → base_link` yaw source. Two paths both gated on other todos:

1. **Firmware `/odom` publisher landing** (`5v-rail-transient-measurement.md` Part A, HW-04). Real wheel encoder odom stops the EKF yaw from drifting. Then `map → base_link` composition becomes trustworthy. Cleanest architectural fix.
2. **Feed slam_toolbox's pose into the EKF** (`lidar-heading-gps-fusion.md`). SLAM's scan-matched yaw replaces the drifting IMU-only yaw. Works even without wheel `/odom`, as long as SLAM is producing stable estimates indoors.

### Map anchor assumes robot at map origin

MapBitmap in `web/components/lidar/map-bitmap.tsx` renders the grid using `info.origin.position` as bottom-left offset from canvas center (robot assumed at map-frame (0, 0)). Only true immediately after `Eraser` / `clear_changes`. Once the mower moves away from the SLAM start pose, scan and map drift apart even without rotation issues.

Fix: subscribe to `/tf` (already done via `useTfStore` added in commit 12dd12c), extract the `map → base_link` translation, subtract it from the grid origin offset so the grid scrolls under the robot as it moves. Web-only change, ~30 min work — but only becomes visible once the robot actually moves, which on an indoor test setup is rare.

### Persistence across sessions

Current `useMapStore` is in-memory only. Reload = fresh empty map until next `/map` publish repopulates it. Not urgent, but nice-to-have: localStorage backing of the last-seen OccupancyGrid.

### Honest-reset (server-side)

Eraser is a client-side clear + best-effort `clear_changes` (harmless no-op in Humble async mode). True "wipe the SLAM graph" requires a `docker compose restart slam`. Consider a back-end API endpoint `/api/slam/reset` that does the container restart, wired to the Eraser button for a real reset. This is v1 polish, not urgent.

## Closed (shipped in Phase 4, quicks, or phase-3 follow-ups)

- [x] Item 1 — deeper zoom, 15 m fit, viridis floor remap (quick 260415-9ww)
- [x] `slam_toolbox` containerized, `/map` live (Phase 4 Plan 04-01)
- [x] `<MapBitmap>` renders OccupancyGrid under scan (Phase 4 Plan 04-02)
- [x] Persistent across `/scan` dropouts (Phase 4)
- [x] Eraser reset control (Phase 4, client-side)
- [x] Zoom/pan reuses standalone UX (Phase 4)
- [x] Robot marker + scale bar + `N.N×` readout + heading tick (post-Phase 4 UX polish)
- [x] `/map` (Leaflet) overlays hidden so LIDAR badge + viridis legend don't collide with GPS status / zone controls (commit 39b6707)

## References

- `.planning/phases/04-live-mapping-slam-toolbox/` — Phase 4 artifacts
- `web/components/lidar/scan-canvas.tsx` + `web/components/lidar/map-bitmap.tsx` — current render
- `web/lib/store/tf-store.ts` — TF cache (used only for heading tick today)
- `.planning/todos/pending/5v-rail-transient-measurement.md` — firmware `/odom` gate
- `.planning/todos/pending/lidar-heading-gps-fusion.md` — SLAM pose → EKF yaw
