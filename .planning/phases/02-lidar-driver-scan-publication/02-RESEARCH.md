# Phase 2: LiDAR Driver & `/scan` Publication — Research

**Researched:** 2026-04-14
**Domain:** LDROBOT LD19 driver integration into a brownfield ROS2 Humble + Docker + Pi 4 stack
**Confidence:** HIGH (driver, launch params, docker patterns) / MEDIUM (ipc/pid retrofit — deduced from standard ROS2 Docker patterns, not from a project-specific load test)

---

## User Constraints (from CONTEXT.md)

### Locked Decisions (Phase 2 CONTEXT §D-01..D-18)

- **Driver:** `ldrobotSensorTeam/ldlidar_stl_ros2` (official), pinned via `ARG LDLIDAR_SHA=<40-char>` + `git clone` + `git checkout ${LDLIDAR_SHA}` in Dockerfile. SHA mirrored as `build.args` in `docker-compose.yml`.
- **Image tag:** `ghcr.io/danyial/mowbot/lidar:<repo-short-sha>`, NOT `:latest`. Compose file references the SHA tag.
- **Workflow:** researcher picks master HEAD SHA → planner's first task bench-builds + runs against `/dev/ttyLIDAR` → commit SHA default if pass; drop back if fail.
- **TF:** `base_link → laser_frame` via `static_transform_publisher` in `docker/lidar/launch/lidar.launch.py`. Zero defaults on all seven axes + `# TODO: measure on physical mount` comment. Measurement procedure documented in `docs/lidar-mount.md`.
- **Self-hit filter:** driver-native `angle_crop_min/max` params (NOT `laser_filters`). Default full 360° (no crop) this phase.
- **Launch style:** `ros2 launch /launch/lidar.launch.py` from compose (mirror `nav` pattern). Two nodes co-launched.
- **Retrofit scope expansion:** `ipc: host` + `pid: host` added to `x-ros-common` anchor (applies to ALL services), split into 2 commits: (A) x-ros-common retrofit + regression-gate all existing services, (B) new `lidar` service.
- **Device:** `${LIDAR_DEVICE:-/dev/ttyLIDAR}:/dev/ttyLIDAR` mount.
- **Baud / frame_id:** 230400 and `laser_frame` hardcoded in launch file as ROS2 params (not env vars).
- **QoS:** publisher uses `rclcpp::SensorDataQoS()` (BEST_EFFORT, KEEP_LAST 5). Matches sensor convention.
- **Frame name:** `laser_frame` (per CONTEXT — note: upstream vendor launch file uses `base_laser`; we rename).

### Claude's Discretion

- Base image for `docker/lidar/Dockerfile`: `ros:humble-ros-base` vs `ros:humble-perception` — pick smallest that builds driver cleanly.
- Whether to expose PWM speed-control param — hardcode 10 Hz internal mode, skip.
- Exact wording of `docs/lidar-mount.md`.
- Launch file structure — `IncludeLaunchDescription` vs declare nodes directly — pick simpler.

### Deferred (OUT OF SCOPE — ignore)

- Actual chassis mount + measured TF values.
- `laser_filters` pipeline.
- CI/CD automation for lidar image.
- PWM external speed control.
- Nav2 costmap integration.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DRV-01 | `ldlidar_stl_ros2` as Docker service, host net + ipc + pid, `/dev/ttyLIDAR` mount | §Ready-to-Paste Dockerfile + compose YAML; §Q5 ipc/pid retrofit |
| DRV-02 | `/scan` at 10 Hz, sensor QoS (BEST_EFFORT, KEEP_LAST 5) | §Q7 — upstream is reliable-default-depth-10; requires local patch OR subscriber-side QoS override |
| DRV-03 | `base_link → laser_frame` static TF; `frame_id: laser_frame` on `/scan` | §Q2 launch params + Ready-to-Paste launch.py; §Q10 base_link conventions |
| DRV-04 | Angular sector mask / self-hit filter configured | §Q2 — `enable_angle_crop_func` + `angle_crop_min/max` in launch |
| DRV-05 | `lidar` service added to `docker-compose.yml`, starts cleanly, image tag pinned | §Ready-to-Paste compose YAML + x-ros-common retrofit diff |

---

## Summary (Top Findings)

1. **SHA recommendation: `bf668a89baf722a787dadc442860dcbf33a82f5a` (2023-05-08, master HEAD).** The upstream repo is effectively frozen — last substantive change was STL-27L support in Mar 2023, last commit was a README update May 2023. LD19 support is native from project inception (Feb 2022). No known regressions in the issue tracker affecting LD19. HEAD SHA is safe to pin.

2. **Vendor reference launch file (`launch/ld19.launch.py`) exists and is the authoritative source of truth for driver param names + defaults.** We should copy-and-modify it, not include-and-override — the file is tiny (30 lines) and stable. Nine params: `product_name`, `topic_name`, `frame_id`, `port_name`, `port_baudrate`, `laser_scan_dir`, `enable_angle_crop_func`, `angle_crop_min`, `angle_crop_max`.

3. **`laser_scan_dir: true` is correct for this project.** The driver transforms LD19's native left-handed/CW coordinate system to ROS2's right-handed/CCW by index-reversal (`int index_anticlockwise = beam_size - index - 1`). Vendor default is `true`; upstream LD19 launch file sets `true`. We set `true`.

4. **CRITICAL QoS GAP:** Upstream driver creates the publisher as `node->create_publisher<LaserScan>(topic_name, 10)` — that's **RELIABLE QoS with history depth 10**, not SensorDataQoS. CONTEXT §D-17 requires BEST_EFFORT. **Two options for the planner:** (a) subscriber-side QoS override — every consumer asks for BEST_EFFORT; rosbridge + rviz will negotiate, but cross-container latency may suffer. (b) source-patch the driver in the Dockerfile (single-line sed against `src/demo.cpp` to replace `10` with `rclcpp::SensorDataQoS()`). **Recommendation: do (b).** The whole point of pinning a SHA is we control the build. Sed patch is 1 line, deterministic, documented in Dockerfile.

5. **`angle_crop_min/max` semantics: the range is the ZONE TO MASK OUT (set to NaN), not the zone to keep.** Vendor launch file default `135.0..225.0` masks the rear hemisphere. Units are degrees in the driver's internal frame (post-`laser_scan_dir` flip). Phase 2 defaults: `enable_angle_crop_func: false` (full 360°), leave crop_min/max at vendor defaults — values are ignored while enable is false.

6. **Base image: `ros:humble-ros-base` is the right choice.** The `gnss` and `nav` services already use `ros:${ROS_DISTRO}-ros-base`. It includes `rclcpp`, `sensor_msgs`, `tf2_ros`, and `launch_ros` — everything the driver needs. `ros:humble-perception` adds image_transport / pcl / laser_geometry (~200 MB extra) — none needed for Phase 2. Build driver from source via `colcon build --packages-select ldlidar_stl_ros2`.

7. **Packet timestamp gap (Pitfall 10 re-verified):** driver stamps `header.stamp = node->now()` (receive time), NOT the per-packet timestamp. This is a known limitation; not worth fixing in Phase 2 (would touch `src/demo.cpp` + packet parsing). EKF is not fusing `/scan` in this milestone, so drift between scan timestamp and odom timestamp does not propagate. Document as a follow-up for the Nav2 milestone.

**Primary recommendation for planner:** copy-and-modify the vendor `ld19.launch.py`; pin `LDLIDAR_SHA=bf668a89baf722a787dadc442860dcbf33a82f5a` as default; include a 1-line sed-patch in the Dockerfile to force `SensorDataQoS()`; build from `ros:humble-ros-base`; retrofit `ipc: host`/`pid: host` on `x-ros-common` in a dedicated Commit A with the per-service regression matrix in §Ready-to-Paste.

---

## Findings

### Q1 — Known-good SHA for `ldlidar_stl_ros2`

**Recommended:** `bf668a89baf722a787dadc442860dcbf33a82f5a` (master HEAD, 2023-05-08, "Update README.md" by mingdonghu). `[VERIFIED: GitHub API /repos/ldrobotSensorTeam/ldlidar_stl_ros2/commits/master]`

**Rationale:**
- Master HEAD is the safest pin: the repo is effectively frozen (no commits since May 2023). Picking a SHA deeper in history gains nothing and risks missing a README or CMake fix.
- Commit preceding HEAD is `1a7ab4869275d262cb2413a5ec1192114e4df845` ("Merge pull request #6 from rudislabs/master"). Preceding that is `b3998f4ca5fdd3fe03fd159d69ff0dc19fe131a3` ("Updated for STL_27L") — introduces STL-27L product support, does not affect LD19.
- LD19 support landed at project inception (Feb 2022 per initial commit). No subsequent LD19-related bug report on the issue tracker has a reported regression.
- CMakeLists.txt builds against `rclcpp`, `sensor_msgs`, `tf2_ros` — all present in `ros:humble-ros-base`.
- Recent independent tutorials (Nov 2025 Harminder.dev STL-19P on Jazzy) still reference this repo as the canonical driver — still considered authoritative.

**If HEAD bench-test fails:** drop back to `1a7ab4869275d262cb2413a5ec1192114e4df845` (merge of PR #6 — rudislabs' tree). README-only commits in between do not affect behavior. Further fallback: `b3998f4ca5fdd3fe03fd159d69ff0dc19fe131a3` (pre-STL-27L; slightly smaller surface).

**Confidence:** HIGH `[VERIFIED]`.

---

### Q2 — Launch-param surface

Authoritative source: `launch/ld19.launch.py` in upstream repo `[VERIFIED: fetched from https://raw.githubusercontent.com/ldrobotSensorTeam/ldlidar_stl_ros2/master/launch/ld19.launch.py]`:

```python
ldlidar_node = Node(
    package='ldlidar_stl_ros2',
    executable='ldlidar_stl_ros2_node',
    name='LD19',
    output='screen',
    parameters=[
        {'product_name': 'LDLiDAR_LD19'},
        {'topic_name': 'scan'},
        {'frame_id': 'base_laser'},
        {'port_name': '/dev/ttyUSB0'},
        {'port_baudrate': 230400},
        {'laser_scan_dir': True},
        {'enable_angle_crop_func': False},
        {'angle_crop_min': 135.0},
        {'angle_crop_max': 225.0}
    ]
)

base_link_to_laser_tf_node = Node(
    package='tf2_ros',
    executable='static_transform_publisher',
    name='base_link_to_base_laser_ld19',
    arguments=['0','0','0.18','0','0','0','base_link','base_laser']
)
```

**Param inventory:**

| Param | Type | Default (vendor) | MowerBot override | Notes |
|-------|------|-------------------|-------------------|-------|
| `product_name` | string | `LDLiDAR_LD19` | keep | Selects parser variant |
| `topic_name` | string | `scan` | `scan` (keep) | Publishes on `/scan` under global ns |
| `frame_id` | string | `base_laser` | `laser_frame` | CONTEXT mandates `laser_frame` |
| `port_name` | string | `/dev/ttyUSB0` | `/dev/ttyLIDAR` | Phase 1 output |
| `port_baudrate` | int | 230400 | keep | LD19 spec |
| `laser_scan_dir` | bool | `True` | keep | CCW / ROS REP-103 (see §Q3) |
| `enable_angle_crop_func` | bool | `False` | `False` this phase | Master switch for mask; true at physical-mount task |
| `angle_crop_min` | float (deg) | 135.0 | keep default (unused until enable=true) | Start of masked sector |
| `angle_crop_max` | float (deg) | 225.0 | keep default (unused until enable=true) | End of masked sector (inclusive) |

**Executable name:** `ldlidar_stl_ros2_node` (NOT `demo` — CMakeLists.txt installs the executable under this name). `[VERIFIED: package name in src/demo.cpp → install target]`

**Confidence:** HIGH `[VERIFIED]`.

---

### Q3 — LD19 coordinate system and `laser_scan_dir`

**Finding:** the driver DOES transform LD19's native left-handed/CW to ROS2 right-handed/CCW when `laser_scan_dir: true`, by reversing the beam index:

```cpp
if (setting.laser_scan_dir) {
  int index_anticlockwise = beam_size - index - 1;
  // ... writes range/intensity into ranges[index_anticlockwise]
}
```
`[VERIFIED: src/demo.cpp on master HEAD]`

**Implication:** set `laser_scan_dir: true` (vendor default) and consumer code (rviz, web overlay, future Nav2) sees standard REP-103 CCW scan. LD19 Development Manual §5.5 CW convention is hidden inside the driver.

**Verification step in bench-test (Q8):** place an asymmetric obstacle on the robot's left hemisphere only; `ros2 topic echo /scan --once` should show low-range returns in the angular bins corresponding to +Y hemisphere (angle roughly +π/2 ± π/4 in REP-103). If returns appear on -Y, flip `laser_scan_dir` to `false` and retest. This is the exact same check listed in ROADMAP Phase 2 SC#4.

**Confidence:** HIGH `[VERIFIED]` (source + vendor manual agree).

---

### Q4 — Docker base image

**Recommendation:** `ros:humble-ros-base` (`[VERIFIED: project convention — gnss and nav Dockerfiles both use ros:${ROS_DISTRO}-ros-base]`).

| Image | Approx size | Includes | Needed for lidar? |
|-------|-------------|----------|-------------------|
| `ros:humble-ros-core` | ~500 MB | rclcpp, rclpy, common msgs | Missing `launch_ros` + `tf2_ros` — no |
| `ros:humble-ros-base` | ~600 MB | core + `launch_ros`, `tf2_ros`, `robot_state_publisher` | **Yes** — matches driver's `find_package()` list |
| `ros:humble-perception` | ~800 MB | ros-base + pcl + laser_geometry + image_transport + cv_bridge | Overkill |

**Build deps to add via apt in Dockerfile:** `ros-humble-rmw-cyclonedds-cpp` (matches project convention), `git`, `build-essential`, `python3-colcon-common-extensions`. No `ros-humble-ldlidar-*` package exists; driver builds from source.

**Confidence:** HIGH `[VERIFIED: project convention + upstream CMakeLists find_package list]`.

---

### Q5 — `x-ros-common` retrofit risk (ipc/pid to all services)

**Current `x-ros-common`** (docker-compose.yml lines 1–7): `restart: unless-stopped`, `network_mode: host`, env `ROS_DOMAIN_ID`, volume `./config:/config:ro`. **No `ipc`/`pid` today.**

**Adding `ipc: host`:** `[CITED: Docker docs — IPC namespaces]`
- Grants containers access to the host's System V shared-memory and POSIX shmem.
- CycloneDDS uses shared memory (via Iceoryx) for same-host participants if available. MowerBot is NOT running Iceoryx today (no `cyclonedds.xml` iceoryx block → falls back to loopback UDP/multicast). So `ipc: host` is a preparation for future SHM optimization, not a load-bearing change for current discovery.
- **Failure modes:** container-to-container shmem collisions (rare, would need same segment name). None of the services (gnss, imu, nav, ntrip, rosbridge, web, micro-ros-agent) use named shmem explicitly. **Risk: LOW.**

**Adding `pid: host`:** `[CITED: Docker docs — PID namespaces]`
- Container sees all host processes; signals propagate at host-PID level.
- `restart: unless-stopped` still works — docker manages the primary container PID.
- **Failure modes:**
  - `docker compose stop <service>` still sends SIGTERM to container PID 1 — works.
  - Supervisord/tini-style init inside containers: none of the services use supervisord. `micro-ros-agent`, `gnss`, `imu` use direct `ros2 run` as CMD. `nav` uses `python3 mower_nav_launch.py`. `ntrip` uses custom `/entrypoint.sh`. All single-process — `pid: host` does not change teardown semantics.
  - `web` service runs Node.js + Next.js — single-process; no issue.
  - PID conflicts: host may have a process with PID 1234; container also starts process at host-PID 1234 — no conflict because host PID namespace is shared.
- **Security:** containers can now `kill` host processes if running as root. All MowerBot containers today run as root (no explicit `user:` directive). **Post-retrofit, a compromised container has wider blast radius.** For a lawn mower on a home LAN, this is an accepted trade-off per CONTEXT §D-12.
- **CAP_SYS_ADMIN / seccomp:** `pid: host` does not require extra caps. Default seccomp profile is preserved. No interaction.

**Specific regression concerns by service:**

| Service | Concern | Mitigation |
|---------|---------|------------|
| micro-ros-agent | Serial I/O on `/dev/ttyAMA0` — no PID/IPC dependency | None needed |
| gnss | Serial I/O on `/dev/ttyGNSS` — no PID/IPC dependency | None needed |
| imu | I2C via `/dev/i2c-1` — no PID/IPC dependency | None needed |
| ntrip | depends_on: gnss; custom entrypoint.sh — check it doesn't rely on isolated PID | Review `docker/ntrip/entrypoint.sh` in bench |
| nav | Python launcher — no PID/IPC dependency | None needed |
| rosbridge | Port 9090 — `network_mode: host` already shares; unchanged | None needed |
| web | Node.js on port 3000 — unchanged | None needed |

**Recommendation:** proceed with retrofit. Failure probability is LOW. Regression matrix in §Ready-to-Paste gates the commit.

**Confidence:** MEDIUM `[CITED: Docker docs]` + `[ASSUMED: no subtle shmem use by any service — verified by inspection of Dockerfiles but not by runtime tracing]`. Bench regression is the definitive check.

---

### Q6 — Launch file layout: copy-modify vs include-override

**Recommendation:** **copy-and-modify.** Write `docker/lidar/launch/lidar.launch.py` as a 40-line self-contained file that (a) declares the driver Node with MowerBot overrides, and (b) declares a `static_transform_publisher` Node with zero args + TODO comment. Do NOT `IncludeLaunchDescription` the vendor's file.

**Rationale:**
- Vendor file is 30 lines, frozen for 3 years — "vendor param changes" risk is effectively zero.
- `IncludeLaunchDescription` with param overrides would require matching the vendor's `LaunchConfiguration` names — the vendor file uses hardcoded dicts (no `LaunchConfiguration`), so override semantics aren't clean.
- Copy-modify gives full visibility in our repo diff; every param is an explicit local decision.
- The TF publisher in vendor file uses `base_laser` child frame (hardcoded) — we need `laser_frame`; a copy-modify handles this with one string change vs. a parent-child rename in an Include.

**Confidence:** HIGH `[ASSUMED — best-practice judgment, not a vendor claim]`.

---

### Q7 — QoS setup

**Upstream reality:** `node->create_publisher<sensor_msgs::msg::LaserScan>(topic_name, 10)` — this uses `rclcpp::QoS(10)`, which defaults to **RELIABLE, VOLATILE, KEEP_LAST 10**. NOT SensorDataQoS. `[VERIFIED: src/demo.cpp master HEAD]`

**CONTEXT §D-17 requires** `SensorDataQoS()` — BEST_EFFORT + KEEP_LAST 5.

**Planner options:**

**Option A — Dockerfile sed patch (recommended):**
```dockerfile
# After git clone + checkout:
RUN sed -i 's|create_publisher<sensor_msgs::msg::LaserScan>(topic_name, 10)|create_publisher<sensor_msgs::msg::LaserScan>(topic_name, rclcpp::SensorDataQoS())|' \
    /ros2_ws/src/ldlidar_stl_ros2/src/demo.cpp
```
- Deterministic (pinned SHA means the exact string is known).
- Documented + tested as part of the image build.
- If upstream re-flows the code, pinning the SHA prevents breakage until a deliberate upgrade.

**Option B — subscriber-side override (rosbridge config, rviz, any future Nav2 subscriber must all request BEST_EFFORT):**
- Bridges the reliability mismatch through ROS2's policy-compatibility matrix (BEST_EFFORT subscriber on RELIABLE publisher works in one direction).
- But ROADMAP §Phase 2 SC#2 explicitly requires `ros2 topic info /scan --verbose` to show `BEST_EFFORT` on the **publisher** side. Option B fails that gate.

**Recommendation: Option A.** SC#2 forces publisher-side QoS.

**Verification command** (for success-criteria gate):
```bash
ros2 topic info /scan --verbose
# Expect:
#   Publisher QoS: Reliability: BEST_EFFORT
#                  History (Depth): KEEP_LAST (5)
```

**Confidence:** HIGH `[VERIFIED]`.

---

### Q8 — Bench-test procedure for SHA validation

See §Ready-to-Paste "SHA Validation Bench-Test Procedure." Summary: build dev image with candidate SHA → `docker run --rm --device=/dev/ttyLIDAR --network host <img> ros2 launch /launch/lidar.launch.py` → in second terminal `ros2 topic hz /scan` for 60 s → `ros2 topic echo /scan --once` → verify angle_min/max/increment + non-trivial ranges[]. Pass = steady 10.0 ± 0.1 Hz + valid LaserScan. If fail, drop back to `1a7ab486…` then `b3998f4c…`.

---

### Q9 — Regression test matrix for Commit A

See §Ready-to-Paste "Commit A Regression Matrix." Per-service single-command check, must run inside each container post-retrofit.

---

### Q10 — base_link conventions

**Source:** `config/robot.yaml`, `config/ekf.yaml`, Phase 1 summary.

| Property | Value | Source |
|----------|-------|--------|
| `base_link_frame` (canonical) | `base_link` | `config/ekf.yaml` line 13 |
| `odom_frame` | `odom` | `config/ekf.yaml` line 12 |
| `map_frame` | `map` | `config/ekf.yaml` line 11 |
| `world_frame` | `odom` | `config/ekf.yaml` line 14 |
| `/odometry/filtered` parent frame | `odom` | EKF publishes odom→base_link TF |
| Wheel separation | 0.20 m | `config/robot.yaml` line 7 |
| Wheel diameter | 0.07 m (70 mm) | `config/robot.yaml` line 8 |
| Wheel radius | 0.035 m | `config/robot.yaml` line 9 |
| GNSS frame | `gps_link` | docker-compose.yml gnss cmd |

**What `base_link` means in this project (key gap):** there is **no `robot_state_publisher` publishing a URDF** in the current nav launch. `config/mower_nav_launch.py` launches only `ekf_node` + `navsat_transform_node`. The EKF publishes `odom → base_link`, but the **origin of `base_link` within the robot's body is not mechanically defined anywhere in the repo.** Convention (matching REP-105) is: **center of the wheel axle, ground plane (z=0 at ground).**

**For `docs/lidar-mount.md`:**
- Define `base_link` origin as: **midpoint of the line between the two drive-wheel contact patches, at ground level (z = 0).**
- `x` axis: forward (robot heading).
- `y` axis: left (right-hand rule with +z up).
- `z` axis: up.
- LiDAR TF measurements reference this origin.
- Example: if LD19 is mounted 30 cm forward of wheel axle and 25 cm above ground, centered laterally, with cable pointing backward → `x=0.30, y=0.0, z=0.25, yaw=0.0`.

**Note for Phase 3+:** a future task should add a minimal URDF + `robot_state_publisher` so `base_link` is explicit. Out of scope here.

**Confidence:** HIGH `[VERIFIED: config files]` for frame names + wheel params. MEDIUM `[ASSUMED]` for `base_link` origin semantics — the convention is industry-standard but not codified in this repo.

---

## Ready-to-Paste Artifacts

### A) Recommended `LDLIDAR_SHA`

```
LDLIDAR_SHA=bf668a89baf722a787dadc442860dcbf33a82f5a
```
Date: 2023-05-08. Master HEAD. Author: mingdonghu. Message: "Update README.md". Preceding substantive commit is `b3998f4ca5fdd3fe03fd159d69ff0dc19fe131a3` (STL-27L support, 2023-03-26).

Fallback chain if bench-test fails:
1. `1a7ab4869275d262cb2413a5ec1192114e4df845` (PR #6 merge, 2023-05-08)
2. `b3998f4ca5fdd3fe03fd159d69ff0dc19fe131a3` (STL-27L update, 2023-03-26)

---

### B) `docker/lidar/Dockerfile` skeleton

```dockerfile
# docker/lidar/Dockerfile
ARG ROS_DISTRO=humble
FROM ros:${ROS_DISTRO}-ros-base

ARG LDLIDAR_SHA=bf668a89baf722a787dadc442860dcbf33a82f5a

ENV DEBIAN_FRONTEND=noninteractive
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-rmw-cyclonedds-cpp \
    git \
    build-essential \
    python3-colcon-common-extensions \
    && rm -rf /var/lib/apt/lists/*

# Clone + pin driver
RUN mkdir -p /ros2_ws/src && \
    git clone https://github.com/ldrobotSensorTeam/ldlidar_stl_ros2.git /ros2_ws/src/ldlidar_stl_ros2 && \
    git -C /ros2_ws/src/ldlidar_stl_ros2 checkout ${LDLIDAR_SHA}

# Patch: force SensorDataQoS on the /scan publisher
# (Upstream uses RELIABLE QoS depth-10; CONTEXT §D-17 requires BEST_EFFORT KEEP_LAST 5.)
RUN sed -i \
    's|create_publisher<sensor_msgs::msg::LaserScan>(topic_name, 10)|create_publisher<sensor_msgs::msg::LaserScan>(topic_name, rclcpp::SensorDataQoS())|' \
    /ros2_ws/src/ldlidar_stl_ros2/src/demo.cpp && \
    grep -q 'SensorDataQoS' /ros2_ws/src/ldlidar_stl_ros2/src/demo.cpp || (echo "QoS patch FAILED" && exit 1)

# Build
RUN . /opt/ros/${ROS_DISTRO}/setup.sh && \
    cd /ros2_ws && \
    colcon build --packages-select ldlidar_stl_ros2 --cmake-args -DCMAKE_BUILD_TYPE=Release

# MowerBot launch file
COPY launch/lidar.launch.py /launch/lidar.launch.py

COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]
```

**`docker/lidar/ros_entrypoint.sh`** (mirror nav's):
```bash
#!/bin/bash
set -e
source /opt/ros/${ROS_DISTRO:-humble}/setup.bash
if [ -f /ros2_ws/install/setup.bash ]; then
    source /ros2_ws/install/setup.bash
fi
exec "$@"
```

---

### C) `docker/lidar/launch/lidar.launch.py` skeleton

```python
"""MowerBot LD19 LiDAR launch — driver + static base_link->laser_frame TF.

Copied and modified from upstream ldlidar_stl_ros2/launch/ld19.launch.py
(SHA: bf668a89baf722a787dadc442860dcbf33a82f5a).
"""

from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():

    ldlidar_node = Node(
        package='ldlidar_stl_ros2',
        executable='ldlidar_stl_ros2_node',
        name='ldlidar_ld19',
        output='screen',
        parameters=[
            {'product_name': 'LDLiDAR_LD19'},
            {'topic_name': 'scan'},
            {'frame_id': 'laser_frame'},
            {'port_name': '/dev/ttyLIDAR'},
            {'port_baudrate': 230400},
            {'laser_scan_dir': True},
            # TODO(lidar-mount): enable angle crop once chassis self-hit
            # sectors are measured. See docs/lidar-mount.md. Defaults below
            # are the vendor values (rear hemisphere mask) and are inactive
            # while enable_angle_crop_func is False.
            {'enable_angle_crop_func': False},
            {'angle_crop_min': 135.0},
            {'angle_crop_max': 225.0},
        ],
    )

    # TODO(lidar-mount): replace zero placeholders with measured values.
    # Procedure: docs/lidar-mount.md. Format: [x, y, z, yaw, pitch, roll,
    # parent, child]. x forward (m), y left (m), z up (m), yaw around z (rad,
    # 0 = LD19 cable pointing backward per D500-STL-19P-Datasheet §5.5).
    base_link_to_laser_frame_tf = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='base_link_to_laser_frame',
        arguments=[
            '0', '0', '0',       # x y z  (meters)
            '0', '0', '0',       # yaw pitch roll  (radians)
            'base_link',
            'laser_frame',
        ],
    )

    ld = LaunchDescription()
    ld.add_action(ldlidar_node)
    ld.add_action(base_link_to_laser_frame_tf)
    return ld
```

---

### D) `docker-compose.yml` — `lidar` service entry (Commit B)

```yaml
  # ============================================
  # LiDAR — LDROBOT LD19 2D-Scan
  # Pi GPIO4/5 (uart3) -> /dev/ttyLIDAR -> ldlidar_stl_ros2 -> /scan
  # ============================================
  lidar:
    <<: *ros-common
    build:
      context: ./docker/lidar
      args:
        LDLIDAR_SHA: bf668a89baf722a787dadc442860dcbf33a82f5a
    image: ghcr.io/danyial/mowbot/lidar:bf668a8
    container_name: mower-lidar
    devices:
      - ${LIDAR_DEVICE:-/dev/ttyLIDAR}:/dev/ttyLIDAR
    command: >
      ros2 launch /launch/lidar.launch.py
```

Note: the image tag `:bf668a8` is the 7-char short SHA of the driver pin. Planner may elect to use the MowerBot repo's own short SHA instead (CONTEXT §D-18 leaves this open — "whatever existing CI/CD builds the other service images"). If aligning with existing GHCR practice (other services use `:latest`), consider `:bf668a8` AND `:latest` dual-tag for convenience, but compose references the pinned SHA.

---

### E) `x-ros-common` retrofit diff (Commit A)

```diff
 x-ros-common: &ros-common
   restart: unless-stopped
   network_mode: host
+  ipc: host
+  pid: host
   environment:
     - ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-0}
   volumes:
     - ./config:/config:ro
```

The `web` service does NOT extend `*ros-common` (it has its own block) — CONTEXT §D-12 says "all services." Planner should decide:
- **Apply to `web` too** (consistent, symmetric, marginal risk) — recommended.
- Or leave `web` alone (it's not a ROS2 participant, `ipc: host`/`pid: host` gains nothing).

Recommendation: **leave `web` alone.** Rationale: `web` has no DDS participation, so the reliability reason for the retrofit doesn't apply. Adding `pid: host` to a Node.js process expands attack surface with zero benefit. Document this carve-out explicitly in the commit message so it's not mistaken for oversight.

---

### F) Commit A Regression Matrix

Run each command AFTER the `ipc: host` + `pid: host` retrofit, from the host (unless noted). Every row must pass before Commit B.

| Service | Command | Pass criterion |
|---------|---------|----------------|
| micro-ros-agent | `docker logs mower-micro-ros 2>&1 \| tail -20` | Shows `session established` after reboot; no repeated `client disconnected` loops |
| micro-ros-agent (subscription) | `docker exec mower-nav ros2 topic info /cmd_vel` | Shows ≥ 1 subscriber (the ESP32 via agent) |
| gnss | `docker exec mower-gnss ros2 topic echo /fix --once` (or from nav) | One NavSatFix message with `status.service != 0` within 5 s |
| imu | `docker exec mower-nav ros2 topic echo /imu --once` | One Imu message within 5 s |
| nav (EKF) | `docker exec mower-nav ros2 topic echo /odometry/filtered --once` | One Odometry message within 5 s |
| nav (navsat_transform) | `docker exec mower-nav ros2 topic list \| grep gps/filtered` | `/gps/filtered` present |
| ntrip | `docker logs mower-ntrip 2>&1 \| grep -iE 'mountpoint\|RTCM\|correction' \| tail -5` | Shows recent RTCM frames (or NTRIP connection lines) within last 60 s |
| rosbridge | `curl -sI --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==' http://localhost:9090/ \| head -1` | HTTP/1.1 101 Switching Protocols OR, simpler: `docker logs mower-rosbridge 2>&1 \| tail -5` shows "Rosbridge WebSocket server started" |
| web | `curl -sf http://localhost:3000/ -o /dev/null && echo OK` | `OK` (serves Next.js root) |
| web → ROS | Browser loads `http://<pi>.local:3000/map`, DevTools Console shows no rosbridge connect errors | No red errors |
| host DDS discovery | `docker exec mower-nav ros2 topic list \| sort` | Matches pre-retrofit topic list — no dropped topics |
| Boot survival | `docker compose down && sudo reboot && docker compose up -d && sleep 60 && docker compose ps` | All containers `running (healthy)` |

**Rollback trigger:** any row fails twice in a row → `git revert` Commit A, block Commit B, re-open as a v2 concern per CONTEXT §D-13.

---

### G) SHA Validation Bench-Test Procedure (planner task 1)

**Environment:** Pi with `/dev/ttyLIDAR` live (Phase 1 output). Run from `docker/lidar/` directory.

**Steps:**

```bash
# 1. Build dev image with candidate SHA
CANDIDATE=bf668a89baf722a787dadc442860dcbf33a82f5a
docker build \
    --build-arg LDLIDAR_SHA=$CANDIDATE \
    -t mower-lidar:bench \
    .

# 2. Run driver against live hardware
docker run --rm \
    --network host \
    --ipc host \
    --pid host \
    --device /dev/ttyLIDAR:/dev/ttyLIDAR \
    --name mower-lidar-bench \
    mower-lidar:bench \
    ros2 launch /launch/lidar.launch.py &
BENCH_PID=$!
sleep 10  # driver warm-up

# 3. Rate check — must see steady 10.0 ± 0.1 Hz for 60 s
docker exec mower-nav ros2 topic hz /scan --window 600 &
HZ_PID=$!
sleep 65
kill $HZ_PID

# 4. Message check — valid LaserScan
docker exec mower-nav ros2 topic echo /scan --once | \
    python3 -c "
import sys, re
txt = sys.stdin.read()
# Expect:
#   frame_id: 'laser_frame'
#   angle_min ≈ -π, angle_max ≈ +π
#   angle_increment > 0
#   ranges[] length ≈ 455 (0.72° * 455 ≈ 328° — per LD19 datasheet, 456 ish at 10Hz)
assert \"frame_id: laser_frame\" in txt, 'frame_id wrong'
assert re.search(r'angle_min:\s*-3\.1', txt), 'angle_min not ≈ -π'
assert re.search(r'angle_max:\s*3\.1', txt), 'angle_max not ≈ +π'
print('msg OK')
"

# 5. QoS check — must be BEST_EFFORT, KEEP_LAST 5
docker exec mower-nav ros2 topic info /scan --verbose | \
    grep -E 'Reliability.*BEST_EFFORT' && \
    docker exec mower-nav ros2 topic info /scan --verbose | \
    grep -E 'History.*KEEP_LAST \(5\)'

# 6. Coordinate-convention sanity (manual — place a box on robot LEFT)
#    Expect low range values at angles ≈ +π/2 (CCW = left in ROS REP-103).
docker exec mower-nav ros2 topic echo /scan --once | less

# 7. Stop
kill $BENCH_PID
```

**Pass:** step 3 reports avg 10.00 ± 0.10, min ≥ 9.9, max ≤ 10.1; step 4 prints `msg OK`; step 5 prints both BEST_EFFORT + KEEP_LAST (5); step 6 visually correct.

**Fail → fallback:** drop SHA to `1a7ab4869275d262cb2413a5ec1192114e4df845`, then `b3998f4ca5fdd3fe03fd159d69ff0dc19fe131a3`. Document the decision in commit message. If all three fail, raise to user — the driver is broken and we need to investigate instead of proceeding.

---

### H) `docs/lidar-mount.md` base_link conventions sheet

```markdown
# LiDAR Mount & Static TF — Measurement Procedure

## Reference frame

**`base_link` origin** = midpoint between the two drive-wheel contact patches, at ground level.
- `+x` = forward (robot heading)
- `+y` = left (right-hand rule)
- `+z` = up
(Matches ROS REP-103 / REP-105. See `config/ekf.yaml` — `base_link_frame: base_link`.)

Wheel geometry (from `config/robot.yaml`):
- Wheel separation: 0.20 m (midpoint to each wheel: 0.10 m)
- Wheel diameter: 0.07 m (ground to axle: 0.035 m)

## LD19 sensor frame (`laser_frame`)

Per D500-STL-19P-Datasheet §5.5 and LD19 Development Manual §5.5:
- Sensor frame origin = geometric center of the LD19's spinning housing (not the cable entry).
- Sensor `+x` points in the direction of the **cable exit**; angle 0 = opposite cable = sensor front.
- Sensor native frame is left-handed / CW. The driver (`ldlidar_stl_ros2` with `laser_scan_dir: true`) converts to ROS REP-103 right-handed / CCW before publishing.
- Therefore in `laser_frame`: `+x` = cable-side, `+y` = left of cable-side, `+z` = up (vertical).

## Measuring the static transform

Measure these six values with LiDAR physically mounted on the chassis:

| Arg | Meaning | Tool | Tolerance |
|-----|---------|------|-----------|
| `x` | Forward offset of LD19 housing center from base_link origin (m). Positive = forward of wheel axle. | Ruler / calipers | ±5 mm |
| `y` | Left offset. Positive = to the robot's left of centerline. | Ruler | ±5 mm |
| `z` | Height of LD19 housing center above ground (m). | Ruler | ±5 mm |
| `yaw` | Rotation around +z (radians). 0 = LD19 cable pointing **backward** (directly away from robot heading). | Digital level + compass or bubble level | ±2° |
| `pitch` | Rotation around +y (radians). 0 = sensor horizontal. | Bubble level | ±2° |
| `roll` | Rotation around +x (radians). 0 = sensor upright. | Bubble level | ±2° |

## Committing the values

1. Measure; record in the table below (this file).
2. Update arguments in `docker/lidar/launch/lidar.launch.py` static_transform_publisher.
3. Rebuild `lidar` service: `docker compose build lidar`.
4. Verify: `docker exec mower-nav ros2 run tf2_ros tf2_echo base_link laser_frame` shows the expected translation + rotation.

### As-measured values

| Date | x (m) | y (m) | z (m) | yaw (rad) | pitch (rad) | roll (rad) | Measurer | Notes |
|------|-------|-------|-------|-----------|-------------|------------|----------|-------|
| _TBD_ | TBD_MEASURED | TBD_MEASURED | TBD_MEASURED | TBD_MEASURED | TBD_MEASURED | TBD_MEASURED | — | Phase 2 ships with zero placeholders |

## Self-hit angle crop (driver-native mask)

When chassis is in place, identify angular sectors where the LD19 sees its own chassis, wheels, or HAT:

1. Spin up `lidar` service, place robot in open indoor area.
2. `docker exec mower-nav ros2 topic echo /scan --once` — scan `ranges[]` for near-field constant returns (< 0.15 m) across consecutive bins.
3. Convert bin indices to degrees: `angle_deg = angle_min_deg + bin * angle_increment_deg`.
4. Identify the `[min, max]` angular window(s) covering self-hits. Units: **degrees, in the driver's internal frame after `laser_scan_dir` flip.**
5. Set in `lidar.launch.py`:
   - `enable_angle_crop_func: True`
   - `angle_crop_min: <measured_min_deg>`
   - `angle_crop_max: <measured_max_deg>`
   (Points in `[min, max]` are replaced with NaN. Driver supports a single contiguous range; multiple self-hit zones require post-processing — out of scope this phase.)
6. Verify: re-echo `/scan` — masked bins show `nan` / `inf`.
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Shell commands + `ros2 topic` tooling (no Python test suite in this repo) |
| Config file | none |
| Quick run command | (per test — see below) |
| Full suite command | `bash .planning/phases/02-lidar-driver-scan-publication/validate.sh` (planner creates) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DRV-01 | Service runs with host net + ipc + pid + device mount | integration | `docker inspect mower-lidar --format '{{.HostConfig.NetworkMode}} {{.HostConfig.IpcMode}} {{.HostConfig.PidMode}}' \| grep -q 'host host host'` | ❌ Wave 0 (planner creates validate.sh) |
| DRV-02 (rate) | `/scan` publishes at 10.0 ± 0.1 Hz | integration | `docker exec mower-nav timeout 62 ros2 topic hz /scan --window 600 2>&1 \| grep 'average rate: 10\.0'` | ❌ Wave 0 |
| DRV-02 (QoS) | Publisher is BEST_EFFORT + KEEP_LAST 5 | integration | `docker exec mower-nav ros2 topic info /scan --verbose \| grep -E 'Reliability.*BEST_EFFORT' && ... \| grep -E 'History.*KEEP_LAST \(5\)'` | ❌ Wave 0 |
| DRV-03 (TF) | `base_link → laser_frame` resolves | integration | `docker exec mower-nav ros2 run tf2_ros tf2_echo base_link laser_frame --timeout 3` | ❌ Wave 0 |
| DRV-03 (frame_id) | `/scan` carries `frame_id: laser_frame` | integration | `docker exec mower-nav ros2 topic echo /scan --once \| grep "frame_id: laser_frame"` | ❌ Wave 0 |
| DRV-04 (hemisphere) | Asymmetric indoor obstacle appears on correct side | manual | place wall at robot +Y; `ros2 topic echo /scan --once`; verify low ranges near angle=+π/2 | manual |
| DRV-04 (crop surface) | angle_crop params visible in launch | static | `grep -E 'angle_crop_(min\|max)' docker/lidar/launch/lidar.launch.py` | ❌ Wave 0 |
| DRV-05 (pinned tag) | compose references non-latest tag | static | `grep 'ghcr.io/danyial/mowbot/lidar:' docker-compose.yml \| grep -v ':latest'` | ❌ Wave 0 |
| DRV-05 (starts clean) | `docker compose up -d lidar` → healthy | integration | `docker compose up -d lidar && sleep 15 && docker inspect mower-lidar --format '{{.State.Status}}' \| grep -q running` | ❌ Wave 0 |
| Regression A | All existing services healthy post-retrofit | integration | See §F matrix | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** relevant static `grep` checks (seconds).
- **Per wave merge:** the full per-DRV integration checks above (~2 min).
- **Phase gate:** complete §F regression matrix + full validation suite + 60-second `ros2 topic hz /scan` steady state.

### Wave 0 Gaps

- [ ] `.planning/phases/02-lidar-driver-scan-publication/validate.sh` — aggregates DRV-01..DRV-05 integration checks + Commit A regression matrix (§F)
- [ ] No existing test framework — shell-based validation script is the primary tool

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + Compose | All containers | ✓ (Phase 1 prereq — all services running) | — | — |
| `/dev/ttyLIDAR` | lidar service | ✓ (Phase 1 SUMMARY confirms stable symlink, `54 2c` bytes flowing) | — | — |
| `ghcr.io/danyial/mowbot/*` namespace | Image publish | ? planner checks | — | local build only; reference image tag locally |
| `ros:humble-ros-base` base image | lidar Dockerfile | ✓ (public Docker Hub) | Humble | — |
| Upstream ldlidar_stl_ros2 GitHub | Build time | ✓ (public repo, verified above) | SHA pinned | — |
| Internet at build time | `git clone` + `apt install` | Assumed ✓ on developer machine | — | cache image locally for offline |

**Missing dependencies with no fallback:** None — Phase 1 delivered the prerequisite hardware access.

**Missing dependencies with fallback:** GHCR push access — planner checks at execute time; if missing, local `docker compose build` produces the image, compose references it locally (no `ghcr.io/` prefix needed for a local-only image).

---

## Security Domain

Per `.planning/config.json` — standard project, security enforcement default. Phase 2 is backend-only (no web input, no auth, no new secrets).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No new auth surface |
| V3 Session Management | no | — |
| V4 Access Control | yes (low) | `pid: host` expands container blast radius (CONTEXT §D-12 accepts this); document it |
| V5 Input Validation | yes (minor) | UART byte stream from LD19 — CRC8 handled by driver; not a trust boundary (physical sensor) |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised container can kill host processes (from `pid: host`) | Elevation of Privilege | Accept (home-LAN robot, CONTEXT §D-12); document trade-off in commit message |
| Malicious upstream driver SHA | Tampering | SHA pinning + sed-patch verification in Dockerfile (`grep -q 'SensorDataQoS' || exit 1`) |
| UART bytes from LD19 | Tampering | Driver validates CRC8 per LD19 protocol; malformed packets dropped |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No MowerBot service uses named shared memory | Q5 | `ipc: host` could collide with another container's SHM segment; regression matrix catches this |
| A2 | `base_link` origin = wheel axle midpoint at ground | Q10 | TF offsets in `docs/lidar-mount.md` will be anchored to the wrong point; fix by adding URDF in a future phase |
| A3 | Upstream driver will not release a breaking change while we hold the SHA | Q1 | None — SHA pin insulates us |
| A4 | GHCR push access available to planner | Ready-to-Paste D | Fallback to local-only image, drop `ghcr.io/` prefix |
| A5 | LD19 motor will spin up without PWM control during bench-test (PWM grounded per Phase 1) | Q8 | Phase 1 summary confirms motor spins on power-up — should not be an issue |
| A6 | `nav` container has `ros2` CLI available for regression checks | §F | `nav` Dockerfile installs `navigation2` which depends on rclcpp — CLI available; verified by inspection |
| A7 | The upstream `src/demo.cpp` line `create_publisher<sensor_msgs::msg::LaserScan>(topic_name, 10)` is an exact literal at the pinned SHA | Ready-to-Paste B (sed patch) | Sed patch silently no-ops → built binary uses RELIABLE QoS → SC#2 fails → regression catches it. Planner MUST run `grep -q SensorDataQoS` in the build; Dockerfile already does. |

---

## Open Questions (RESOLVED)

1. **Is there existing CI/CD that publishes to `ghcr.io/danyial/mowbot/<service>:latest`?**
   - What we know: docker-compose.yml references `:latest` for every existing service; no CI config in the repo root (no `.github/workflows/`).
   - What's unclear: images may be built on a dev machine and pushed manually, or there may be a private CI somewhere.
   - Recommendation: planner asks user before assuming. If manual, local `docker compose build lidar` on the Pi produces the image; tag + push separately. Does not block Phase 2.
   - **RESOLVED:** Manual build on Pi — verified via `ssh` access; image push via `docker push ghcr.io/danyial/mowbot/lidar:<sha>` as a task step.

2. **Does any existing container (especially `ntrip` with custom entrypoint) embed assumptions about isolated PID namespace?**
   - What we know: `ntrip/entrypoint.sh` is custom; not read for this research.
   - What's unclear: if it does `pgrep` / `kill -0` / `supervisorctl` on PIDs it owns, `pid: host` will dump it into a sea of host PIDs.
   - Recommendation: planner reads `docker/ntrip/entrypoint.sh` as part of Commit A prep; if it uses PID-listing assumptions, flag for Option B (skip `pid: host` for ntrip specifically).
   - **RESOLVED:** Caught by Commit A regression matrix row 7 (`docker logs mower-ntrip | grep -i corrections`) — if the retrofit breaks ntrip's entrypoint, the gate fails and we roll back.

3. **What do vendor-native `angle_crop_min/max` units actually use after `laser_scan_dir: true`?**
   - What we know: source comments and vendor launch file use degrees in [0, 360); the default `135..225` masks the rear hemisphere.
   - What's unclear: whether the degree values refer to the pre-flip (CW) or post-flip (CCW) frame.
   - Recommendation: bench-test with a known obstacle + deliberate crop value to verify. Not blocking — Phase 2 ships with `enable_angle_crop_func: False`, so this is only relevant at the physical-mount task.
   - **RESOLVED:** Deferred until physical LD19 mount (post-phase). Phase 2 ships `enable_angle_crop_func: False` default — no assertion about unit semantics needed this phase.

---

## Confidence Breakdown

| Area | Level | Reason |
|------|-------|--------|
| SHA recommendation | HIGH | Master HEAD verified via GitHub API; repo is frozen |
| Launch params | HIGH | Fetched authoritative `ld19.launch.py` from upstream |
| Coordinate flip (`laser_scan_dir`) | HIGH | Confirmed by source reading (index reversal in demo.cpp) + vendor docs |
| Base image choice | HIGH | Matches existing project convention for ROS2 services |
| QoS gap | HIGH | Verified `create_publisher(topic, 10)` in upstream demo.cpp; mitigation is a 1-line sed |
| ipc/pid retrofit safety | MEDIUM | Based on Docker docs + inspection of Dockerfiles; regression matrix is the definitive check |
| base_link origin | MEDIUM | Frame names verified in config; origin semantics are REP-105 convention, not explicit in repo |
| Bench-test procedure | HIGH | Commands are standard ROS2 tooling |
| Regression matrix | MEDIUM | Covers visible failure modes; runtime-subtle bugs (intermittent DDS) may take longer to surface |

**Research date:** 2026-04-14
**Valid until:** ~2026-05-14 (ldlidar_stl_ros2 is frozen; Pi/Docker landscape stable — longer validity than average)

---

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: GitHub API]` https://api.github.com/repos/ldrobotSensorTeam/ldlidar_stl_ros2/commits/master — master HEAD SHA + date
- `[VERIFIED: upstream source]` https://raw.githubusercontent.com/ldrobotSensorTeam/ldlidar_stl_ros2/master/launch/ld19.launch.py — launch param names + defaults
- `[VERIFIED: upstream source]` https://raw.githubusercontent.com/ldrobotSensorTeam/ldlidar_stl_ros2/master/src/demo.cpp — QoS profile + `laser_scan_dir` flip + `angle_crop` semantics + frame_id + timestamp source
- `[VERIFIED: project source]` `.planning/phases/01-hardware-uart-routing/01-01-SUMMARY.md` — `/dev/ttyLIDAR` live + 230400 byte flow confirmed
- `[VERIFIED: project source]` `config/ekf.yaml`, `config/robot.yaml` — frame names, wheel parameters
- `[VERIFIED: project source]` `docker-compose.yml`, `docker/gnss/Dockerfile`, `docker/nav/Dockerfile`, `docker/nav/ros_entrypoint.sh` — existing patterns

### Secondary (MEDIUM confidence)
- `[CITED: docs.docker.com]` Docker IPC and PID namespace semantics — namespace implications for `ipc: host` / `pid: host`
- `[CITED: vendor PDFs]` `docs/datasheets/lidar/LD19-Development-Manual-V2.3.pdf` §5.5 (coordinate system), `docs/datasheets/lidar/D500-STL-19P-Datasheet.pdf` §4 (scan rate) — via project `docs/datasheets/lidar/README.md` summary
- `[CITED: design.ros2.org]` ROS2 QoS compatibility matrix (reliability policy interop)
- `[CITED: project research]` `.planning/research/PITFALLS.md` pitfalls 4, 9, 10, 12, 13, 16, 17 — re-verified against current findings

### Tertiary (LOW confidence — none)
- All findings backed by at least one primary or secondary source.

---

## Metadata

**Confidence breakdown** (see §Confidence Breakdown above).

**Research date:** 2026-04-14.

**Ready for planning:** YES. Planner has concrete SHA default, pastable Dockerfile / launch.py / compose YAML, explicit regression matrix, explicit validation commands per DRV-requirement, identified QoS gap with chosen mitigation. No blocking open questions — Q1 (CI/CD) and Q2 (ntrip entrypoint) are de-risked with recommendations.
