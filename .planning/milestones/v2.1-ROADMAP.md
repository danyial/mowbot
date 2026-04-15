# Roadmap: MowerBot — LD19 LiDAR Integration

**Milestone:** LD19 LiDAR Integration (brownfield)
**Defined:** 2026-04-14
**Granularity:** Standard
**Core Value gate:** Phase 3 — `/scan` visible as 2D polar overlay on web dashboard's map page.

## Phases

- [x] **Phase 0: GSD Brownfield Adoption** — Formalize existing MowerBot codebase as the GSD baseline (single-plan formality) (completed 2026-04-14)
- [ ] **Phase 1: Hardware & UART Routing** — Land LD19 on a dedicated Pi 4 PL011 UART without breaking the existing ESP32 HAT link
- [ ] **Phase 2: LiDAR Driver & `/scan` Publication** — Containerize `ldlidar_stl_ros2`, publish `sensor_msgs/LaserScan` at 10 Hz with correct TF + QoS
- [ ] **Phase 3: Web Visualization — `/scan` on the Map Page** — Render 2D polar scan overlay on `map/page.tsx` via throttled CBOR rosbridge (Core Value gate)
- [ ] **Phase 4: Live Mapping with slam_toolbox** — Containerize `slam_toolbox`, publish `/map` occupancy grid from `/scan` (scan-matching without wheel odom), render live on `/lidar`

## Phase Details

### Phase 0: GSD Brownfield Adoption
**Goal**: Formally adopt the existing MowerBot codebase as the GSD-managed brownfield baseline so subsequent phases execute inside the GSD workflow.
**Depends on**: Nothing (first phase)
**Requirements**: META-01
**Success Criteria** (what must be TRUE):
  1. `.planning/PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, and `config.json` all exist, are committed, and reflect the LD19 milestone.
  2. `.planning/codebase/` artifacts (ARCHITECTURE, STACK, STRUCTURE, CONCERNS, CONVENTIONS, INTEGRATIONS, TESTING) are preserved and referenced by the roadmap.
  3. A human reading `.planning/PROJECT.md` can identify the core value (LD19 → `/scan` → web map), v1 scope, and explicit out-of-scope items (Nav2/SLAM/safety watchdog) without reading any other file.
**Plans:** 1/1 plans complete
- [x] 00-01-PLAN.md — Verify Phase 0 criteria, write ADOPTION.md receipt, update STATE.md, commit, and place annotated tag `gsd-baseline-v0`

### Phase 1: Hardware & UART Routing
**Goal**: LD19 is electrically reachable from the Pi 4 on a stable device path with a dedicated PL011 UART, and every existing HAT/ESP32 function still works.
**Depends on**: Phase 0
**Requirements**: HW-01, HW-02, HW-03, HW-04, HW-05
**Success Criteria** (what must be TRUE):
  1. `dtoverlay=uart3` is committed to `/boot/firmware/config.txt` (plus `disable-bt` if required); after reboot `ls /dev/ttyAMA*` shows a new PL011 node distinct from `ttyAMA0`.
  2. `ls -l /dev/ttyLIDAR` resolves via `udev/99-mower.rules` to the LD19's UART consistently across three consecutive reboots.
  3. `picocom -b 230400 /dev/ttyLIDAR` with LD19 powered shows valid `0x54 0x2C` packet headers in the byte stream.
  4. Regression check: after all boot-config changes, `ros2 topic echo /odom` (from inside the `nav` container) shows live encoder data from the ESP32 over `ttyAMA0` — the HAT link is unchanged.
  5. Measured 5V rail voltage at the LD19 feed point stays ≥ 4.85 V under simultaneous motor-startup transient + LD19 steady draw; the measurement and decision (shared MINI560 rail vs. dedicated rail) are committed to `docs/`.
**Plans:** 1 plan
- [ ] 01-01-PLAN.md — Add dtoverlay=uart3, wire LD19 pigtail (pins 29/30/9/2), bind /dev/ttyLIDAR via udev KERNELS==fe201600.serial, measure 5V rail under motor transient, regression-check ESP32 /odom

### Phase 2: LiDAR Driver & `/scan` Publication
**Goal**: A new `lidar` Docker service publishes a clean, correctly-framed `sensor_msgs/LaserScan` on `/scan` at steady 10 Hz, discoverable by every other ROS2 container on the host.
**Depends on**: Phase 1
**Requirements**: DRV-01, DRV-02, DRV-03, DRV-04, DRV-05
**Success Criteria** (what must be TRUE):
  1. `docker compose up lidar` (on top of the existing stack) brings the service to healthy; image tag is pinned (not `latest`) and the container runs with `network_mode: host` + `ipc: host` + `pid: host` + `/dev/ttyLIDAR` device mount, mirroring `docker/gnss/`.
  2. `ros2 topic hz /scan` reports 10.0 ± 0.1 Hz for at least 60 seconds with no gaps, and `ros2 topic info /scan --verbose` shows `BEST_EFFORT` + `KEEP_LAST 5` sensor QoS on the publisher.
  3. `ros2 run tf2_ros tf2_echo base_link laser_frame` returns the measured static transform (x/y/z and yaw documented in launch file) without errors; `/scan` messages carry `frame_id: laser_frame`.
  4. A scan captured with a known asymmetric test obstacle (e.g., wall on the robot's left only) shows returns on the correct hemisphere when viewed via `ros2 topic echo /scan --once` (angle convention and `laser_scan_dir` validated).
  5. Chassis / wheel / HAT self-hits inside the 360° FoV are absent from `/scan` — the configured angular sector mask or self-hit filter is visible in the driver's launch params and produces no hits in masked sectors under a stationary indoor test.
**Plans:** 1 plan
- [x] 02-01-PLAN.md — Two-commit sequence: (A) retrofit ipc:host+pid:host on x-ros-common anchor with 12-row regression gate across existing services; (B) add pinned ldlidar_stl_ros2 Docker service (SHA bf668a8 + SensorDataQoS sed-patch), launch.py with base_link→laser_frame zero-placeholder TF, docker-compose lidar entry, and docs/lidar-mount.md measurement procedure

### Phase 3: Web Visualization — `/scan` on the Map Page
**Goal**: An operator opens the dashboard, navigates to the map page, and sees the LD19's live scan as a 2D polar overlay on the robot — the Core Value gate for this milestone.
**Depends on**: Phase 2
**Requirements**: VIZ-01, VIZ-02, VIZ-03, VIZ-04, VIZ-05
**Success Criteria** (what must be TRUE):
  1. After `docker compose up` on a fresh host, a browser loading the dashboard's `/map` page sees a live 360° polar scan overlay around the robot position, rendered to a Canvas 2D `<ScanOverlay>` component fed by a new `useScanStore` Zustand store — **Core Value gate**.
  2. The browser's rosbridge subscribe call for `/scan` uses `throttle_rate: 100`, `compression: "cbor"`, and `queue_length: 1`; verified in Chrome DevTools the WebSocket buffered amount does not grow during a 5-minute session with two simultaneous browser clients.
  3. A connection/stale-scan indicator on the map page turns red within 1.5 s of the `lidar` container being stopped and returns to green within 1.5 s of it restarting.
  4. A Foxglove layout file committed at `web/foxglove/mowerbot.foxglove-layout.json` opens in Foxglove Studio against the existing rosbridge endpoint and shows `/scan`, `/odom`, and `/fix` panels populated with live data.
  5. Scan points on the overlay are colored on a distance gradient (near = warm, far = cool); the legend or a range-ring annotation makes this readable without a manual.
**Plans:** 2 plans
- [ ] 03-01-PLAN.md — Commit A: global CBOR retrofit on ROSLIB.Topic + conditional server.mjs binary-frame guard + 5-topic regression gate
- [ ] 03-02-PLAN.md — Commit B: /scan pipeline (LaserScan type, useScanStore, TOPICS.SCAN, ScanOverlay canvas with viridis + stale badge + legend, Foxglove layout, integration docs)
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. GSD Brownfield Adoption | 1/1 | Complete   | 2026-04-14 |
| 1. Hardware & UART Routing | 0/1 | Not started | - |
| 2. LiDAR Driver & `/scan` Publication | 0/0 | Not started | - |
| 3. Web Visualization — `/scan` on the Map Page | 2/2 | Human needed (outdoor SC#1) | 2026-04-14 |
| 4. Live Mapping with slam_toolbox | 0/0 | Not planned | - |

## Coverage

- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

## Dependency Chain

```
Phase 0 (META)  →  Phase 1 (Hardware/UART)  →  Phase 2 (Driver/TF/QoS)  →  Phase 3 (Web viz, Core Value)  →  Phase 4 (Live Mapping)
```

Hard linear sequence. No parallelization across phases in this milestone:
- Phase 2 cannot begin without `/dev/ttyLIDAR` from Phase 1 (no stable port = no driver testing).
- Phase 3 cannot begin without `/scan` from Phase 2 (nothing to visualize).
- Phase 4 cannot begin without `/scan` + web viz infrastructure from Phase 3 (slam input + render target).

## Explicitly Deferred (Not in this Roadmap)

Per PROJECT.md Out of Scope — re-evaluate at next milestone, do not add phases for these now:
- Safety auto-stop watchdog (`/cmd_vel` gating on `/scan`) — deferred; needs real outdoor scan data to tune thresholds.
- Nav2 autonomous navigation — deferred; depends on trusted `/scan` + costmaps.
- HAT v2.1 PCB respin with dedicated LD19 connector footprint — deferred to v2; pigtail on HAT v2.0 suffices for this milestone.

*(`slam_toolbox` map building moved into the roadmap as Phase 4 on 2026-04-15.)*

### Phase 4: Live Mapping with slam_toolbox

**Goal**: A new `slam` Docker service runs `slam_toolbox`'s `online_async_slam_toolbox_node` consuming `/scan` + `/odometry/filtered`, publishes a live `nav_msgs/OccupancyGrid` on `/map` with a correct `map → odom` TF, and the web `/lidar` page renders the occupancy grid as a bitmap underneath the scan overlay — operator sees "everything the robot has seen so far, stitched together" without needing RViz or Foxglove.

**Depends on:** Phase 3
**Requirements**: MAP-01, MAP-02, MAP-03, MAP-04, MAP-05
**Success Criteria (what must be TRUE):**
  1. `docker compose up slam` brings up `slam_toolbox` in async mode; `ros2 topic hz /map` shows updates at ≥ 0.5 Hz under indoor scan; `ros2 topic echo /map --once` returns a populated `nav_msgs/OccupancyGrid`.
  2. TF tree contains `map → odom → base_link → laser_frame` without warnings under `ros2 run tf2_tools view_frames`; the `map → odom` transform is published by slam_toolbox, not static.
  3. Operator opens `/lidar` page; within 5 s the occupancy bitmap is drawn under the live scan overlay, persists after `/scan` stops (unlike the current overlay), and clears after pressing "Reset Map".
  4. Scan-matching fallback: with the robot physically stationary indoors for 60 s, the map does NOT drift — pose covariance stays bounded; verified by map center staying within ±5 cm of a reference wall in the bitmap.
  5. When ESP32 `/odom` publisher ships later (HW-04 todo), dropping real wheel odom into the EKF input stream requires zero web-side changes — documented and sanity-checked.

**Scope notes:**
- Relies on slam_toolbox's scan-matching to estimate motion without wheel odom — works best indoors at slow speed. Later when firmware `/odom` ships (separate HW-04 todo), SLAM quality improves automatically, web layer unchanged.
- Preserve existing `/lidar` zoom/pan/reset UX from quicks `260414-w8p` + `260415-9ww`.
- Honest v0 limitation: no loop closure in async mode — accumulated drift on long trajectories expected.

**Plans:** 2 plans
- [ ] 04-01-PLAN.md — slam_toolbox Docker service + project params YAML (base_link, do_loop_closing:false, use_sim_time:=false) + compose wire-up + MAP-01..MAP-05 in REQUIREMENTS.md; SSH-verified /map + TF tree + stationary no-drift
- [ ] 04-02-PLAN.md — Web: OccupancyGrid types + TOPICS.MAP (1 Hz CBOR) + useMapStore + callSlamReset service + MapBitmap component (offscreen putImageData) layered under ScanCanvas on /lidar + Eraser reset button; zero regressions on /map or /lidar UX

---
*Roadmap defined: 2026-04-14*
