---
title: /lidar page — deeper zoom + live SLAM map during scanning
area: web + ros2
created: 2026-04-14
source: post-phase-3 user feedback
priority: medium
related: quick/260414-w8p-lidar-standalone-page, Phase 3 (/scan overlay)
---

# /lidar — deeper zoom and live mapping

Captured 2026-04-14 as tomorrow's work after phase 3 + the lidar-standalone quick task wrapped up.

## Item 1 — Raise zoom ceiling

**Status:** current clamp is `[0.25, 8]` in `web/components/lidar/scan-canvas.tsx`.
**Problem:** 8× isn't enough to inspect near-field returns on a 25 m LD19 scan (e.g. a wall 30 cm away is only a handful of pixels even at max zoom).
**Action:**
- Raise upper clamp to ~32× (or higher; stress-test for aliasing and wheel-feel).
- Consider switching from integer notches to a smoother exponential step so high-zoom still feels responsive.
- Maybe: zoom-level readout in the corner (e.g. "12.4×") so the user knows where they are.
- Sanity-check that the viridis color stays distinguishable when points cluster at high zoom (may want per-zoom `pointRadius` scaling so far-apart points don't get lost and close points don't merge into blobs).

Files: `web/components/lidar/scan-canvas.tsx` only — map-overlay path unaffected.

## Item 2 — Real map built during scanning (live SLAM)

**Goal:** While the mower drives, accumulate `/scan` + `/odom` (or `/odometry/filtered`) into a persistent 2D occupancy map and render it live on `/lidar`. So the page evolves from "current 360° sweep" into "everything I've seen so far, stitched together by pose."

**Stack options to evaluate (pick one, don't do all):**

1. **`slam_toolbox`** (ROS2 Humble, actively maintained, default for most Nav2 tutorials). Publishes `/map` as `nav_msgs/OccupancyGrid` and a `map → odom` TF. Docker it alongside existing nav stack.
2. **`cartographer_ros`** — more accurate but heavier; probably overkill for a mower.
3. **Roll-our-own**: client-side occupancy accumulator in the browser using `/scan` + `/odom`, no ROS SLAM node. Cheapest to ship, worst accuracy (no loop closure, drifts with odom). Could be the v0 while evaluating slam_toolbox for v1.

**Preconditions (must be real before this is useful):**
- `/odom` publisher on ESP32 firmware (currently NOT published — see `5v-rail-transient-measurement.md` Part A). Without `/odom` the EKF `/odometry/filtered` is IMU-only which drifts badly.
- A TF chain `odom → base_link → laser_frame` that's accurate enough for stitching. Static TF for `base_link → laser_frame` already exists in the nav launch file; `odom → base_link` depends on `/odom`.

**Web-side work:**
- Subscribe to `/map` (`nav_msgs/OccupancyGrid`) via rosbridge. Under CBOR the `data` array will be typed — the Plan 03-01 scrubber's typed-array exemption already covers this.
- New render mode in `ScanCanvas` (or a sibling component): bitmap of the occupancy grid + live scan overlay on top.
- Persistence: let the occupancy map remain on the page even when `/scan` goes stale. Add a "reset map" control.
- Zoom/pan already works for the standalone canvas — reuse it for the map view.

**Likely shape:** This is probably its own phase, not a quick task. The firmware `/odom` gate alone is ≥ half-day of work. A new milestone "v2.2 — Live mapping" could cover:
- Phase A: ESP32 `/odom` publisher (unblocks everything downstream)
- Phase B: slam_toolbox containerized, `/map` published live
- Phase C: web `/lidar` page renders `/map` + scan overlay, persistent across sessions

## Notes

- Zoom tweak is trivial and could ship as another /gsd-quick in minutes.
- Live mapping depends on firmware — if `/odom` still isn't there, start with the firmware todo (`5v-rail-transient-measurement.md` Part A) before touching web code.

## References

- `web/components/lidar/scan-canvas.tsx` — current zoom clamp
- `web/components/map/scan-overlay.tsx` — Leaflet-anchored mode (keep untouched)
- `.planning/todos/pending/5v-rail-transient-measurement.md` — `/odom` firmware gate
- `.planning/phases/03-web-visualization-scan-on-the-map-page/03-02-SUMMARY.md` — current /scan pipeline
