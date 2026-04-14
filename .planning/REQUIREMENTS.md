# Requirements: MowerBot — LD19 LiDAR Integration

**Defined:** 2026-04-14
**Core Value:** LiDAR data flows end-to-end — LD19 hardware → `/scan` topic → 2D polar overlay visible on the web dashboard's map page.

## v1 Requirements

Requirements for this milestone. Each maps to a roadmap phase.

### Hardware & UART Routing

- [ ] **HW-01**: Pi 4 `dtoverlay=uart3` enabled on GPIO4/5 (plus `disable-bt` if required) so a dedicated PL011 UART is available for the LD19 without disturbing `ttyAMA0` used by the ESP32 HAT link
- [ ] **HW-02**: Stable `/dev/ttyLIDAR` udev symlink resolves to the LD19's UART across reboots (mirrors the existing `/dev/ttyGNSS` pattern)
- [ ] **HW-03**: LD19 is physically connected to the Pi HAT via a GPIO4/5 pigtail/header (no PCB respin this milestone); wiring is documented in `docs/`
- [ ] **HW-04**: Existing ESP32 motor-controller UART link verified still operational after all boot-config changes (regression check: `ros2 topic echo /odom` shows live encoder data)
- [ ] **HW-05**: 5V rail headroom with LD19 drawing current is measured and documented; MINI560 buck converter has margin or LD19 is moved to a dedicated rail

### LiDAR Driver & ROS2 Integration

- [x] **DRV-01**: `ldlidar_stl_ros2` driver packaged as a new `lidar` Docker service (base image, `network_mode: host` + `ipc: host` + `pid: host`, device mount `/dev/ttyLIDAR`), mirroring the existing `docker/gnss/` layout
- [x] **DRV-02**: `/scan` topic publishes `sensor_msgs/LaserScan` at a steady 10 Hz with sensor QoS (BEST_EFFORT, KEEP_LAST 5); `ros2 topic hz /scan` reports 10.0 ± 0.1 Hz
- [x] **DRV-03**: `base_link → laser_frame` static transform is published via `static_transform_publisher` in the nav launch file, with measured mount offsets (x/y/z and yaw) reflecting the LiDAR's position on the chassis; `frame_id: laser_frame` set on `/scan`
- [x] **DRV-04**: Angular sector mask / self-hit filter configured (via `laser_filters` or driver params) so chassis, wheels, and HAT regions inside the 360° FoV are excluded from published `/scan`
- [x] **DRV-05**: `lidar` service added to `docker-compose.yml` and starts cleanly alongside existing services; driver image tag is pinned (not `latest`)

### Web Visualization

- [ ] **VIZ-01**: 2D polar scan overlay rendered on `web/app/map/page.tsx` using a Canvas 2D component (`<ScanOverlay>`) reading from a Zustand `useScanStore`; scan points visible relative to the robot's base frame — **Core Value gate**
- [ ] **VIZ-02**: Browser subscribes to `/scan` via rosbridge with explicit `throttle_rate: 100` (ms), `compression: "cbor"`, and `queue_length: 1` to keep WebSocket load bounded
- [ ] **VIZ-03**: Connection/stale-scan status indicator on the map page turns red if no `/scan` message has arrived for >1.5 s; green otherwise
- [ ] **VIZ-04**: Foxglove layout file committed (e.g. `web/foxglove/mowerbot.foxglove-layout.json`) so users can point Foxglove Studio at the existing rosbridge endpoint and see `/scan` + `/odom` + `/fix` out of the box
- [ ] **VIZ-05**: Scan points are colored by distance (near = warm / far = cool) in the polar overlay as a readability enhancement

### GSD Initialization

- [ ] **META-01**: Existing MowerBot codebase formally adopted as the GSD brownfield baseline — PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, config.json all present and committed, codebase map preserved under `.planning/codebase/`

## v2 Requirements

Deferred to the next milestone. Tracked but not in current roadmap.

### Safety & Autonomy

- **SAFE-01**: Safety-watchdog node as sole publisher on `/cmd_vel`, gating `/cmd_vel_raw` from teleop based on `/scan`
- **SAFE-02**: Cluster-based forward-arc detection (±45°, N consecutive frames, K contiguous beams) with NaN-as-unknown semantics
- **SAFE-03**: Scan-stale fail-safe zeroes `/cmd_vel` if `/scan` stops
- **NAV-01**: Nav2 stack integration with LD19 as costmap input (future milestone)
- **SLAM-01**: slam_toolbox mapping over LD19 + odom (future milestone)

### Hardware

- **HW-V2-01**: HAT v2.1 PCB respin with dedicated LD19 header footprint
- **HW-V2-02**: Dedicated LiDAR mounting bracket above grass line (25–40 cm)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Safety auto-stop watchdog | User deferred explicitly — ship `/scan` + viz first, tune safety against real outdoor data in next milestone |
| Nav2 autonomous navigation | Depends on trusted `/scan` + costmaps + SLAM; premature this milestone |
| slam_toolbox / map building | Depends on stable `/scan` + odom TF tree; premature this milestone |
| 3D point-cloud rendering | LD19 is 2D; no value until a 3D sensor exists |
| Dynamic obstacle avoidance (steering) | That's Nav2's job — anti-feature for a first LiDAR milestone |
| Object classification (person/pet/tree) | Requires ML pipeline not warranted here |
| Blade/cutting kill-switch on `/scan` | Mowing actuation not implemented; would be safety theater |
| Geofencing via LiDAR | GNSS + RTK is the right sensor for geofencing |
| Multi-robot / fleet | Not a project goal |
| Cloud telemetry / remote access beyond LAN | Not a project goal |
| Custom LD19 driver | `ldlidar_stl_ros2` is manufacturer-maintained; reinventing is pure risk |
| `ros3djs` / `ros2djs` for web viz | Unmaintained, React-version-hostile; Canvas 2D is the right tool |
| miniUART (`ttyS0`) for LD19 | Baud clock jitters with CPU load at 230400 — will silently corrupt |
| `dtoverlay=uart2` | Collides with HAT ID EEPROM on GPIO0/1 |

## Traceability

Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| META-01 | Phase 0 | Pending |
| HW-01 | Phase 1 | Pending |
| HW-02 | Phase 1 | Pending |
| HW-03 | Phase 1 | Pending |
| HW-04 | Phase 1 | Pending |
| HW-05 | Phase 1 | Pending |
| DRV-01 | Phase 2 | Complete |
| DRV-02 | Phase 2 | Complete |
| DRV-03 | Phase 2 | Complete |
| DRV-04 | Phase 2 | Complete |
| DRV-05 | Phase 2 | Complete |
| VIZ-01 | Phase 3 | Pending |
| VIZ-02 | Phase 3 | Pending |
| VIZ-03 | Phase 3 | Pending |
| VIZ-04 | Phase 3 | Pending |
| VIZ-05 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-14*
*Last updated: 2026-04-14 — VIZ-03 threshold aligned to 1.5 s (matches CONTEXT D-09 + ROADMAP SC#3)*
