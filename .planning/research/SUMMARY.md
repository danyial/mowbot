# Project Research Summary

**Project:** MowerBot — LD19 LiDAR Integration Milestone
**Domain:** 2D LiDAR sensor integration into a brownfield ROS2 Humble + Raspberry Pi 4 + Next.js robotic lawn mower
**Researched:** 2026-04-14
**Confidence:** HIGH

## Executive Summary

This milestone adds an LD19 2D LiDAR to an already-working distributed robotics stack (Pi 4 + ROS2 Humble dockerized services + ESP32-C3 motor controller HAT + Next.js 16 web dashboard). The research converges on a single recommended path: run the vendor-official `ldlidar_stl_ros2` driver in a new Docker service, wire the LD19 over a dedicated Pi 4 hardware UART (`dtoverlay=uart3` on GPIO4/5 at 230400 baud), publish `sensor_msgs/LaserScan` on `/scan` with a proper `base_link → laser_frame` static TF, and render the scan as a Canvas 2D polar overlay on the existing map page via rosbridge with `throttle_rate` + CBOR compression. A small ROS2 safety-watchdog node gates `/cmd_vel` upstream of the ESP32 to provide obstacle auto-stop.

Architecture decisions are largely forced by the brownfield: `ttyAMA0` is already consumed by the ESP32 HAT link, so the LD19 must land on a secondary PL011 UART — not the miniUART (`ttyS0`), whose baud clock jitters with CPU load and corrupts 230400-baud streams. GPIO0/1 (uart2) is off-limits due to HAT EEPROM collision; GPIO8/9 (uart4) collides with the WS2812 status LED; `uart3` on GPIO4/5 is the one clean pair. All new services follow the established docker-per-node pattern with `network_mode: host` (plus `ipc: host` + `pid: host` for reliable CycloneDDS discovery).

Risks cluster into three buckets: (1) UART routing mistakes that silently break the ESP32 link or HAT autodetect, (2) outdoor sensor behavior — grass/sunlight false positives that will make a naive auto-stop watchdog unusable, and (3) rosbridge bandwidth — unthrottled 10 Hz LaserScan will saturate the WebSocket on the second browser connection. Mitigations are well-understood: dedicated `uart3` overlay + `disable-bt` + udev symlinks, cluster-based + forward-arc-only watchdog with LiDAR mounted above grass line, and explicit `throttle_rate: 100ms` + `compression: "cbor"` on the browser subscribe.

## Key Findings

### Recommended Stack

The stack additions are minimal and consistent with the existing architecture — one new ROS2 driver package, one new Docker service, one new React component, no new web dependencies. See `STACK.md` for full detail.

**Core technologies:**
- **`ldlidar_stl_ros2` driver (LDROBOT official)** — parses LD19 UART packet stream and publishes `/scan`. Manufacturer-maintained, Humble-validated, supports LD19 natively.
- **Pi 4 `dtoverlay=uart3` on GPIO4/5** — dedicated PL011 hardware UART at 230400 baud. Cleanest free pin pair; uart2 collides with HAT EEPROM, uart4 with WS2812 LED, uart5 with BTS7960 PWM traces.
- **udev symlink `/dev/ttyLIDAR`** — stable device path mirroring existing `/dev/ttyESP32` / `/dev/ttyGNSS` pattern.
- **New `lidar` Docker service** — ROS2 Humble base image, `network_mode: host` + `ipc: host` + `pid: host`, matches existing `gnss`/`imu`/`micro-ros-agent` layout.
- **Canvas 2D polar renderer** — vanilla React 19 + `<canvas>` inside `requestAnimationFrame` reading from a Zustand `useScanStore`. `ros3djs`/`ros2djs` rejected as unmaintained.
- **Existing rosbridge + roslibjs 2.1.0 + NaN sanitizer** — reused unchanged; browser uses explicit `throttle_rate: 100` + `compression: "cbor"` + `queue_length: 1`.

### Expected Features

See `FEATURES.md` (10 table stakes, 8 differentiators, 10 explicit anti-features).

**Must have (table stakes):**
- `/scan` publishing at ~10 Hz with correct `frame_id` and `base_link → laser_frame` static TF
- LD19 driver as Docker container on host network, one-command `docker compose up`
- 2D polar scan overlay on existing `map/page.tsx` — Core Value deliverable per PROJECT.md
- Connection-status indicator + stale-scan detection (>1 s → red badge)
- Safety auto-stop watchdog gating forward motion when forward-arc min-range below threshold
- Angular sector mask / min-range filter (chassis + wheels inside 360° FoV)
- Documented mounting orientation + known-good launch params
- UART routing documented with ESP32 link verified still alive

**Should have (recommended picks):**
- **D-4 Foxglove Studio compatibility** — rosbridge already on :9090; ship `.foxglove-layout.json`, highest value:effort
- **D-2 Distance-colored heatmap** — pure frontend, near=red/far=green

**Defer (v2+):**
- Nav2 / costmap_2d / DWB planner (separate milestone)
- slam_toolbox / map-building (needs stable `/scan` + odom TF first)
- 3D pointcloud, dynamic avoidance steering, object classification, blade kill-switch, geofencing via `/scan`, multi-robot, cloud telemetry — all explicit anti-features

### Architecture Approach

See `ARCHITECTURE.md`. The system extends the existing docker-per-node pattern with two new ROS2 nodes and one new web component; the `/scan` data path branches at the rosbridge boundary to feed both the safety watchdog (same-host DDS) and the browser (throttled WebSocket).

**Major components:**
1. **`lidar` container (NEW)** — wraps `ldlidar_stl_ros2`, publishes `/scan` with sensor QoS (BEST_EFFORT, KEEP_LAST 5) at 10 Hz, mounts `/dev/ttyLIDAR`
2. **`safety_watchdog` node (NEW)** — colocated in existing `nav` container; subscribes `/scan` + `/cmd_vel_raw`, republishes gated `/cmd_vel` (sole publisher pattern, twist_mux-style)
3. **`ScanOverlay` React component (NEW)** — Canvas 2D polar renderer on `map/page.tsx`, fed by new `useScanStore` Zustand store holding latest scan as Float32Array
4. **Static TF publisher** — `base_link → laser_frame` with measured mount offsets, in nav launch
5. **Reused unchanged:** rosbridge (add `/scan` to any whitelist), `web/server.mjs` NaN sanitizer, ESP32 firmware (LiDAR is Pi-direct)

### Critical Pitfalls

Top risks, ordered by severity. See `PITFALLS.md` for full treatment.

1. **miniUART (`ttyS0`) at 230400 baud** — baud clock depends on VPU core_freq; CRC failures correlate with load. **Avoid:** use `dtoverlay=uart3` (PL011), never `ttyS0`.
2. **UART2 on GPIO0/1 kills HAT ID EEPROM** — breaks HAT autodetection. **Avoid:** use `uart3` (GPIO4/5). Also `dtoverlay=disable-bt` + `systemctl disable hciuart` to keep `ttyAMA0` (ESP32) stable.
3. **Unthrottled `/scan` over rosbridge** — 10 Hz × 456 points × JSON ≈ 80+ KB/s per browser; WebSocket buffers grow. **Avoid:** explicit `throttle_rate: 100ms` + `compression: "cbor"` + `queue_length: 1`; Canvas 2D (not SVG/React-per-point).
4. **Outdoor false positives (grass + sunlight)** — single-beam sub-threshold from grass + sun-blinded NaN beams interpreted as "clear" oscillates the mower or hides real obstacles. **Avoid:** mount LiDAR 25–40 cm above grass line; require N-consecutive-frame + K-contiguous-beam clusters in forward ±45° arc only; treat NaN/Inf as *unknown*, never *clear*.
5. **Hard-coded `/dev/ttyAMA1` instead of udev symlink** — enumeration shifts across reboots. **Avoid:** udev rule binding by device-tree path → `/dev/ttyLIDAR` symlink.
6. **cmd_vel race between teleop and watchdog** — last-writer-wins; mower resumes after watchdog zero. **Avoid:** rename teleop publisher to `/cmd_vel_raw`; safety watchdog as *sole* publisher on `/cmd_vel`.

## Implications for Roadmap

A four-phase roadmap fits naturally — each phase has a verifiable exit criterion and addresses a distinct pitfall cluster.

### Phase 1: Hardware & UART Routing
**Rationale:** Every downstream step depends on the LD19 being electrically reachable from the Pi without breaking the existing ESP32 link. Most irreversible decisions live here (boot config, HAT mods, udev rules).
**Delivers:** LD19 powered and streaming raw bytes to a stable device path (`/dev/ttyLIDAR`); ESP32 UART link still green; `picocom` at 230400 shows valid packet headers (0x54 0x2C).
**Addresses pitfalls:** 1 (miniUART), 2 (BT overlay), 3 (udev), 6 (HAT EEPROM), 11 (5V brown-out).

### Phase 2: Driver Containerization & `/scan` Publication
**Rationale:** With bytes flowing, validate driver + TF + QoS in isolation before web/safety layers. Keeps debug loops short.
**Delivers:** `lidar` Docker service publishing `sensor_msgs/LaserScan` at steady 10 Hz with correct `frame_id: laser_frame`, `base_link → laser_frame` static TF, sensor QoS, pinned driver SHA. `ros2 topic hz /scan` shows 10.0 ± 0.1 Hz.
**Addresses pitfalls:** 4 (frame_id + `laser_scan_dir`), 9 (DDS discovery), 10 (timestamp drift), 12 (driver fork), 13 (QoS), 16 (angle conventions), 17 (unpinned image).

### Phase 3: Web Visualization — `/scan` on the Map Page
**Rationale:** PROJECT.md Core Value gate ("`/scan` visible in dashboard"). With driver solid, work is pure frontend + rosbridge tuning.
**Delivers:** `ScanOverlay` Canvas 2D polar renderer on `map/page.tsx`, `useScanStore` (latest-only, Float32Array), throttled CBOR rosbridge subscribe, connection-status badge with stale-scan detection. Optional: D-2 heatmap + D-4 Foxglove layout.
**Addresses pitfalls:** 5 (bandwidth), 14 (rosbridge whitelist), 18 (canvas Y-axis flip).

### Phase 4: Safety Watchdog & Obstacle Auto-Stop
**Rationale:** With `/scan` visible end-to-end, tune safety against real outdoor data. Doing this last means thresholds are informed by what the LiDAR actually sees outdoors.
**Delivers:** `safety_watchdog` node in `nav` container, teleop republished as `/cmd_vel_raw`, watchdog sole publisher on `/cmd_vel`, cluster-based + forward-arc-only detection, NaN-as-unknown semantics, scan-stale fail-safe, per-trigger logging.
**Addresses pitfalls:** 7 (grass), 8 (sunlight NaN-as-clear), 15 (cmd_vel race), 19 (intensity misuse).

### Phase Ordering Rationale

- **Hardware-first** is non-negotiable: UART routing, BT disable, udev, HAT pigtail are all boot/config/solder changes that gate everything else and risk breaking the existing ESP32 link.
- **Driver before viz before safety** matches the natural debug funnel — each phase has exactly one new surface to blame.
- **Safety watchdog last** is deliberate: it's the phase most sensitive to real-world sensor behavior (grass, sun, dust); building against recorded yard data is far more effective than blind tuning.
- The roadmap deliberately stops at "scan visible + dumb auto-stop." Nav2/SLAM/costmaps are explicit anti-features and belong to separate future roadmaps.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 — Hardware:** Exact HAT modification path (pigtail vs. v2.1 respin vs. USB-UART fallback) and precise `/boot/firmware/config.txt` diff are bench-validated decisions.
- **Phase 4 — Safety Watchdog:** Outdoor-mower-specific thresholds (cluster size, persistence frames, arc width, sun-blindness detection) sparsely documented; field testing drives this.

Phases with standard patterns (skip research-phase):
- **Phase 2 — Driver Containerization:** `ldlidar_stl_ros2` launch params, static TF, CycloneDDS discovery, sensor QoS all well-documented.
- **Phase 3 — Web Visualization:** Canvas 2D polar rendering, roslibjs throttle/CBOR, Zustand patterns established in this codebase.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Driver, UART overlay, roslibjs verified against LDROBOT manual, Pi official docs, existing package.json. |
| Features | MEDIUM-HIGH | Table-stakes/anti-features from canonical ROS2/Nav2 setup guides. Outdoor-mower UX gotchas lean on forums; directionally right, exact thresholds TBD in Phase 4. |
| Architecture | HIGH | Entirely brownfield-preserving. DDS discovery, TF, QoS, safety-multiplexer all follow established ROS2 conventions. |
| Pitfalls | HIGH | Pi 4 UART pitfalls extensively documented in official Pi docs/forums. Outdoor-LiDAR pitfalls MEDIUM — strong consensus, fewer first-party citations. |

**Overall confidence:** HIGH

### Gaps to Address

- **Exact `/dev/ttyAMAn` enumeration after `dtoverlay=uart3` on Ubuntu 22.04** — resolve by `ls /dev/ttyAMA*` after first reboot in Phase 1; udev symlink makes this invisible downstream.
- **HAT v2.0 GPIO4/5 trace conflicts** — visually verify v2.0 KiCad schematic in Phase 1 before committing. Fallback: `uart5` on GPIO12/13 or USB-UART dongle.
- **Safety-watchdog threshold tuning** — specific values require field data. Phase 4 ships with configurable ROS2 params + rosbag recording for reproducibility.
- **MINI560 5V headroom with LD19 added** — noted in existing CONCERNS.md; Phase 1 confirms before committing LD19 to Pi 5V rail.
- **LD19 mount height + orientation** — determines Phase 2 static TF values and Phase 4 false-positive behavior.

## Sources

### Primary (HIGH confidence)
- ldrobotSensorTeam/ldlidar_stl_ros2 — driver choice, launch params, LD19 support
- LDROBOT LD19 Development Manual v2.3 — protocol (230400 8N1, 0x54/0x2C header, 47-byte frame, CRC8)
- Raspberry Pi documentation — UART configuration (dtoverlay pin mapping)
- Raspberry Pi Forums — Pi 4 additional UART ports; miniUART core_freq dependency
- Nav2 — Setting Up Transformations — REP-103/105 TF conventions
- RobotWebTools/rosbridge_suite — `throttle_rate`, CBOR, `queue_length`
- robot_localization state estimation docs — frame_id rules

### Secondary (MEDIUM confidence)
- Myzhar/ldrobot-lidar-ros2 — lifecycle-node alternative for future Nav2 milestone
- Waveshare DTOF LIDAR LD19 wiki — wiring/power
- LudovaTech/lidar-LD19-tutorial — independent protocol verification
- Articulated Robotics / Hello Robot — integration and filter guidance
- Fix ROS 2 Discovery Issues in Docker — host/ipc/pid for CycloneDDS
- Outdoor LiDAR considerations (LiDAR News / SICK) — sunlight/weather false positives

---
*Research completed: 2026-04-14*
*Ready for roadmap: yes*
