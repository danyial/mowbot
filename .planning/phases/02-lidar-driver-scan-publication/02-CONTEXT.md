# Phase 2: LiDAR Driver & `/scan` Publication - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up a new `lidar` Docker service that wraps `ldlidar_stl_ros2`, reads from `/dev/ttyLIDAR` (Phase 1 output), publishes a clean `sensor_msgs/LaserScan` on `/scan` at steady 10 Hz with sensor QoS, and advertises a correct `base_link → laser_frame` static transform. Phase 2 ends when `ros2 topic hz /scan` reports 10.0 ± 0.1 Hz from a fresh `docker compose up`, the transform tree is connected, and chassis self-hits are absent from published scans.

**Out of bounds for Phase 2:**
- Web visualization / browser rosbridge work — Phase 3.
- Safety watchdog / `/cmd_vel` gating — deferred (not in milestone).
- Firmware `/odom` publisher — separate deferred todo.
- Changes to `/dev/ttyLIDAR` wiring or Phase 1 docs.

</domain>

<decisions>
## Implementation Decisions

### Driver Source & Pinning
- **D-01:** Use the vendor-official `ldrobotSensorTeam/ldlidar_stl_ros2` repo. No fork, no custom driver — rejected per PROJECT.md Out-of-Scope.
- **D-02:** **ARG SHA + git clone in Dockerfile** is the pinning mechanism. `docker/lidar/Dockerfile` contains:
  ```dockerfile
  ARG LDLIDAR_SHA=<40-char-hash>
  RUN git clone https://github.com/ldrobotSensorTeam/ldlidar_stl_ros2.git /ros2_ws/src/ldlidar_stl_ros2 \
      && git -C /ros2_ws/src/ldlidar_stl_ros2 checkout ${LDLIDAR_SHA}
  ```
  The SHA lives in the Dockerfile's `ARG` default AND in a `build.args` block under `services.lidar.build` in `docker-compose.yml` (so `docker compose build lidar` always produces a reproducible image).
- **D-03:** Image **tag policy diverges from existing services**: `lidar` publishes as `ghcr.io/danyial/mowbot/lidar:<SHA>` (short SHA of our repo commit that pinned the driver) AND `:latest` for developer convenience, but the `docker-compose.yml` references the SHA tag, not `:latest`. ROADMAP §"Phase 2" SC#1 requires "tag is pinned (not latest)" — this is the mechanism. Existing services continue to reference `:latest` (not touched this phase).
- **D-04:** Phase 2 execution workflow:
  1. Researcher picks a `master` HEAD SHA known to have LD19 support.
  2. Planner's first task clones + builds locally, bench-tests against `/dev/ttyLIDAR`.
  3. If bench-test passes (steady 10 Hz, clean `/scan`), commit that SHA as `LDLIDAR_SHA` default.
  4. If bench-test fails, drop back one or more commits until stable; document the decision.

### `base_link → laser_frame` Static TF
- **D-05:** Mount offsets are placeholders in-phase, measured at physical install. Launch file (in `docker/lidar/launch/lidar.launch.py` — see D-10) accepts seven args for a `static_transform_publisher` call: `x y z qx qy qz qw` OR `x y z yaw pitch roll`. Phase 2 commits the launch file with default args set to **zero on all axes** and a loud `# TODO: measure on physical mount` comment, plus a measurement procedure written to `docs/lidar-mount.md`.
- **D-06:** Measurement procedure (written to `docs/lidar-mount.md`):
  - `x` = forward offset from `base_link` origin (Pi HAT center, per existing `config/robot.yaml` if defined; else wheel-axle center).
  - `y` = left offset (ROS REP-103 right-hand rule, left positive).
  - `z` = upward offset above `base_link` plane.
  - `yaw` = rotation around z, 0 = LD19 cable pointing backward per the vendor coordinate system (§5.5 of `D500-STL-19P-Datasheet.pdf`).
  - Tools: ruler, carpenter's square, digital level for yaw. Measurement accuracy target ±5 mm on each axis, ±2° yaw.
  - Values committed to the launch file AND to `docs/lidar-mount.md` as a numbered table.
- **D-07:** Phase 2 does NOT block on physical mount being final. The launch-file structure + measurement doc are the Phase 2 deliverable; a follow-up task (or Phase 4 prep) replaces the zero defaults with measured values once the sensor is mounted on the mower chassis. For the "Core Value gate" demonstration in Phase 3, identity transform is acceptable — scan appears relative to base_link origin, orientation may be off by <90°, but the pipeline is end-to-end functional.

### Self-hit / Chassis Filter
- **D-08:** Use the **driver-native angular mask** (`angle_crop_min`, `angle_crop_max` launch params of `ldlidar_stl_ros2`). Deterministic, zero extra nodes, declarative in the launch file. Default values set to full 360° (no crop) until real chassis mount is measured; mask values are added in the same task that measures TF offsets (D-06) and follow the same "measure on physical mount" contract.
- **D-09:** `laser_filters` package is explicitly rejected for this phase — overkill for a single-purpose chassis blackout, new container/config surface, and no need for range/intensity filters yet. Revisit in Phase 4 (safety watchdog) if the angular mask proves insufficient.

### Launch Style
- **D-10:** Use a ROS2 **launch.py file** at `docker/lidar/launch/lidar.launch.py`, invoked from `docker-compose.yml` via `command: ros2 launch /launch/lidar.launch.py`. Mirrors the `nav` service pattern (which also uses a launch.py), NOT the `gnss`/`imu` inline-`ros2 run` pattern — justified because the LiDAR needs BOTH the driver node AND the `static_transform_publisher` launched together, which an inline command cannot easily do.
- **D-11:** The launch file reads params from ROS2 args with sensible defaults, so `docker-compose.yml` stays thin (just device mount + env).

### docker-compose.yml — `ipc: host` + `pid: host` Retrofit (SCOPE EXPANSION)
- **D-12:** Research-recommended `ipc: host` + `pid: host` are added to the shared `x-ros-common` YAML anchor — applied to **all** services, not just `lidar`. Rationale: CycloneDDS shared-memory discovery + cross-container participant visibility is more reliable when all participants share IPC and PID namespaces. Existing services (`gnss`, `imu`, `nav`, `ntrip`, `rosbridge`, `web`, `micro-ros-agent`) already coexist fine with just `network_mode: host`, so this is a resilience improvement, not a fix.
- **D-13:** Because this touches every service, Phase 2's final gate includes a **regression check for each existing service**: verify `/fix`, `/imu`, `/odometry/filtered`, RTK corrections, rosbridge WebSocket, and the web app all still work after the retrofit. If any service breaks, roll back to the pre-retrofit `x-ros-common` and treat this as a v2 concern. Committed separately from the `lidar` service so rollback is a single revert.
- **D-14:** Retrofit + lidar service land in **separate commits** for clean git history:
  1. Commit A: `docker-compose.yml` `x-ros-common` retrofit only; regression-gate all existing services.
  2. Commit B: New `lidar` service (Dockerfile, launch file, docker-compose entry).
  Executor ordering: Commit A first, verify all existing services still green, THEN Commit B. If Commit A's regression fails, Commit B is blocked until resolved.

### Device Path & Environment
- **D-15:** `docker-compose.yml` lidar service uses `${LIDAR_DEVICE:-/dev/ttyLIDAR}:/dev/ttyLIDAR` mount, mirroring the existing `ESP32_DEVICE`/`GNSS_DEVICE` pattern and reusing the `LIDAR_DEVICE=/dev/ttyLIDAR` entry already in `.env.example` (Phase 1).
- **D-16:** Baud rate (230400) and frame_id (`laser_frame`) are set in the launch file as explicit ROS2 params, not as environment variables — they don't change per host.

### QoS
- **D-17:** Publisher uses ROS2 `SensorDataQoS()` profile: BEST_EFFORT reliability + KEEP_LAST 5 depth. This is the standard for sensor streams where losing a stale scan is preferable to backpressure. Matches existing `imu` / `gnss` convention (sensor topics already default-publish with sensor QoS).

### Image Registry & Tag
- **D-18:** Image published to `ghcr.io/danyial/mowbot/lidar:<git-short-sha>` via whatever existing CI/CD (if any) builds the other service images. If no CI exists, `docker compose build lidar` on the Pi/Mac produces the image locally and tags it appropriately. Planner/executor checks whether existing CI builds under `ghcr.io/danyial/mowbot/<service>:latest` are automated or manual — don't assume.

### Claude's Discretion
- Exact base image for `docker/lidar/Dockerfile`: `ros:humble-ros-base` vs. `ros:humble-perception` — planner picks the smaller one that still pulls in `sensor_msgs`, `tf2_ros`. Probably `ros-base`.
- Whether to expose the driver's speed-control param (PWM mode) in the launch file — per datasheet, internal 10 Hz is fine for this milestone, so safe to hardcode.
- Specific wording of the `docs/lidar-mount.md` measurement instructions.
- Whether the launch file uses `IncludeLaunchDescription` or declares nodes directly — planner picks the simpler one.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` §"Phase 2: LiDAR Driver & `/scan` Publication" — goal + 5 success criteria verbatim.
- `.planning/REQUIREMENTS.md` §"LiDAR Driver & ROS2 Integration" — DRV-01 through DRV-05.

### Phase 1 outputs (mandatory inputs)
- `.planning/phases/01-hardware-uart-routing/01-01-SUMMARY.md` — confirms `/dev/ttyLIDAR → /dev/ttyAMA1`, 230400 baud, `0x54 0x2C` headers flowing.
- `udev/99-mower.rules` — LiDAR udev rule already in place.
- `.env.example` — `LIDAR_DEVICE=/dev/ttyLIDAR` already added.
- `docs/lidar-wiring.md` — as-built pigtail wiring, boot-config diff.

### LD19 protocol + electrical
- `docs/datasheets/lidar/LD19-Development-Manual-V2.3.pdf` — §2 (UART 230400 8N1 one-way, PWM grounded), §3 (packet format, CRC8), §5 (coordinate system — left-handed CW at the sensor; driver converts to ROS2 right-handed CCW).
- `docs/datasheets/lidar/D500-STL-19P-Datasheet.pdf` — §4 (scan rate, ranging spec).
- `docs/datasheets/lidar/README.md` — curated summary.

### Existing patterns to mirror
- `docker-compose.yml` — `x-ros-common` anchor, service naming convention (`mower-<name>`), device mount patterns. Phase 2 edits this file.
- `docker/gnss/Dockerfile` — closest existing hardware-driver service (NMEA on UART); mirror for base image choice and build steps.
- `docker/nav/` — the only existing service using a launch.py; mirror for Phase 2 launch pattern.
- `config/robot.yaml` — check for existing `base_link` conventions that the LiDAR TF must slot into.

### Research
- `.planning/research/SUMMARY.md` — §"Phase 2", pitfalls 4/9/10/12/13/16/17 apply.
- `.planning/research/STACK.md` — driver choice rationale.
- `.planning/research/PITFALLS.md` — `laser_scan_dir` / angle-convention pitfalls.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`x-ros-common` YAML anchor** in `docker-compose.yml` — the new `lidar` service extends it plus adds device mount + command. No new shared infrastructure needed.
- **`mower-<service>` container naming** — lidar container is `mower-lidar`.
- **`ghcr.io/danyial/mowbot/<service>:<tag>` image namespace** — follow the pattern.
- **`config/robot.yaml`** — if it declares `wheel_separation`, `base_link` origin conventions, the TF launch should reference those values.

### Established Patterns
- `commit_docs: true`, `branching_strategy: none` — Phase 2 lands on main.
- Existing services use inline `command:` in compose for simple single-node invocations (`gnss`, `imu`, `micro-ros-agent`). `nav` uses launch.py. Phase 2 follows the `nav` precedent (two co-launched nodes: driver + static_transform_publisher).
- No existing service uses `ipc: host` or `pid: host` today — Phase 2 adds both to `x-ros-common` (scope-expansion per D-12).

### Integration Points
- `/dev/ttyLIDAR` — Phase 1 output, mount read-write with `devices:`.
- `config/` mount is already `/config:ro` in `x-ros-common` — launch file can read configs from there if needed.
- rosbridge (Phase 3 consumer) will subscribe `/scan` — we don't touch rosbridge config in Phase 2 but launch params must make `/scan` visible on the default domain (`ROS_DOMAIN_ID=0`).

### Out of Scope for This Phase
- `docker/web/` — untouched (Phase 3 territory).
- `firmware/` — untouched (separate deferred work).
- `hardware/` — HAT v2.0 WIP stays dirty, same as Phase 1.

</code_context>

<specifics>
## Specific Ideas

- User emphasized the asymmetry between Phase 2 retrofitting `ipc: host` / `pid: host` across ALL services vs. the rest of the project's "don't touch working services" ethos. This is accepted as a deliberate resilience upgrade with an explicit regression-gate on all 6 existing services before Commit B (lidar) proceeds.
- Preference for the `nav`-style launch.py over inline compose commands — explicitly because we launch two nodes together (driver + static TF), and mixing inline compose commands with a sidecar tf node would be ugly.
- "Measure at install, don't guess" — applies to both TF offsets (D-06) and the angular self-hit mask (D-08). Both get zero / full-360° defaults in Phase 2 and are filled in during physical mount (post-phase or in Phase 4 prep).

</specifics>

<deferred>
## Deferred Ideas

- **Actual chassis mount + TF values** — launch file committed with zero placeholders; real mount + measurement happens when the LD19 is physically mounted to the chassis (separate todo or part of Phase 4 prep).
- **`laser_filters` pipeline** — rejected for Phase 2; may return in Phase 4 if driver-native angular mask can't handle all self-hit cases.
- **Automated CI/CD for the lidar image** — Phase 2 assumes manual builds and pushes to GHCR (or local builds). Setting up CI automation is a separate concern.
- **PWM external-speed control of the LD19** — not needed at 10 Hz default; PWM pin stays grounded (D-10 / Phase 1 decision).
- **LD19 `safety_shutdown` / interactive mode** — not needed here.
- **Nav2 costmap integration with `/scan`** — explicit PROJECT.md Out-of-Scope.

</deferred>

---

*Phase: 02-lidar-driver-scan-publication*
*Context gathered: 2026-04-14*
