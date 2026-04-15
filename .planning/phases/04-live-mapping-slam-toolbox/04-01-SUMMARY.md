---
phase: 04-live-mapping-slam-toolbox
plan: 01
subsystem: ros2-slam
tags: [slam_toolbox, occupancy-grid, tf, docker-compose, cyclonedds]
requirements_completed: [MAP-01, MAP-02, MAP-03, MAP-05]
requirements_deferred: [MAP-04]
dependency_graph:
  requires:
    - Phase 2 lidar container publishing /scan at 10 Hz
    - mower-nav EKF publishing odom -> base_link TF
    - mower_nav_launch.py static base_link -> laser_frame TF
  provides:
    - "/map (nav_msgs/OccupancyGrid) @ 0.5 Hz on DDS plane"
    - "map -> odom TF @ ~10 Hz from slam_toolbox"
    - "/slam_toolbox/reset service over rosbridge"
  affects:
    - docker-compose.yml (new slam service, 9 total services)
    - REQUIREMENTS.md (MAP-01..MAP-05 added to v1 block)
tech_stack:
  added:
    - ros-humble-slam-toolbox 2.6.10
  patterns:
    - Pinned image tag `humble-2.6.10` (no `latest`) per MAP-01
    - Project-local params YAML overriding upstream defaults with inline rationale comments
    - Inherit *ros-common anchor (network_mode/ipc/pid: host, /config mount)
key_files:
  created:
    - docker/slam/Dockerfile
    - config/slam_toolbox_params.yaml
    - .planning/phases/04-live-mapping-slam-toolbox/04-01-DEPLOY.log
    - .planning/phases/04-live-mapping-slam-toolbox/04-01-tf-frames.pdf
    - .planning/phases/04-live-mapping-slam-toolbox/04-01-tf-frames.gv
  modified:
    - docker-compose.yml (added slam service, 9 services total)
    - .planning/REQUIREMENTS.md (MAP-01..MAP-05 + traceability rows + coverage totals)
decisions:
  - Drop `CYCLONEDDS_URI` env from slam Dockerfile; the 10 MB SocketReceiveBufferSize in config/cyclonedds.xml exceeds Pi `net.core.rmem_max` (212992 B) and crashes rmw_cyclonedds_cpp. Matches nav/gnss/lidar/imu convention (none of them set CYCLONEDDS_URI either).
  - `do_loop_closing: false` — Pi 4 CPU budget, v0 simplicity.
  - `map_update_interval: 2.0` (0.5 Hz publish) — satisfies SC#1 without burning CPU.
  - `transform_timeout: 1.0` — slack for IMU-only EKF jitter.
  - `use_sim_time:=false` passed both in Dockerfile CMD and compose command — upstream default is `true` which hangs on /clock.
metrics:
  duration_min: ~18
  completed_date: 2026-04-15
---

# Phase 4 Plan 01: slam_toolbox Container + Params + Compose Wire-up — Summary

One-liner: Pinned `ros-humble-slam-toolbox:2.6.10` container deployed with project-local params override, publishing `/map` @ 0.5 Hz and `map -> odom` TF over the existing CycloneDDS plane, verified live on Pi @ 10.10.40.23.

## What Shipped

- **`docker/slam/Dockerfile`** — `ros:humble-ros-base` + `ros-humble-slam-toolbox` + `ros-humble-rmw-cyclonedds-cpp`, CMD launches `online_async_launch.py` with `slam_params_file:=/config/slam_toolbox_params.yaml` and `use_sim_time:=false`. Does NOT set `CYCLONEDDS_URI` (see deviation below).
- **`config/slam_toolbox_params.yaml`** — upstream `mapper_params_online_async.yaml` verbatim plus inline-commented OVERRIDEs: `base_frame: base_link`, `do_loop_closing: false`, `transform_timeout: 1.0`, `map_update_interval: 2.0`, `max_laser_range: 12.0`, `minimum_travel_{distance,heading}: 0.1`, `use_map_saver: false`, `transform_publish_period: 0.05`.
- **`docker-compose.yml`** — new `slam` service inheriting `*ros-common`, pinned `image: ghcr.io/danyial/mowbot/slam:humble-2.6.10`, `depends_on: [lidar, nav, micro-ros-agent]`, launch command passes both `slam_params_file` and `use_sim_time:=false`. Now 9 total services.
- **`.planning/REQUIREMENTS.md`** — MAP-01..MAP-05 added under new "### Live Mapping (Phase 4)" block; five traceability rows appended; coverage totals bumped to 21 v1 reqs / 21 mapped / 0 unmapped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CycloneDDS URI vs kernel rmem ceiling**

- **Found during:** Task 5 step 6 (`docker compose up -d slam`).
- **Issue:** Initial Dockerfile set `ENV CYCLONEDDS_URI=file:///config/cyclonedds.xml`. That XML mandates `<SocketReceiveBufferSize min="10MB" />`, but Pi kernel has `net.core.rmem_max=212992` (~208 KB). `rmw_cyclonedds_cpp::rmw_create_node` failed with *"failed to create domain, error Error"* → *"rcl node's rmw handle is invalid"* → slam process exited with code -6 in a crash loop.
- **Root cause:** cross-check showed the existing nav / gnss / imu / lidar Dockerfiles do NOT set `CYCLONEDDS_URI` either; they inherit the default built-in XML and rely on multicast discovery that Just Works on the host network. The XML file is mounted at `/config/cyclonedds.xml` but no existing service points at it.
- **Fix:** removed `ENV CYCLONEDDS_URI=...` from `docker/slam/Dockerfile`. Rebuild + recreate. slam node came up clean: *"Using solver plugin solver_plugins::CeresSolver"*, Ceres/SCHUR_JACOBI preconditioner initialized, *"Registering sensor: [Custom Described Lidar]"*. No rmw errors after fix.
- **Files modified:** `docker/slam/Dockerfile`.
- **Commit:** `31ac98b fix(04-01): drop CYCLONEDDS_URI from slam Dockerfile; capture deploy evidence`.

### Plan-B Fallback (Task 7)

**Skipped.** Task 6 resume signal was `approved`. Stationary 60 s diff produced 0 lines of difference in `/map` echo → SC#4 PASS with zero drift. EKF `publish_tf:false` + static `odom->base_link` fallback NOT required. `config/ekf.yaml` and `config/mower_nav_launch.py` untouched. Logged as `Plan-B skipped` in `04-01-DEPLOY.log`.

## Probe Results

| Probe | Criterion | Result |
|-------|-----------|--------|
| SC#1 (MAP-02) `ros2 topic hz /map` 60 s | ≥ 0.4 Hz | **0.500 Hz** sustained, std dev ≤ 0.0005 s |
| MAP-02 `ros2 topic echo /map --once` | populated OccupancyGrid | `138 × 74 @ 0.05 m`, origin `(-1.38, -3.16)`, frame_id=`map` |
| SC#2 (MAP-03) view_frames TF tree | full chain, `map->odom` non-static | `base_link` ← `odom` (30.2 Hz, EKF), `odom` ← `map` (**10.2 Hz, slam_toolbox — NOT static**), `laser_frame` ← `base_link` (static) |
| MAP-03 `tf2_echo map odom / odom base_link / base_link laser_frame` | all succeed | all 3 SUCCESS, timestamps advance on `map->odom` |
| SC#4 (MAP-05) stationary 60 s diff | ≤ handful of lines | **0 lines** (identical headers, width/height/resolution/origin unchanged) |
| Regression gate | 9 services Up | `micro-ros-agent, gnss, imu, ntrip, nav, rosbridge, web, lidar, slam` all Up |

## Requirement Mapping

| Req | Status | Evidence |
|-----|--------|----------|
| MAP-01 | Complete | pinned `humble-2.6.10`, inherits `*ros-common`, `docker compose up slam` clean |
| MAP-02 | Complete | 0.500 Hz sustained, OccupancyGrid populated |
| MAP-03 | Complete | `map->odom` @ 10 Hz from slam_toolbox, full chain verified |
| MAP-04 | Deferred | Plan 04-02 (web `/lidar` map bitmap overlay + Reset button) |
| MAP-05 | Complete | stationary 60 s diff = 0 |

## Forward Hooks

- **Plan 04-02** consumes `/map` over rosbridge (CBOR). Plan 03-01's typed-array scrubber already exempts Int8Array — the OccupancyGrid `data` field (int8) will pass through the binary NaN scrubber untouched.
- **When wheel-odometry lands in firmware** (deferred ESP32 `/odom` publisher): current `transform_timeout: 1.0` slack can be tightened; `minimum_travel_{distance,heading}` can be lowered if scan-matcher quality improves.
- **Future mapping persistence (v1+):** `use_map_saver: false` → flip to `true` + mount a writable volume to serialize maps across restarts.

## Artifacts Committed

- `docker/slam/Dockerfile` — commits `7fa7c6d`, `31ac98b` (CycloneDDS fix).
- `config/slam_toolbox_params.yaml` — commit `0b58b30`.
- `docker-compose.yml` — commit `28d762d`.
- `.planning/REQUIREMENTS.md` — commit `ca74e0a`.
- `.planning/phases/04-live-mapping-slam-toolbox/04-01-DEPLOY.log` — commit `31ac98b`.
- `.planning/phases/04-live-mapping-slam-toolbox/04-01-tf-frames.pdf` — commit `31ac98b`.
- `.planning/phases/04-live-mapping-slam-toolbox/04-01-tf-frames.gv` — commit `31ac98b`.

## Self-Check: PASSED

Files verified present:
- FOUND: `docker/slam/Dockerfile`
- FOUND: `config/slam_toolbox_params.yaml`
- FOUND: `docker-compose.yml` (slam service)
- FOUND: `.planning/REQUIREMENTS.md` (MAP-01..MAP-05)
- FOUND: `.planning/phases/04-live-mapping-slam-toolbox/04-01-DEPLOY.log`
- FOUND: `.planning/phases/04-live-mapping-slam-toolbox/04-01-tf-frames.pdf`
- FOUND: `.planning/phases/04-live-mapping-slam-toolbox/04-01-tf-frames.gv`

Commits verified in `git log`:
- FOUND: `ca74e0a` docs(04-01) — MAP-01..MAP-05
- FOUND: `7fa7c6d` feat(04-01) — Dockerfile
- FOUND: `0b58b30` feat(04-01) — params YAML
- FOUND: `28d762d` feat(04-01) — compose slam service
- FOUND: `31ac98b` fix(04-01) — CycloneDDS fix + deploy evidence
