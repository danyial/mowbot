# Feature Landscape — LD19 LiDAR Integration (First LiDAR Milestone)

**Domain:** DIY / open-source autonomous robotic lawn mower — 2D LiDAR integration milestone
**Researched:** 2026-04-14
**Scope:** This milestone only (LD19 wired → `/scan` on ROS2 → visible in web dashboard + basic auto-stop). Nav2, SLAM, costmaps, blade control are deliberately out of scope; see Anti-Features.
**Overall confidence:** MEDIUM-HIGH (driver/topic patterns are well documented in Context7-class sources; outdoor-2D-LiDAR UX conventions mostly from WebSearch).

Existing capabilities assumed present and **not relisted here** (see `.planning/codebase/ARCHITECTURE.md`): teleop joystick, RTK GNSS `/fix`, IMU `/imu`, EKF fusion `/odometry/filtered`, rosbridge + NaN-sanitized WebSocket proxy, Leaflet map page, Zustand per-sensor stores, ESP32 differential drive with 500 ms cmd_vel watchdog, micro-ROS agent on `/dev/ttyAMA0`.

---

## Table Stakes

Minimum surface for a user (you, the operator) to say "the LiDAR works." Missing any of these and the milestone feels half-done.

| # | Feature | Complexity | Why Expected | Notes |
|---|---------|------------|--------------|-------|
| TS-1 | LD19 publishes `sensor_msgs/LaserScan` on `/scan` at ~10 Hz | Low | Canonical ROS2 contract for 2D LiDAR; every downstream tool (rviz, Nav2, slam_toolbox, Foxglove) expects it | Two viable driver lineages: `ldrobotSensorTeam/ldlidar_ros2` (official) and `Myzhar/ldrobot-lidar-ros2` (lifecycle-based fork). HIGH confidence. |
| TS-2 | Driver runs as its own Docker container, `network_mode: host`, `restart: unless-stopped` | Low | Matches the established per-service pattern (gnss, imu, nav, micro-ros-agent) | Mount whichever `/dev/tty*` the UART routing decision yields. |
| TS-3 | Correct `laser` TF frame published and statically linked to `base_link` | Low | Without TF, `/scan` is meaningless to rviz / Nav2 / costmaps later | Publish `base_link → laser` via `static_transform_publisher` with measured mount offset. Must match `frame_id` in LaserScan header. |
| TS-4 | `/scan` visible as 2D polar overlay on the existing `map/page.tsx` | Medium | Core Value of this milestone per PROJECT.md | Reuse rosbridge + Zustand pattern (new `useScanStore`). Render as SVG/Canvas polar fan anchored at robot pose. |
| TS-5 | Connection-status indicator for the LiDAR in the web UI | Low | Users need to know "is it alive?" — matches existing GPS / IMU / ROS status badges | Stale-scan detection (e.g. no message in >1 s → red badge). |
| TS-6 | Obstacle auto-stop safety hook | Medium | PROJECT.md active requirement; users expect that "the robot with a LiDAR won't drive into a wall" | Node subscribes `/scan`, publishes zero `/cmd_vel` (or a latch that suppresses teleop) when any range in the forward sector is below a threshold (e.g., 0.4 m). Complements — does not replace — the firmware 500 ms watchdog. |
| TS-7 | Angular sector mask / min-range filter | Low | The LD19 chassis, wheels, and HAT hardware will be inside the 360° field of view → permanent phantom obstacles if unfiltered | Use `laser_filters` package (`LaserScanAngularBoundsFilter`, `LaserScanRangeFilter`) or equivalent in the safety node. HIGH confidence — standard outdoor-robot practice. |
| TS-8 | Documented mounting orientation + known-good parameters | Low | Wrong `angle_min/angle_max` or upside-down mount → obstacles appear on the wrong side → scary debugging | Write to `docs/` alongside existing `pcb-motor-controller.md` pattern. Include photo + frame_id diagram. |
| TS-9 | Power + UART routing documented and load-tested with ESP32 UART still alive | Low | LD19 pulls ~180 mA at 5 V and needs a stable serial path that doesn't conflict with `/dev/ttyAMA0` (ESP32) | Likely a second UART via `dtoverlay=uart3` on Pi 4 GPIO, or USB-UART adapter as fallback. Decision belongs in STACK.md — this feature just requires the answer exist. |
| TS-10 | One-command bring-up via `docker compose up` | Low | Every other service already honors this; LiDAR breaking the pattern is friction | New service added to `docker-compose.yml` with correct `devices:` and `depends_on`. |

---

## Differentiators

Nice-to-have for *this* milestone — modest cost, disproportionate quality-of-life improvement. Pick 1–2; defer the rest.

| # | Feature | Complexity | Value | Notes |
|---|---------|------------|-------|-------|
| D-1 | Live range-threshold slider in the web UI | Low-Med | Lets you tune the auto-stop distance live in the yard without redeploying | Publish threshold via a `/safety/min_range` ROS2 param or topic; safety node subscribes. |
| D-2 | Color-coded scan points by distance (heatmap) | Low | Immediate, obvious visual feedback — near = red, far = green | Pure frontend; no backend cost. Pairs with TS-4. |
| D-3 | Scan trail / decay fade (last ~1 s of scans ghost-rendered) | Low | Makes motion of obstacles (and sensor noise) intuitively visible at a glance | Ring buffer in the Zustand store; alpha-fade in the polar renderer. |
| D-4 | Foxglove Studio–compatible setup (rosbridge exposed, layout file checked in) | Low | Zero-cost power-user debug view (polar 2D panel, TF tree, topic echo) — far richer than hand-rolled web for troubleshooting | rosbridge is already running on `:9090`; just need to document the URL + ship a `.foxglove-layout.json`. HIGH value:effort ratio. |
| D-5 | Mount-offset calibration helper page | Med | Measuring LiDAR-to-`base_link` offset by eyeball is error-prone; a "drive forward 1 m, verify scan wall shifts 1 m" UI flow catches mistakes | Optional; pure UX polish. |
| D-6 | Safety-zone visualization (draw the auto-stop fence on the map) | Low | Makes the otherwise-invisible safety threshold legible — prevents "why did it stop?" confusion | Trivially derivable from the D-1 threshold + TS-4 renderer. |
| D-7 | `rosbag2` auto-record of `/scan` + `/odometry/filtered` toggle | Low | Enables later offline SLAM/Nav2 development without re-mowing the yard | Button in settings page; `ros2 bag record` inside a container. Pairs beautifully with deferred SLAM milestone. |
| D-8 | LED status on existing WS2812 reflects LiDAR health | Low | Extends the existing LED state machine (red/yellow/green/blue/purple) to include a LiDAR-stale state | Requires ESP32 firmware add: subscribe to a `/status/lidar_ok` latched bool. Low firmware surface. |

**Recommended pick for this milestone:** D-4 (Foxglove) + D-2 (heatmap coloring). Together they give the best "this is obviously working" signal with <1 day of work combined.

---

## Anti-Features

Things that will be tempting to build in this milestone — don't. Each has a natural later home.

| Anti-Feature | Why Avoid (Now) | What to Do Instead |
|--------------|-----------------|--------------------|
| SLAM / `slam_toolbox` integration | Requires stable odom TF tree + careful param tuning; failure absorbs the whole milestone | Defer to a dedicated SLAM milestone. Ship `/scan` first; SLAM is a consumer. |
| Nav2 / costmap_2d / DWB planner | Huge config surface (global+local costmap, plugins, recovery behaviors); out of scope per PROJECT.md | Defer. TS-6 is the deliberately-dumb precursor. |
| 3D point cloud / `pointcloud_to_laserscan` / tilted-LiDAR mapping | LD19 is 2D and this is a first-integration milestone; don't invent new abstractions | Revisit only if a 3D sensor is added. |
| Dynamic obstacle *avoidance* (steering around) | Path planning is a Nav2 responsibility; hand-rolled avoidance hides the gap instead of exposing it | Auto-*stop* only (TS-6). Let Nav2 own avoidance later. |
| Grass-height / cliff / dropoff detection via LiDAR tilt tricks | Outdoor 2D LiDARs struggle with grass and sunlight already; cliff detection wants a dedicated downward sensor | Add a downward ToF or ultrasonic in a later milestone if needed. |
| Object classification ("that's a person vs. a tree") | No ML stack exists; requires camera + inference; scope explosion | Defer to a perception milestone (camera + ML). |
| Blade kill-switch tied to LiDAR | Blades aren't on the robot yet (out of scope per PROJECT.md); building phantom safety for absent hardware | When blades arrive, kill-switch becomes a *hardware* interlock (relay + e-stop), not a LiDAR consumer. |
| Geofencing / virtual keep-out zones driven by `/scan` | Confuses two orthogonal concepts — RTK-based geofences vs. LiDAR-based obstacles | Geofencing belongs on the RTK path (`/fix` + map zones already exist). LiDAR handles *dynamic* obstacles. |
| Multi-robot `/scan` merging | Not a goal per PROJECT.md out-of-scope list | — |
| Cloud streaming of LiDAR data | "Not a goal" per PROJECT.md; bandwidth hostile anyway (~50 KB/s raw) | Keep on local network. |
| Custom LD19 driver written from scratch | Two mature upstream drivers exist; rewriting is pure risk | Use `ldrobotSensorTeam/ldlidar_ros2` (or Myzhar's lifecycle fork); pin a version. |

---

## Feature Dependencies

```
TS-9 (power/UART routing)
   └─► TS-2 (driver container)
          └─► TS-1 (/scan published)
                 ├─► TS-3 (TF frame)   ──┐
                 ├─► TS-5 (health badge) │
                 ├─► TS-7 (filter mask)  ├─► TS-4 (web polar viz)  ──► D-2, D-3, D-6
                 │                        │
                 │                        └─► TS-6 (auto-stop)     ──► D-1, D-6
                 │
                 └─► D-4 (Foxglove)   [parallel, independent]
                 └─► D-7 (rosbag)     [parallel, independent]

TS-8 (docs) and TS-10 (compose) are cross-cutting; satisfied incrementally.
D-8 (LED) depends on TS-5 (health signal exists) and requires firmware edit.
```

**Critical path to Core Value ("`/scan` visible in web dashboard"):**
TS-9 → TS-2 → TS-1 → TS-3 → TS-4. Everything else is additive.

---

## MVP Recommendation

**Ship minimum (critical path + safety):** TS-1 through TS-10.
**Add for delight:** D-4 (Foxglove — ~1 hr of config), D-2 (distance coloring — ~1 hr of frontend).
**Explicitly defer:** all other differentiators, all anti-features.

Success for this milestone per PROJECT.md Core Value:
> "LD19 hardware → `/scan` topic on ROS2 → visible in the web dashboard's map view."
Everything in Table Stakes serves that sentence. Everything else is optional.

---

## Known UX Gotchas (inform requirements, not features)

These aren't features but *shape* the table-stakes features above:

- **Outdoor 2D LiDAR sees grass, dust, and direct sunlight as returns.** Expect noisy scans; the auto-stop (TS-6) should use a small cluster threshold (≥N consecutive rays), not a single-ray trigger. *(MEDIUM confidence; widely reported in hobbyist forums.)*
- **The LD19 is class 1, ~12 m range, ~4500 samples/sec, 360°.** Spec bounds the usable threshold for TS-6 (don't set it >8 m outdoors or noise dominates). *(HIGH confidence — official LD19 datasheet.)*
- **Scan frame rate matters for the watchdog.** If TS-6's stale-scan watchdog is faster than the publisher (LD19 is ~10 Hz), the robot will oscillate between stop/go. Set stale threshold ≥3× scan period. *(HIGH confidence — standard ROS2 timing practice.)*
- **TF tree must be consistent before rviz/Foxglove will render.** `base_link → laser` static TF and `map/odom/base_link` (already produced by EKF) must both exist. Forgetting this is the #1 "why is my scan not showing" bug. *(HIGH confidence.)*

---

## Sources

- [ldrobotSensorTeam/ldlidar_ros2 (official driver)](https://github.com/ldrobotSensorTeam/ldlidar_ros2) — HIGH confidence, canonical source
- [Myzhar/ldrobot-lidar-ros2 (lifecycle-based fork)](https://github.com/Myzhar/ldrobot-lidar-ros2) — HIGH confidence
- [richardw347/ld19_lidar (alternative minimal ROS2 node)](https://github.com/richardw347/ld19_lidar) — MEDIUM confidence
- [LD19 Development Manual v2.3 (Elecrow PDF)](https://www.elecrow.com/download/product/SLD06360F/LD19_Development%20Manual_V2.3.pdf) — HIGH confidence, hardware spec
- [Nav2 Setting Up Sensors guide (recommended LaserScan/TF patterns)](https://navigation.ros.org/setup_guides/sensors/setup_sensors.html) — HIGH confidence
- [Articulated Robotics — Adding Lidar](https://articulatedrobotics.xyz/tutorials/mobile-robot/hardware/lidar/) — MEDIUM confidence, pragmatic integration advice
- [Hello Robot — Filter Laser Scans (angular/range filtering pattern)](https://docs.hello-robot.com/0.3/ros2/example_2/) — MEDIUM confidence
- [Foxglove vs RViz comparison](https://foxglove.dev/blog/foxglove-vs-rviz) — MEDIUM confidence, informs D-4
- [OpenMower — DIY open-source mower ecosystem context](https://algustionesa.com/openmower-reshaping-robotic-lawn-care-open-source-style/) — LOW-MEDIUM confidence, ecosystem flavor only
- [Hesai — LiDAR in robotic mowers (commercial UX expectations)](https://www.hesaitech.com/no-wires-no-hassle-how-lidar-unlocks-true-intelligence-in-robotic-lawn-mowers/) — LOW confidence, vendor marketing, used only for UX conventions
