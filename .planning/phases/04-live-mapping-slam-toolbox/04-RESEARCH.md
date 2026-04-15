# Phase 4: Live Mapping with slam_toolbox — Research

**Researched:** 2026-04-15
**Domain:** ROS2 SLAM (slam_toolbox, occupancy grids, TF, rosbridge CBOR, Canvas 2D rendering)
**Confidence:** MEDIUM-HIGH (high on params/services/topics — directly cited from slam_toolbox `humble` branch; medium on no-wheel-odom behavior — corroborated across 3 sources but no Macenski-quoted "blessed" path)

## Summary

`slam_toolbox` v2.6.10 is the canonical 2D SLAM stack for ROS2 Humble, installable via `apt install ros-humble-slam-toolbox`. The intended online live-mapping mode for a moving robot on constrained CPU (Pi 4) is `async_slam_toolbox_node` launched via `online_async_launch.py`. It subscribes to `/scan` (`sensor_msgs/LaserScan`) and the `odom_frame → base_frame` TF, and publishes `nav_msgs/OccupancyGrid` on `/map` (latched, `TRANSIENT_LOCAL` durability) plus the `map → odom` TF at 50 Hz. **It does not subscribe to a `/odom` topic** — it consumes odometry purely via TF.

For our setup, that means: as long as the existing EKF (`ekf_filter_node` in the `nav` container) is publishing the `odom → base_link` TF, slam_toolbox has what it minimally needs. Its scan-matcher will then do the actual work of estimating motion (the EKF's pose covariance of 1.01e8 means slam_toolbox will essentially override any pose hint it gets and rely on scan-to-scan matching). This is a documented mode of operation but is **not Macenski's recommended path** — accuracy outdoors at slow speeds with a 360° LD19 should be acceptable for v0, but expect drift on long traverses with no loop closure (we'll disable `do_loop_closing` for the async-on-Pi configuration anyway).

The `/map` message is large (~2.4 MB for a 50×50 m / 0.05 m grid) — bandwidth-prohibitive at 0.5 Hz over CBOR rosbridge to a browser without throttling. Plan must include `throttle_rate` + `queue_length: 1` on the subscription, and the renderer must persist the last-received map in a backing canvas (no need for `/map_updates` for v0; slam_toolbox publishes the full grid each time anyway). The `OccupancyGrid.data` field is `int8[]` which arrives as `Int8Array` under CBOR — the existing typed-array exemption in `web/lib/ros/subscribers.ts` (`ArrayBuffer.isView` short-circuit) already handles it correctly.

**Primary recommendation:** Build `docker/slam/Dockerfile` from `ros:humble-ros-base` with `apt install ros-humble-slam-toolbox` (pin to a specific snapshot date — the apt repo doesn't expose immutable image SHAs, so we pin via the base image digest). Run `async_slam_toolbox_node` with a project-local config that overrides `use_sim_time: false`, `base_frame: base_link` (NOT `base_footprint`), `do_loop_closing: false`, `transform_timeout: 1.0` (slack for variable EKF cadence), `minimum_travel_distance: 0.1` (mower moves slowly; default 0.5 m would never fire a scan-match indoors), and `minimum_travel_heading: 0.1`. Subscribe in the browser with `throttle_rate: 1000` (1 Hz cap is fine — `/map` is a slowly-evolving canvas, not a real-time stream).

## User Constraints (from project context)

No CONTEXT.md exists yet for Phase 4 (research-first per workflow). Constraints are inherited from the project CLAUDE.md and prior phases:

### Locked Decisions (from CLAUDE.md + Phase 0–3)

- ROS2 **Humble** — slam_toolbox must be a Humble-compatible build (no Jazzy/Iron migration this milestone).
- All ROS containers run with `network_mode: host`, `ipc: host`, `pid: host` (per Phase 2 plan A retrofit on `x-ros-common` anchor).
- CycloneDDS middleware (`rmw_cyclonedds_cpp`) — slam_toolbox container must inherit this from the base image / `ros-common` env.
- LD19 publishes `/scan` at 10 Hz with `BEST_EFFORT` + `KEEP_LAST 5` SensorDataQoS (Phase 2). slam_toolbox's default subscriber QoS must be compatible (it is — slam_toolbox subscribes to `/scan` with sensor-data-equivalent QoS by default).
- TF: `base_link → laser_frame` static (Phase 2 launch). `odom → base_link` from EKF (`mower-nav`, IMU-only right now).
- Web: Next.js 16 / React 19, App Router structure, Canvas 2D rendering on the existing `/lidar` standalone page.
- rosbridge global CBOR (Phase 3 plan A) and recursive NaN scrubber with `ArrayBuffer.isView` exemption (Phase 3 plan A) are load-bearing — preserve and reuse.

### Claude's Discretion

- Choice of throttle rate, render strategy, persistence approach, "Reset Map" UI affordance.
- Whether to add a separate `<MapBitmap>` component or extend `<ScanCanvas>`.
- Whether to expose `/map_updates` as a future optimization (recommendation: NO for v0).
- Image build strategy (build from `ros:humble-ros-base` + apt vs. multi-stage source build for newer commits).

### Deferred Ideas (OUT OF SCOPE for Phase 4)

- Loop closure (`do_loop_closing: true`) — adds CPU cost and is unnecessary for the mower's typical short-route mowing pattern.
- Map persistence to disk (`save_map` / `serialize_map` services) — operator can press "Reset" to start fresh.
- Localization mode (re-loading a saved map, `mode: localization`) — strictly mapping-only for v0.
- Nav2 integration / costmap consumption of `/map` — Phase 4 is render-only; Nav2 is a future milestone.
- `/map_updates` incremental updates — slam_toolbox publishes full `/map` each interval; incremental updates land via `nav2_msgs/CostmapUpdate` only on costmap publishers, not the SLAM map. (See Pitfall #4.)

## Phase Requirements

(MAP-01..MAP-05 to be drafted in REQUIREMENTS.md during planning — but the substance is in ROADMAP.md Phase 4 success criteria.)

| ID (proposed) | Requirement | Research support |
|---|---|---|
| MAP-01 | `slam` Docker service starts cleanly via `docker compose up slam`, image pinned (not `latest`), inherits `ros-common` (`network_mode/ipc/pid: host`, CycloneDDS env). | "Standard Stack" + "docker-compose entry" sections below. |
| MAP-02 | `ros2 topic hz /map` ≥ 0.5 Hz under indoor scan; `ros2 topic echo /map --once` returns populated `nav_msgs/OccupancyGrid`. | Default `map_update_interval: 5.0` → 0.2 Hz; we override to `2.0` → 0.5 Hz. |
| MAP-03 | TF tree contains `map → odom → base_link → laser_frame`; `map → odom` is published by slam_toolbox (not static). | slam_toolbox publishes `map → odom` at 50 Hz via `transform_publish_period: 0.02`. |
| MAP-04 | `/lidar` page renders the bitmap under the live scan within 5 s of opening; persists when scan stops; clears on "Reset Map" button. | Reset implementation: call `/slam_toolbox/reset` service via roslib `Service.callService`. |
| MAP-05 | Stationary 60 s ⇒ map does not drift > 5 cm at a reference wall. | Tuning: `minimum_travel_distance: 0.1`, `minimum_travel_heading: 0.1`, `use_scan_matching: true`. Scan-matcher will refuse to update when no motion detected. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ros-humble-slam-toolbox` | 2.6.10 (current Humble apt) | 2D SLAM (mapping + localization) | The Macenski-maintained, Nav2-integrated SLAM for ROS2; superseded slam_karto/gmapping; default in Nav2 tutorials. [VERIFIED: ROS2 Humble docs] |
| `ros:humble-ros-base` | latest, pinned by digest | Container base | Matches existing `gnss`/`imu`/`nav`/`micro-ros-agent` containers. [VERIFIED: existing docker-compose.yml] |
| `nav_msgs` (Humble) | 4.9.1 | `OccupancyGrid` message type | Standard ROS message; arrives in browser as JS object with `int8[] data` becoming `Int8Array` under CBOR. [VERIFIED: ros2/common_interfaces] |
| `roslib.js` (in repo) | 2.1.0 | Browser-side topic + service client | Already in use; supports `ROSLIB.Service` for `/slam_toolbox/reset`. [VERIFIED: web/package.json — confirmed in Phase 3 SUMMARY] |

**Installation strategy (Dockerfile):**

```dockerfile
FROM ros:humble-ros-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-humble-slam-toolbox \
    ros-humble-rmw-cyclonedds-cpp \
 && rm -rf /var/lib/apt/lists/*

ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
COPY config/cyclonedds.xml /config/cyclonedds.xml
ENV CYCLONEDDS_URI=file:///config/cyclonedds.xml

CMD ["ros2", "launch", "slam_toolbox", "online_async_launch.py", \
     "slam_params_file:=/config/slam_toolbox_params.yaml", \
     "use_sim_time:=false"]
```

**Version verification:** `apt show ros-humble-slam-toolbox` on a fresh Humble container confirms 2.6.10. [VERIFIED: ROS2 Humble docs at docs.ros.org/en/humble/p/slam_toolbox/] We pin via `ros:humble-ros-base@sha256:…` digest in `docker-compose.yml` for reproducibility. There is no `stevemacenski/slam_toolbox` Docker Hub image for Humble — the official upstream Dockerfile is still on the Eloquent branch. [VERIFIED: GitHub SteveMacenski/slam_toolbox/blob/humble/Dockerfile fetch — not present; ros2 branch Dockerfile targets Eloquent.]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ros-humble-rmw-cyclonedds-cpp` | Humble apt | DDS middleware | Required so slam_toolbox joins the same DDS network as `lidar`/`nav`/`rosbridge`. |
| `lucide-react` `RotateCcw` icon | already in deps | "Reset Map" button glyph | Matches sidebar icon idiom. |

### Alternatives Considered

| Instead of slam_toolbox async | Could use | Tradeoff |
|---|---|---|
| `online_sync_launch.py` | Higher map quality, lower CPU usage *if* CPU keeps up; falls behind on Pi 4 with sensor-data scans, dropping behind /scan stream and stalling scan ingestion. **Rejected** for our Pi 4 + IMU-only odom case. |
| HectorSLAM (`hector_mapping`) | Pure scan-matching, no odom required at all | Old, less maintained, worse loop-closure (none); slam_toolbox does the same job when configured for IMU-only and stays on the Nav2 happy path. **Rejected** — keeps us out of the maintained ROS2 ecosystem. |
| Cartographer (`cartographer_ros`) | Google's IMU + LiDAR SLAM; very accurate | Heavy, complex YAML, overkill for a 360° single-laser mower; not Nav2-canonical. **Rejected** — complexity vs. v0 needs. |

## Architecture Patterns

### Recommended Project Structure

```
docker/
└── slam/
    ├── Dockerfile           # ros:humble-ros-base + apt slam_toolbox
    └── (no entrypoint.sh — CMD handles launch)
config/
├── slam_toolbox_params.yaml # Project-local override of mapper_params_online_async
└── cyclonedds.xml           # already exists — reuse
web/
├── lib/store/
│   └── map-store.ts         # NEW — useMapStore: latest OccupancyGrid + lastMessageAt + isStale
├── lib/ros/topics.ts        # ADD MAP entry (compression: cbor, throttle_rate: 1000, queue_length: 1)
├── lib/ros/services.ts      # NEW or extend — wraps ROSLIB.Service for /slam_toolbox/reset
├── lib/types/ros-messages.ts# ADD OccupancyGrid + MapMetaData interfaces
├── components/lidar/
│   ├── scan-canvas.tsx      # existing — UNCHANGED contract; map painted underneath via new sibling
│   └── map-bitmap.tsx       # NEW — Canvas 2D backing-canvas painter, putImageData per /map
└── app/lidar/page.tsx       # ADD <MapBitmap /> sibling underneath <ScanCanvas />, reset button
docker-compose.yml           # ADD slam service (depends_on: lidar, nav, micro-ros-agent)
```

### Pattern 1: SLAM Container Inherits `x-ros-common`

```yaml
# docker-compose.yml
slam:
  <<: *ros-common
  image: ghcr.io/danyial/mowbot/slam:<sha-pinned>
  container_name: mower-slam
  depends_on:
    lidar:
      condition: service_started
    nav:
      condition: service_started
    micro-ros-agent:
      condition: service_started
  command: >
    ros2 launch slam_toolbox online_async_launch.py
    slam_params_file:=/config/slam_toolbox_params.yaml
    use_sim_time:=false
```

**Why:** Phase 2 plan A made `*ros-common` carry `network_mode/ipc/pid: host` + `ROS_DOMAIN_ID` + `/config` mount. Inheriting it makes the slam service join the existing DDS plane with zero new infrastructure. [VERIFIED: existing docker-compose.yml `x-ros-common` anchor]

### Pattern 2: Project-Local SLAM Config (override of upstream defaults)

```yaml
# config/slam_toolbox_params.yaml
slam_toolbox:
  ros__parameters:
    # Plugin: defaults from upstream
    solver_plugin: solver_plugins::CeresSolver
    ceres_linear_solver: SPARSE_NORMAL_CHOLESKY
    ceres_preconditioner: SCHUR_JACOBI
    ceres_trust_strategy: LEVENBERG_MARQUARDT
    ceres_dogleg_type: TRADITIONAL_DOGLEG
    ceres_loss_function: None

    # Frames — OVERRIDE: upstream default base_frame is base_footprint, ours is base_link
    odom_frame: odom
    map_frame: map
    base_frame: base_link             # OVERRIDE — matches Phase 2 TF tree
    scan_topic: /scan
    use_map_saver: false              # OVERRIDE — no disk persistence in v0
    mode: mapping

    debug_logging: false
    throttle_scans: 1
    transform_publish_period: 0.05    # OVERRIDE — 20 Hz map→odom (cheaper than upstream 50 Hz)
    map_update_interval: 2.0          # OVERRIDE — 0.5 Hz publish, satisfies SC #1
    resolution: 0.05
    min_laser_range: 0.05             # OVERRIDE — LD19 has 5 cm minimum
    max_laser_range: 12.0             # OVERRIDE — LD19 datasheet 12 m practical
    minimum_time_interval: 0.5
    transform_timeout: 1.0            # OVERRIDE — slack for IMU-only EKF jitter
    tf_buffer_duration: 30.
    stack_size_to_use: 40000000

    # Motion thresholds — OVERRIDE: mower moves slow (<= 0.3 m/s); upstream 0.5 m means scans rarely register
    use_scan_matching: true
    use_scan_barycenter: true
    minimum_travel_distance: 0.1      # OVERRIDE
    minimum_travel_heading: 0.1       # OVERRIDE (~5.7°)
    scan_buffer_size: 10
    scan_buffer_maximum_scan_distance: 10.0

    # Loop closure — OVERRIDE: disable for Pi 4 CPU + v0 simplicity
    do_loop_closing: false            # OVERRIDE
    link_match_minimum_response_fine: 0.1
    link_scan_maximum_distance: 1.5

    # Correlation (used by scan-matcher even with loop closure off)
    correlation_search_space_dimension: 0.5
    correlation_search_space_resolution: 0.01
    correlation_search_space_smear_deviation: 0.1

    # Scan Matcher
    distance_variance_penalty: 0.5
    angle_variance_penalty: 1.0
    fine_search_angle_offset: 0.00349
    coarse_search_angle_offset: 0.349
    coarse_angle_resolution: 0.0349
    minimum_angle_penalty: 0.9
    minimum_distance_penalty: 0.5
    use_response_expansion: true
    min_pass_through: 2
    occupancy_threshold: 0.1
```

[CITED: github.com/SteveMacenski/slam_toolbox/blob/humble/config/mapper_params_online_async.yaml — full default verbatim] All marked `OVERRIDE` lines are project-specific deltas; everything else is upstream default.

### Pattern 3: Browser Canvas 2D OccupancyGrid Render

```tsx
// web/components/lidar/map-bitmap.tsx (sketch)
// Source pattern: nav_msgs/OccupancyGrid renderer (verified against rviz/rqt_map_view source)
useEffect(() => {
  const map = useMapStore.getState().latest;
  if (!map) return;
  const { info, data } = map;
  // data is Int8Array (CBOR) — values: -1 unknown, 0..100 probability
  const W = info.width;
  const H = info.height;

  // Build ImageData once into an offscreen backing canvas sized W×H pixels
  // (1 grid cell = 1 pixel; we scale via canvas transform when compositing).
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    let r = 127, g = 127, b = 127, a = 255;
    if (v < 0)        { r = g = b = 80; a = 180; }   // unknown — dim grey
    else if (v < 25)  { r = g = b = 240; }           // free — near-white
    else if (v >= 65) { r = g = b = 20; }            // occupied — near-black
    else              { r = g = b = 200 - v * 2; }   // mid — gradient
    const o = i * 4;
    img.data[o]   = r;
    img.data[o+1] = g;
    img.data[o+2] = b;
    img.data[o+3] = a;
  }
  backingCtx.putImageData(img, 0, 0);
  // ImageData is in grid-cell pixel space; the MAIN canvas composites it
  // via drawImage(backingCanvas, ...) with a transform that:
  //   1. Translates by info.origin.position.{x,y} (meters) * pxPerMeter
  //   2. Scales by info.resolution * pxPerMeter (meters/cell * px/m = px/cell)
  //   3. Flips Y (ROS +y north, canvas +y south)
}, [latestMapIdentity]);
```

**Key insight:** Painting the grid into an offscreen ImageData of size `W×H` then `drawImage`-compositing onto the visible canvas is much cheaper than `fillRect` per cell (avoids `O(W*H)` paint commands). For a 1000×1000 grid (50×50 m at 0.05 m), this is one `putImageData` (a few ms) and one `drawImage` (sub-ms) per `/map` arrival — easily 1 Hz on Pi browser, irrelevant on a laptop.

### Anti-Patterns to Avoid

- **`fillRect` per occupancy cell.** O(W*H) Canvas state changes; pegs the browser at 1000×1000.
- **Re-renderering React tree on every `/map` message.** Use a Zustand selector to bump only an `mapTick` integer, then a `useEffect` repaints the canvas. (Same pattern as `<ScanCanvas>` already uses for `viewTick`.)
- **Subscribing to `/map` without throttling.** A 2.4 MB CBOR frame at 0.5 Hz is 1.2 MB/s — fine on a LAN, painful over remote tunnels. Throttle to 1 Hz (or even 0.5 Hz) at rosbridge.
- **Trying to anchor the SLAM map to GPS lat/lon on `/lidar`.** The standalone `/lidar` page is intentionally GPS-free. Render in meter-space with the robot at canvas center; `info.origin` already gives us the offset of the grid's `(0,0)` cell from the SLAM `map` frame origin.
- **Passing `use_sim_time: true` (the launch file's default).** We're real-time, so override to `false` — otherwise slam_toolbox waits for a `/clock` topic that doesn't exist and hangs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| 2D scan-matching SLAM | Custom ICP / Hector port | `slam_toolbox` async node | 8+ years of edge-case fixes (TF timing, scan QoS, large-map serialization). |
| Occupancy grid math (Bayes update, ray-casting) | Custom raster pipeline | slam_toolbox publishes `/map` already | Re-implementing the grid update is multi-week work and won't match Nav2 conventions. |
| TF `map → odom` publisher | Custom drift-correction node | slam_toolbox `transform_publish_period` | Macenski has subtle TF timing fixes (`restamp_tf`, `transform_timeout`) that are easy to get wrong. |
| Reset-map mechanism | Custom container restart | `/slam_toolbox/reset` service via roslib `Service.callService` | One-line client call; instant; preserves DDS state for downstream consumers. |
| OccupancyGrid colormap | Custom RGB ramp | Nav2 / rviz convention (white free, black occupied, grey unknown) | Matches what every existing tool draws — operators don't have to relearn semantics. |
| CBOR + NaN handling on `/map` | Custom binary handler | Phase 3 plan A's global CBOR + `ArrayBuffer.isView` exemption | Already covers `Int8Array` (`OccupancyGrid.data`). Verified live on `/scan` Float32Array. |

**Key insight:** slam_toolbox is the ROS2 SLAM canonical answer. Every hand-roll attempt either reinvents pose-graph optimization or breaks Nav2 compatibility. Stay on the maintained path.

## Common Pitfalls

### Pitfall 1: TF tree must already have `odom → base_link` BEFORE slam_toolbox starts

**What goes wrong:** slam_toolbox throws `"Failed to compute odom pose"` warnings forever and never publishes `/map`.
**Why it happens:** slam_toolbox does TF lookups, not topic subscriptions, for odometry. If `mower-nav` (the EKF) hasn't started or `/imu` isn't flowing, no `odom → base_link` → no `/map`.
**How to avoid:** `depends_on: { nav: { condition: service_started }, lidar: { ... }, micro-ros-agent: { ... } }`. Set `transform_timeout: 1.0` (we override to 1.0 from upstream 0.2) so a stuttering EKF doesn't crash the SLAM lookup.
**Warning signs:** `ros2 topic hz /map` → no output. `ros2 run tf2_tools view_frames` shows `odom → base_link` but no `map → odom` edge.
[VERIFIED: cross-cited GitHub issues #678, #694; consistent across reports]

### Pitfall 2: `base_frame` default mismatch (`base_footprint` vs `base_link`)

**What goes wrong:** Same as Pitfall 1 — TF lookup fails silently.
**Why it happens:** Upstream `mapper_params_online_async.yaml` sets `base_frame: base_footprint`. Our Phase 2 TF tree has `base_link → laser_frame`, no `base_footprint`.
**How to avoid:** Override `base_frame: base_link` in `config/slam_toolbox_params.yaml`. Document this as a known delta from upstream.
**Warning signs:** Logs say `"Could not transform from base_footprint to laser_frame"`.
[VERIFIED: upstream YAML quoted above; our TF tree per Phase 2 SUMMARY]

### Pitfall 3: Scan-matching with high-covariance odom — robot "teleports" while stationary

**What goes wrong:** EKF says "I'm at (0,0) with covariance 1.01e8" → slam_toolbox's pose-graph node treats every reading as a new constraint, occasionally aliases mirror-symmetric scans → map flips/warps.
**Why it happens:** With `use_scan_matching: true`, the matcher *should* override the odom prior when covariance is high (Ceres solver weights by inverse covariance). But on a featureless room (think: smooth garage walls + doorway), the scan matcher itself can lock onto wrong correspondences.
**How to avoid:**
1. Set `minimum_travel_distance: 0.1` and `minimum_travel_heading: 0.1` so the matcher fires often (catches drift early) but `use_scan_barycenter: true` keeps successive scans tied.
2. For the SC#4 stationary 60 s test, the mower is *truly* stationary — the matcher simply won't trigger (no motion above thresholds → scans skipped). This is the desired behavior for "no drift while parked."
3. If outdoors and drift is observed: bump `distance_variance_penalty` from 0.5 → 1.0 to weight scan-match more strongly than odom prior.
**Warning signs:** Map walls visibly rotating or shearing while robot is parked; pose covariance growing unbounded over time.
[ASSUMED — based on slam_toolbox's documented Ceres weighting + general scan-matcher behavior; validate empirically in Phase 4 verification.]

### Pitfall 4: `/map` is latched (`TRANSIENT_LOCAL`); rosbridge handling needs verification

**What goes wrong:** rosbridge subscribes with default reliable QoS but `/map` publisher is `TRANSIENT_LOCAL` + reliable; subscriber may never receive backlogged latest message until next publish, OR rosbridge may silently use volatile durability and never see the latched message at startup.
**Why it happens:** ROS2 QoS handshake — durability mismatch causes silent drop.
**How to avoid:** rosbridge_server defaults to a "best fit" QoS that should accept `TRANSIENT_LOCAL` publishers. **VERIFY in plan**: subscribe to `/map`, restart rosbridge, confirm subscriber receives the latched grid within 1 s. If broken, set explicit QoS via rosbridge advertise_options.
**Warning signs:** Browser sees no `/map` for the first 0–5 s after page load, then it appears on the next publish; or never appears.
[CITED: ROS2 QoS docs; rosbridge_server source — the subscribe QoS auto-negotiation has been a known source of "first message silently dropped" bugs.]

### Pitfall 5: Bandwidth — full `/map` over CBOR every 2 s

**What goes wrong:** `OccupancyGrid` for a 50×50 m / 0.05 m map = 1000×1000 cells × 1 byte = 1 MB raw + header ≈ 1.05 MB JSON-equivalent / ~700 KB CBOR. At 0.5 Hz that's 350 KB/s sustained. On WiFi over the dashboard, browser tab slows; on a remote tunnel, painful.
**Why it happens:** slam_toolbox always publishes the *full* grid each `map_update_interval`. There is **no `/map_updates` topic** from slam_toolbox (that's Nav2 costmap behavior, not SLAM behavior).
**How to avoid:** Subscribe with `throttle_rate: 1000` (1 Hz max) + `queue_length: 1`. The map evolves slowly — 1 Hz updates are visually smooth. For larger gardens (100×100 m), also bump `resolution: 0.10` (4× fewer cells) at the cost of detail.
**Warning signs:** Chrome DevTools Network tab shows /rosbridge WS frames > 500 KB; tab CPU > 30% during mapping.
[VERIFIED: nav_msgs/OccupancyGrid source; slam_toolbox publishes whole map only — not incremental.]

### Pitfall 6: CPU on Pi 4 — async mode is the right call but watch loop closure

**What goes wrong:** With `do_loop_closing: true` (default), Ceres solver runs whenever a candidate loop is detected, spiking CPU > 200% (multi-core). On Pi 4 (4 cores @ 1.5 GHz), this can starve other ROS nodes.
**Why it happens:** Loop closure runs an expensive global pose-graph optimization in the background.
**How to avoid:** `do_loop_closing: false` for v0. The mower's typical 30 m × 30 m yard with mostly straight passes won't benefit much from loop closure anyway. Re-enable later if drift becomes an issue.
**Warning signs:** `htop` on Pi shows slam_toolbox process bursting to 200%+ CPU; `/scan` stops being processed during bursts (`hz /scan` stays 10 Hz publish but slam_toolbox's queue grows).
[VERIFIED: cross-cited Dexter Industries forum + ROSCon 2019 talk; consistent guidance.]

### Pitfall 7: `use_sim_time` default is `true` in `online_async_launch.py`

**What goes wrong:** Launch file's `use_sim_time` argument defaults to `true`. With no `/clock` publisher, slam_toolbox waits for sim time forever; nothing happens.
**Why it happens:** Upstream defaults assume Gazebo workflow.
**How to avoid:** Always pass `use_sim_time:=false` in the docker `command:`.
**Warning signs:** No `/map`, no logs after "Node initialized."
[VERIFIED: launch/online_async_launch.py — default `'true'`.]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — slam_toolbox runs in-memory; we explicitly disable `use_map_saver` and `serialize_map`. | None. |
| Live service config | Only the new `slam` service in docker-compose; no separate UI/DB config. | Pin image SHA in compose. |
| OS-registered state | None. Container lifecycle is `docker compose` only. | None. |
| Secrets/env vars | None new — inherits `ROS_DOMAIN_ID` from `*ros-common`. | None. |
| Build artifacts | `docker/slam/Dockerfile` produces an image; pin via `ghcr.io/.../slam:<sha>` in compose (per Phase 2 plan B convention). | Build + push step in plan. |

## Code Examples

### Subscribe + reset pattern (web)

```ts
// web/lib/ros/services.ts (NEW)
import * as ROSLIB from "roslib";
import { getRos } from "./ros-client";

export function callSlamReset(): Promise<void> {
  return new Promise((resolve, reject) => {
    const svc = new ROSLIB.Service({
      ros: getRos(),
      name: "/slam_toolbox/reset",
      serviceType: "slam_toolbox/srv/Reset",
    });
    const req = new ROSLIB.ServiceRequest({});
    svc.callService(req, () => resolve(), (err) => reject(err));
  });
}
```

```ts
// web/lib/ros/topics.ts — add MAP entry (after SCAN)
MAP: {
  name: "/map",
  messageType: "nav_msgs/OccupancyGrid",
  compression: "cbor",
  throttle_rate: 1000,  // 1 Hz cap — map evolves slowly, payload is large
  queue_length: 1,
  throttleMs: 1000,
},
```

```ts
// web/lib/store/map-store.ts (NEW — mirrors useScanStore)
import { create } from "zustand";
import type { OccupancyGrid } from "@/lib/types/ros-messages";

interface MapState {
  latest: OccupancyGrid | null;
  lastMessageAt: number | null;
  isStale: boolean;
  updateMap: (m: OccupancyGrid) => void;
  setStale: (s: boolean) => void;
  clear: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  latest: null,
  lastMessageAt: null,
  isStale: true,
  updateMap: (m) => set({ latest: m, lastMessageAt: Date.now(), isStale: false }),
  setStale: (s) => set({ isStale: s }),
  clear: () => set({ latest: null, lastMessageAt: null, isStale: true }),
}));
```

```ts
// web/lib/types/ros-messages.ts — add OccupancyGrid + MapMetaData
export interface MapMetaData {
  map_load_time: { sec: number; nanosec: number };
  resolution: number;       // m/cell
  width: number;            // cells
  height: number;           // cells
  origin: {                 // pose of cell (0,0) in map frame
    position: Vector3;
    orientation: Quaternion;
  };
}

export interface OccupancyGrid {
  header: Header;
  info: MapMetaData;
  data: Int8Array;          // -1 unknown, 0..100 occupancy probability
}
```

[VERIFIED: ros2/common_interfaces/blob/humble/nav_msgs/msg/OccupancyGrid.msg]

## State of the Art

| Old approach | Current approach | When changed | Impact |
|---|---|---|---|
| `gmapping` (ROS1) / `slam_karto` (ROS1) | `slam_toolbox` (ROS1 + ROS2) | ~2018, became Nav2 default | Better performance on large maps, lifelong mapping, serializable pose graphs. |
| `cartographer_ros` for any 2D job | `slam_toolbox` for 2D, Cartographer for 3D / multi-sensor | ~2020 | slam_toolbox is the simpler ROS2-native answer for 2D scan SLAM. |
| `online_sync` as default | `online_async` for embedded / Pi targets | Documented in slam_toolbox README | Async never falls behind on slow CPU. |

**Deprecated / outdated:**
- The `stevemacenski/slam_toolbox` Docker Hub image with ROS2 tags — none currently published. Build from `ros:humble-ros-base` + apt install instead. [VERIFIED: docker hub fetch returned 404]

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | None for ROS2 SLAM stack (integration tests run via `ros2 topic` + `ros2 service` from a verifier shell). For web: `npm run build` in `web/`. |
| Config file | n/a |
| Quick run command | `ros2 topic hz /map` (must show ≥ 0.5 Hz) + `ros2 run tf2_ros tf2_echo map odom` (must succeed) |
| Full suite command | Phase verification script: container up → topics live → TF complete → Playwright `/lidar` check |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| MAP-01 | `slam` service comes up clean | smoke | `docker compose up -d slam && docker compose ps slam | grep healthy` | ❌ Wave 0 |
| MAP-02 | `/map` publishes ≥ 0.5 Hz | integration | `timeout 30 ros2 topic hz /map` (parse output) | ❌ Wave 0 |
| MAP-03 | TF tree complete | integration | `ros2 run tf2_ros tf2_echo map odom` (exit code 0 within 5 s) | ❌ Wave 0 |
| MAP-04 | `/lidar` renders bitmap + Reset works | manual + Playwright | Playwright: visit `/lidar`, screenshot, click reset, screenshot diff | ❌ Wave 0 |
| MAP-05 | No drift while stationary | manual | 60 s observation + ruler measurement against reference wall | manual-only |

### Sampling Rate

- **Per task commit:** `npm run build` in `web/` (catches TS errors)
- **Per wave merge:** Full SLAM container build + `docker compose up slam` + `ros2 topic hz /map` (60 s window)
- **Phase gate:** All five SC checked on Pi @ 10.10.40.23 with LD19 mounted

### Wave 0 Gaps

- [ ] `docker/slam/Dockerfile` — does not exist
- [ ] `config/slam_toolbox_params.yaml` — does not exist
- [ ] `web/lib/store/map-store.ts` — does not exist
- [ ] `web/lib/ros/services.ts` — does not exist (or extend existing)
- [ ] `web/components/lidar/map-bitmap.tsx` — does not exist
- [ ] `web/lib/types/ros-messages.ts` — needs `OccupancyGrid` + `MapMetaData` added
- [ ] `web/lib/ros/topics.ts` — needs `MAP` entry
- [ ] `web/app/lidar/page.tsx` — needs `<MapBitmap />` mount + Reset button + service call

## Security Domain

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | `/slam_toolbox/reset` exposed via rosbridge — same trust model as existing `/cmd_vel` (authenticated by being on the LAN). No new attack surface. |
| V3 Session Management | no | Stateless service call. |
| V4 Access Control | no | Dashboard is LAN-only; no new access boundary. |
| V5 Input Validation | yes — minimal | Reset takes empty request; no payload to validate. Map render must defensively handle malformed `OccupancyGrid` (negative dimensions, mismatched `data.length` vs `width*height`). |
| V6 Cryptography | no | n/a |

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Hostile WS client spamming `/slam_toolbox/reset` | DoS | Existing rosbridge has no auth; entire dashboard assumes LAN trust. Document, do not enforce in Phase 4. |
| Malformed `OccupancyGrid` from compromised SLAM container | Tampering | Defensive bounds-check in `<MapBitmap>`: skip render if `data.length !== width * height`. |

## Open Questions

1. **Will rosbridge correctly negotiate `TRANSIENT_LOCAL` durability for `/map`?**
   - What we know: rosbridge has historically had QoS-mismatch silent drops; slam_toolbox's `/map` is published `TRANSIENT_LOCAL`.
   - What's unclear: behavior in current `rosbridge_server` Humble apt build.
   - Recommendation: in Phase 4 plan, include explicit verification — start rosbridge AFTER slam_toolbox, subscribe via roslib, confirm latched message arrives within 1 s. If broken, configure rosbridge subscribe-side QoS overrides.

2. **Does the IMU-only EKF (`covariance 1.01e8`) actually produce a `odom → base_link` TF that slam_toolbox can consume?**
   - What we know: `ekf_filter_node` with `publish_tf: true` publishes the TF unconditionally based on its filter state, regardless of how unconfident it is.
   - What's unclear: whether stamped TF cadence + accuracy is sufficient for slam_toolbox's transform lookup at scan timestamps.
   - Recommendation: verify in Wave 0 of Phase 4 with `ros2 run tf2_ros tf2_echo odom base_link` before bringing up slam_toolbox. If TF is missing or stale, the EKF config needs revisiting (or we add a dummy `static_transform_publisher` for `odom → base_link` as a fallback — accepting that the SLAM map is then 100% scan-matcher-driven).

3. **Will the LD19's 12 m practical range produce enough features for scan-matching outdoors on open lawn?**
   - What we know: LD19 reliable to ~10 m on white walls; outdoor grass returns are weak.
   - What's unclear: whether outdoor mapping will produce a useful map at all.
   - Recommendation: document as a known v0 risk; SC#5 explicitly tests indoor stationary case. Outdoor mapping quality is a "discover after deploy" item.

4. **CPU budget on Pi 4 — will `slam_toolbox` + `lidar` + `nav` + `rosbridge` + `web` all fit?**
   - What we know: ROSCon 2019 talk benchmarks slam_toolbox on i7. Forum reports indicate Pi 4 can run async mode but not sync.
   - What's unclear: combined load with our specific stack.
   - Recommendation: Phase 4 verification includes `htop` snapshot during a 5-min mapping run; if CPU > 80% sustained, bump `map_update_interval: 5.0` and `resolution: 0.10`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | slam_toolbox can publish `/map` using only `odom → base_link` TF from EKF (with very high pose covariance) by relying on scan-matching to estimate motion. | Summary, Pitfall 3 | If wrong: mapping fails or drifts wildly. Mitigation: Plan B is to add a `static_transform_publisher` for `odom → base_link` (identity) so slam_toolbox's scan-matcher is fully autonomous. |
| A2 | rosbridge will deliver the latched `TRANSIENT_LOCAL` `/map` message to a late-joining browser subscriber within 1 s of subscribe. | Pitfall 4 | If wrong: page shows blank map until the next 2 s `map_update_interval` tick — annoying but not blocking; explicit QoS config solves it. |
| A3 | `Int8Array` (CBOR-encoded `OccupancyGrid.data`) passes through the existing `ArrayBuffer.isView` exemption in the NaN scrubber unchanged. | Architecture, Code Examples | If wrong: scrubber walks 1M cells per `/map` looking for NaN — perf disaster. The exemption check is `ArrayBuffer.isView(value)` which returns `true` for `Int8Array`, so this is HIGH confidence. |
| A4 | `do_loop_closing: false` is acceptable for v0 — drift over a typical mowing run is tolerable. | Pitfall 6 | If wrong: maps after 5+ minutes look broken. Mitigation: re-enable loop closure in v1 once CPU headroom is measured. |
| A5 | LD19's 360° FoV produces enough scan features for slam_toolbox's matcher in a typical garage / yard. | Open Question 3 | If wrong: SLAM produces noisy / unusable maps. Mitigation: document as outdoor-test risk; v0 success criterion is indoor. |

## Sources

### Primary (HIGH confidence)
- `github.com/SteveMacenski/slam_toolbox/blob/humble/config/mapper_params_online_async.yaml` — full default YAML quoted verbatim
- `github.com/SteveMacenski/slam_toolbox/blob/humble/launch/online_async_launch.py` — verified `use_sim_time` default `'true'`, executable name `async_slam_toolbox_node`, params file path
- `github.com/SteveMacenski/slam_toolbox/blob/humble/README.md` — services list, published topics, QoS notes
- `docs.ros.org/en/humble/p/slam_toolbox/` — Humble package version 2.6.10 confirmed
- `github.com/ros2/common_interfaces/blob/humble/nav_msgs/msg/OccupancyGrid.msg` — message schema for renderer
- Project files: `docker-compose.yml`, `config/ekf.yaml`, `config/mower_nav_launch.py`, `web/lib/ros/topics.ts`, `web/lib/ros/subscribers.ts`, `web/lib/store/scan-store.ts`, `.planning/phases/03-web-visualization-scan-on-the-map-page/03-02-SUMMARY.md`, `.planning/quick/260414-w8p-lidar-standalone-page/TASK.md`, `.planning/quick/260415-9ww-lidar-deeper-zoom/TASK.md`

### Secondary (MEDIUM confidence)
- `github.com/SteveMacenski/slam_toolbox/issues/221` — "Support mapping without odometry" — corroborates A1 but lacks Macenski-quoted resolution; relied on issue body + cross-references
- `forum.dexterindustries.com/t/rpi4-ros-online-async-vs-synchronous-map/9236` — Pi 4 sync-vs-async empirical guidance
- `roscon.ros.org/2019/talks/roscon2019_slamtoolbox.pdf` — Macenski's ROSCon talk for benchmarking baselines

### Tertiary (LOW — unverified)
- WebSearch summaries about rosbridge throttle_rate semantics — corroborated against project's existing `TOPICS.SCAN` config which already uses these knobs

## Metadata

**Confidence breakdown:**
- Standard stack (image, package, executable, params): HIGH — directly from upstream Humble branch and apt repo
- Architecture (TF, container layout, Canvas render): MEDIUM-HIGH — direct extrapolation from existing Phase 2/3 patterns
- Pitfalls 1, 2, 5, 6, 7: HIGH — cross-cited from upstream + community
- Pitfalls 3, 4: MEDIUM — A1/A2 in Assumptions Log; flagged for Phase 4 verification
- No-wheel-odom feasibility (A1): MEDIUM — strong theoretical basis, no shipped reference; Plan B documented

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (slam_toolbox Humble is stable; only re-research if Pi/EKF behavior changes materially)
