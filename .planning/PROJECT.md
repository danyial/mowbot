# MowerBot

## What This Is

MowerBot is a DIY autonomous robotic lawn mower built on a distributed robotics architecture: a Raspberry Pi 4 running ROS2 Humble (dockerized), an ESP32-C3 micro-ROS motor controller on a custom Pi HAT, an RTK-capable GNSS + IMU sensor stack, and a Next.js 16 web dashboard for monitoring, teleop, and mission planning. The current milestone initializes the existing work into the GSD workflow and adds an LD19 2D LiDAR for obstacle awareness and future mapping/navigation.

## Core Value

LiDAR data must flow end-to-end: LD19 hardware → `/scan` topic on ROS2 → visible in the web dashboard's map view. If that works, the sensor is fully wired into the existing stack and unlocks the obstacle-avoidance / SLAM / Nav2 work that follows.

## Requirements

### Validated

<!-- Inferred from existing brownfield codebase (see .planning/codebase/). -->

- ✓ ESP32-C3 micro-ROS motor controller with differential drive kinematics, encoder feedback, 500 ms cmd_vel watchdog, and WS2812 status LED — existing
- ✓ Raspberry Pi HAT PCB (v2.0, 100x80 mm) carrying ESP32, BTS7960 motor drivers, MINI560 buck converters, ADS1115 ADC, GY-521 IMU, UART link to Pi (GPIO14/15 ↔ ESP32 GPIO20/21) — existing
- ✓ Dockerized ROS2 Humble service stack: `micro-ros-agent`, `gnss` (UM980 NMEA), `imu` (MPU6050 I2C), `nav` (EKF + navsat_transform from robot_localization), `ntrip` (RTK corrections via str2str), `rosbridge`, `web` — existing
- ✓ Sensor fusion: EKF fuses `/imu` + `/fix` → `/odometry/filtered` — existing
- ✓ Next.js 16 web dashboard with App Router pages (dashboard, map, teleop, missions, settings), rosbridge WebSocket bridge, NaN sanitization layer — existing
- ✓ CycloneDDS middleware with `network_mode: host` across all containers — existing

### Active

<!-- Current milestone — initialize into GSD and integrate LD19 LiDAR. -->

- [ ] Adopt existing codebase as the GSD brownfield baseline (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md)
- [ ] LD19 LiDAR hardware wired to Pi 4 (connection path TBD — research phase decides)
- [ ] LD19 driver containerized as a ROS2 service publishing `sensor_msgs/LaserScan` to `/scan`
- [ ] HAT PCB revision (if required by chosen UART routing) to expose LD19 serial connection cleanly
- [ ] `/scan` visualized as a 2D polar overlay on the web dashboard's map page
- [ ] Basic obstacle auto-stop hook: watchdog that zeros `cmd_vel` when `/scan` reports points inside a safety threshold (foundation for future Nav2 work)

### Out of Scope

<!-- Nothing explicitly excluded yet — user chose "keep scope open". These -->
<!-- are deferred, NOT rejected. Re-evaluate at next milestone. -->

- Full Nav2 autonomous waypoint navigation — deferred to a later milestone (LiDAR + costmap integration comes after raw data is flowing)
- SLAM / map building (slam_toolbox, cartographer) — deferred; needs stable `/scan` + odom TF tree first
- Blade/cutting actuation and mowing pattern planning — deferred; drive + sense milestones come first
- Multi-robot / fleet management — not a goal
- Cloud telemetry / remote access beyond local network — not a goal

## Context

- **Brownfield initialization.** Codebase already mapped in `.planning/codebase/` (ARCHITECTURE, STACK, CONCERNS, CONVENTIONS, INTEGRATIONS, STRUCTURE, TESTING as of 2026-04-14). Roadmap must respect existing architecture — do not redesign what already works.
- **Pi 4, not Pi 5.** UART availability is constrained: `ttyAMA0` (GPIO14/15) already used for ESP32 HAT link; `ttyS0` is the miniUART (unreliable for high baud). Additional UARTs require `dtoverlay=uart2..5` in `/boot/config.txt` and pin routing via HAT — this is a research-phase decision.
- **LD19 LiDAR** is physically on hand but not yet connected or integrated.
- **Hardware uncommitted WIP** in git: PCB files, STEP models, ERC/DRC reports in `hardware/` — latest PCB is the 100x80 mm Pi HAT v2.0.
- **ROS2 Humble + CycloneDDS + micro-ROS serial transport** is the backbone; all new sensor nodes follow the same docker-per-node pattern already established in `docker/`.

## Constraints

- **Tech stack**: ROS2 Humble — fixed. New nodes go in Docker containers with `network_mode: host`. No migration to ROS2 Jazzy / Iron this milestone.
- **Hardware**: Raspberry Pi 4 (not Pi 5) — UART routing constrained; see Context.
- **Hardware**: ESP32-C3 firmware is Arduino + micro-ROS via PlatformIO — do not migrate to ESP-IDF this milestone.
- **Web**: Next.js 16 / React 19 — keep the App Router structure; new viz goes on the existing `map/page.tsx`.
- **Communication**: ESP32 ↔ Pi is UART `/dev/ttyAMA0` at 115200 baud — not USB. LiDAR must not conflict with this.
- **Dependencies**: CycloneDDS middleware, rosbridge WebSocket, NaN sanitization layer are load-bearing — preserve.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Initialize existing MowerBot work as GSD brownfield baseline | Codebase already mapped and working; GSD needs to wrap it, not rebuild | — Pending |
| Add LD19 LiDAR in this milestone (not defer) | Hardware is on hand; unlocks obstacle-avoid / SLAM / Nav2 downstream | — Pending |
| LD19 connects via UART directly to Pi/HAT (not USB, not via ESP32) | User preference; keeps sensor topology clean and matches existing HAT-centric design | — Pending |
| v1 success = `/scan` visible in web UI (not full Nav2) | Smallest end-to-end slice proves data pipeline; avoids overreach | — Pending |
| LiDAR visualization = 2D polar scan on existing map page | Reuses established UI, simplest path to user-visible result | — Pending |
| Defer Nav2, SLAM, blade control to later milestones | Keep milestone shippable; LiDAR data flow is the gating dependency | — Pending |

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
*Last updated: 2026-04-14 after initialization*
