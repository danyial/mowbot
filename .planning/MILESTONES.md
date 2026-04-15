# Milestones

## v2.1 — LD19 LiDAR Integration (Shipped: 2026-04-15)

**Scope:** Brownfield-adopt the existing MowerBot codebase into GSD, then integrate an LD19 2D LiDAR end-to-end — hardware → `/scan` → web dashboard.

**Stats:** 5 phases · 7 plans · 24 tasks · 1 milestone audit
**Git anchor:** `gsd-baseline-v0` (adoption) → tag `v2.1` (close)

### Key Accomplishments

1. **Existing codebase adopted as GSD brownfield baseline** — PROJECT.md/REQUIREMENTS.md/ROADMAP.md/STATE.md written, `.planning/codebase/` map preserved, annotated git tag `gsd-baseline-v0` placed on adoption commit.
2. **Hardware: LD19 on a dedicated Pi 4 UART** — `dtoverlay=uart3` on GPIO4/5, stable `/dev/ttyLIDAR` udev symlink bound by device-tree path `fe201600.serial`, LD19 wired directly via pigtail (no HAT respin), ESP32 `/dev/ttyAMA0` link unaffected.
3. **Driver: `ldlidar_stl_ros2` containerized** — pinned `ghcr.io/danyial/mowbot/lidar:bf668a8`, publishing `sensor_msgs/LaserScan` on `/scan` @ 9.9–10.7 Hz with SensorDataQoS, `base_link→laser_frame` static TF. Cross-container DDS shmem retrofit via `ipc:host`+`pid:host` anchor.
4. **Web visualization: CBOR pipeline to Canvas 2D** — global CBOR compression on rosbridge with typed-array-aware NaN scrubber at subscriber boundary, `<ScanOverlay>` polar viridis render memoized per scan, stale-badge at 1500 ms threshold.
5. **Live SLAM mapping (beyond original scope)** — `slam_toolbox` containerized with pinned `humble-2.6.10`, `/map` OccupancyGrid @ ≥0.5 Hz, TF `map→odom→base_link→laser_frame`, rendered as bitmap under scan on `/lidar` with zoom/pan/reset UX.
6. **Foxglove bridge** — native WebSocket server on `:8765` alongside rosbridge, sidestepping rosbridge `float[]` serializer exception loop; Foxglove layout committed for desktop ROS2 debugging.

### Known Deferred Items (Accepted as Tech Debt)

- **HW-04** `/odom` regression check — blocked on firmware publishing `/odom` (pre-existing firmware gap). Tracked: `5v-rail-transient-measurement.md` Part A.
- **HW-05** 5V rail transient under load — blocked on drivetrain electrically connected. Tracked: `5v-rail-transient-measurement.md`.
- **9 human-UAT walkthroughs** — 4 on Phase 3 (outdoor GPS walk, bufferedAmount 5-min, stale badge flip, Foxglove open), 5 on Phase 4 (MapBitmap 5s render, Eraser timing, Home vs Eraser non-interference, /map no-regression, Eraser v0 honest-limit). All tracked in each phase `VERIFICATION.md` `human_verification:` block.
- **Phase 1 & Phase 2 VERIFICATION.md** — never formally generated; functional proof downstream via Phase 3 VERIFICATION.md measuring the full pipeline at 10.66 Hz.
- **/lidar map-scan alignment under motion** — tracked: `lidar-live-mapping.md` (gated on heading-fusion or firmware `/odom`).
- **SLAM pose → EKF yaw fusion** — tracked: `lidar-heading-gps-fusion.md` (next milestone candidate).

See `.planning/milestones/v2.1-MILESTONE-AUDIT.md` for full audit detail.

---
