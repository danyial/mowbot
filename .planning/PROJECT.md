# MowerBot

## Current Milestone: v2.2 Ops & Fusion Polish

**Goal:** Close the observability + localization gaps left open after v2.1 — make the running system legible to the operator and make the SLAM map trustworthy under motion.

**Target features:**
- WebUI container-logs view — sidecar agent (Node + dockerode, `docker.sock` read-only) behind a `server.mjs` WebSocket proxy analogous to `/rosbridge`; new `/logs` route with container list + live viewer
- SLAM pose → EKF yaw fusion — feed `slam_toolbox` scan-matched pose into `robot_localization` as a yaw source, replacing IMU-only yaw that drifts at rest
- `/lidar` residuals + persistence + honest reset — subtract `map→base_link` translation in `<MapBitmap>` so grid scrolls under the robot; localStorage persistence for the occupancy grid; server-side honest-reset endpoint wired to Eraser

## What This Is

MowerBot is a DIY autonomous robotic lawn mower built on a distributed robotics architecture: a Raspberry Pi 4 running ROS2 Humble (dockerized), an ESP32-C3 micro-ROS motor controller on a custom Pi HAT, an RTK-capable GNSS + IMU sensor stack, an LD19 2D LiDAR on a dedicated UART, live SLAM mapping via `slam_toolbox`, and a Next.js 16 web dashboard for monitoring, teleop, mission planning, and live scan + occupancy-grid visualization on `/map` and `/lidar`.

## Core Value

The robot **senses, localizes, and renders its surroundings live to the operator** — `/scan` + `/map` flow end-to-end from hardware through ROS2 into the browser. This foundation unlocks obstacle-avoidance, Nav2, and autonomous mowing milestones that follow.

## Requirements

### Validated

<!-- Existing brownfield (pre-v2.1) + everything shipped in v2.1. -->

**Pre-existing (inferred from brownfield codebase):**
- ✓ ESP32-C3 micro-ROS motor controller with differential drive kinematics, encoder feedback, 500 ms cmd_vel watchdog, WS2812 status LED
- ✓ Raspberry Pi HAT PCB (v2.0, 100×80 mm) carrying ESP32, BTS7960 motor drivers, MINI560 buck converters, ADS1115 ADC, GY-521 IMU, UART link to Pi
- ✓ Dockerized ROS2 Humble service stack: `micro-ros-agent`, `gnss` (UM980 NMEA), `imu` (MPU6050 I2C), `nav` (EKF + navsat_transform), `ntrip` (RTK), `rosbridge`, `web`
- ✓ Sensor fusion: EKF fuses `/imu` + `/fix` → `/odometry/filtered`
- ✓ Next.js 16 web dashboard (App Router: dashboard, map, teleop, missions, settings), rosbridge WebSocket bridge, NaN sanitization layer
- ✓ CycloneDDS middleware with `network_mode: host` across all containers

**Shipped in v2.1 (LD19 LiDAR Integration):**
- ✓ GSD brownfield adoption — PROJECT/REQUIREMENTS/ROADMAP/STATE + `.planning/codebase/` map + annotated tag `gsd-baseline-v0` — v2.1 META-01
- ✓ LD19 on a dedicated Pi 4 PL011 UART — `dtoverlay=uart3`, `/dev/ttyLIDAR` udev symlink — v2.1 HW-01..HW-03
- ✓ `ldlidar_stl_ros2` Docker service publishing `/scan` @ ~10 Hz with SensorDataQoS + `base_link→laser_frame` TF — v2.1 DRV-01..DRV-05
- ✓ 2D polar scan overlay on `/map` page (CBOR rosbridge, viridis coloring, stale-badge, Foxglove layout) — v2.1 VIZ-01..VIZ-05
- ✓ Live SLAM mapping — `slam_toolbox` containerized, `/map` OccupancyGrid rendered as bitmap under scan on `/lidar` with zoom/pan/reset UX — v2.1 MAP-01..MAP-05
- ✓ Foxglove native bridge (`:8765`) alongside rosbridge for desktop ROS2 debugging

### Active

<!-- Next milestone — v2.2 Ops & Fusion Polish. Detailed requirements -->
<!-- will be written during /gsd-new-milestone. -->

- [ ] WebUI container-logs view: sidecar agent (Node + dockerode, docker.sock read-only) behind a `server.mjs` WebSocket proxy analogous to `/rosbridge`; new `/logs` route with container list + live viewer
- [ ] SLAM pose → EKF yaw fusion: feed `slam_toolbox`'s scan-matched pose back into `robot_localization` as a yaw source, replacing IMU-only yaw that drifts at rest
- [ ] `/lidar` residuals: subtract `map→base_link` translation in `<MapBitmap>` so grid scrolls under the robot when moving; localStorage persistence for the occupancy grid; server-side honest-reset endpoint wired to Eraser

### Deferred (Carried from v2.1)

- [ ] **HW-04** `/odom` regression-echo — blocked on firmware publishing `/odom`; todo `5v-rail-transient-measurement.md` Part A
- [ ] **HW-05** 5V rail transient under motor+LiDAR load — blocked on drivetrain electrically connected; todo `5v-rail-transient-measurement.md`
- [ ] **9 human-UAT walkthroughs** (Phase 3 outdoor GPS walk + bufferedAmount + stale badge + Foxglove; Phase 4 MapBitmap render + Eraser + Home + /map regression + v0 honest-limit) — require physical mower access

### Out of Scope

- Safety auto-stop watchdog (`/cmd_vel` gating based on `/scan`) — re-evaluate once heading-fusion stabilizes yaw; fast-stop behavior without a trustworthy heading is unsafe
- Full Nav2 autonomous waypoint navigation — depends on stable map + trusted localization; premature until heading-fusion lands
- Blade/cutting actuation and mowing pattern planning — drive + sense milestones come first
- Loop closure in `slam_toolbox` (sync mode) — async mode is the right tradeoff for a live-map dashboard; long-trajectory drift accepted
- Multi-robot / fleet management — not a goal
- Cloud telemetry / remote access beyond local network — not a goal
- `ros3djs` / `ros2djs` in the web viz — Canvas 2D stays the rendering primitive

## Context

- **Milestone cadence:** v2.1 shipped 2026-04-15 — full LiDAR pipeline + live SLAM. Next: v2.2 Ops & Fusion Polish.
- **Tech stack:** ROS2 Humble + CycloneDDS + micro-ROS serial, 9 Docker services (`micro-ros-agent`, `gnss`, `imu`, `nav`, `ntrip`, `rosbridge`, `lidar`, `slam`, `foxglove_bridge`, `web`). Browser: Next.js 16 / React 19 / Zustand / Leaflet / Canvas 2D.
- **Hardware state:** Pi 4 + HAT v2.0 + LD19 on GPIO4/5 pigtail. Motors/encoders physically not yet connected → no firmware `/odom` yet → EKF yaw drifts from IMU-only input. This single gap is the common blocker for HW-04, HW-05, map-scan alignment under motion, and SLAM-heading fusion reliability.
- **Codebase map:** `.planning/codebase/` (ARCHITECTURE, STACK, CONCERNS, CONVENTIONS, INTEGRATIONS, STRUCTURE, TESTING). Refreshed when architecture meaningfully shifts.
- **Pending operator UAT:** 9 walkthroughs require physical mower (outdoor GPS fix, container-lifecycle manipulation, Foxglove Studio driving). Absorbed into regular test-session rhythm, not blocking milestone close.

## Constraints

- **Tech stack**: ROS2 Humble — fixed. New nodes go in Docker containers with `network_mode: host` + `ipc: host` + `pid: host` (cross-container DDS shmem). No migration to Jazzy/Iron.
- **Hardware**: Raspberry Pi 4 (not Pi 5). UART routing: `ttyAMA0` = ESP32, `ttyLIDAR` = LD19 on uart3. No more PL011s available without HAT respin.
- **Hardware**: ESP32-C3 firmware is Arduino + micro-ROS via PlatformIO. No ESP-IDF migration this milestone.
- **Web**: Next.js 16 / React 19 App Router. Scan overlay on `/map`, occupancy-grid on `/lidar`, logs on `/logs` (v2.2).
- **Communication**: ESP32 ↔ Pi is UART `/dev/ttyAMA0` @ 115200. LiDAR on `/dev/ttyLIDAR` @ 230400. No conflict.
- **Dependencies**: CycloneDDS middleware, rosbridge WebSocket, NaN sanitization layer, CBOR compression on binary topics, `x-ros-common` anchor (`ipc:host`+`pid:host`) — all load-bearing. Preserve.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Initialize existing MowerBot work as GSD brownfield baseline (v2.1) | Codebase already mapped and working; GSD wraps it | ✓ Good — annotated tag `gsd-baseline-v0` + ADOPTION.md receipt |
| Add LD19 LiDAR in v2.1 (not defer) | Hardware on hand; unlocks obstacle-avoid / SLAM / Nav2 | ✓ Good — `/scan` pipeline live end-to-end, 10.66 Hz CBOR |
| LD19 via UART directly to Pi (not USB, not via ESP32) | Keeps sensor topology HAT-centric; matches existing pattern | ✓ Good — `dtoverlay=uart3` on GPIO4/5, `/dev/ttyLIDAR` via device-tree path |
| Pigtail to 40-pin header bypassing HAT v2.0 (no PCB respin) | HAT v2.1 respin deferred; pigtail is zero-risk | ✓ Good — shipped without hardware rework |
| v2.1 success = `/scan` visible in web UI (not full Nav2) | Smallest end-to-end slice proves data pipeline | ✓ Good — Core Value gate reached at Phase 3 |
| LiDAR visualization = Canvas 2D polar (not ros3djs) | ros3djs is React-version-hostile + unmaintained | ✓ Good — memoized polar→Cartesian, ~60 fps stable |
| Added Phase 4 (slam_toolbox live mapping) after Phase 3 | Hardware + pipeline both ready; deferring felt wasteful | ✓ Good — `/map` OccupancyGrid + `/lidar` bitmap UX shipped in same milestone |
| `x-ros-common` anchor retrofit (ipc:host + pid:host) | CycloneDDS shmem transport needs shared IPC/PID namespaces across containers | ✓ Good — retrofitted with per-service regression gate, no breakage |
| CBOR compression + typed-array exemption in NaN scrubber | Binary `float[]` payloads (LaserScan, OccupancyGrid) must pass through unscrubbed | ✓ Good — Float32Array preserved end-to-end |
| Foxglove via separate `foxglove_bridge` container (not rosbridge) | rosbridge v2 Humble has `float[]` serializer bug (85% CPU loop) | ✓ Good — native Foxglove WS on :8765, rosbridge unchanged for web |
| Defer HW-04/HW-05 to next milestone | Both gated on drivetrain connected + firmware `/odom`; out-of-scope for LiDAR integration | ✓ Accepted — tracked in pending todos; milestone closed with documented debt |
| Map-scan alignment under motion deferred | Gated on stable yaw source (SLAM pose fusion or firmware `/odom`) | — Pending v2.2 |
| Safety watchdog deferred to post-fusion milestone | Needs trusted heading before cmd_vel gating is safe | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-15 — v2.2 Ops & Fusion Polish milestone started*
