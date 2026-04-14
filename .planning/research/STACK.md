# Stack Research — LD19 LiDAR Integration

**Domain:** 2D LiDAR integration into existing ROS2 Humble + Pi 4 + Next.js robotic lawn mower
**Researched:** 2026-04-14
**Confidence:** HIGH (drivers, protocol, Pi UART) / MEDIUM (web viz — multiple valid paths)

## Scope

This research is scoped tightly to the LD19 addition. It does **not** re-recommend the existing stack (ROS2 Humble, CycloneDDS, micro-ROS, Next.js 16/React 19, roslibjs, Leaflet). Those are treated as fixed constraints. See `.planning/codebase/STACK.md` for the existing baseline.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `ldlidar_stl_ros2` (LDROBOT official) | master @ current HEAD | ROS2 driver that opens the LD19 serial port, parses the 0x54/0x2C DTOF packet stream, and publishes `sensor_msgs/LaserScan` on `/scan` | Manufacturer-maintained, explicitly lists LD19 as a supported model, handles CRC8, intensity, angle cropping, and scan-direction flip out of the box. Referenced by every recent LD19 tutorial (incl. Nov 2025 STL-19P guide). Clean CMake/colcon build that drops into the existing docker-per-node pattern. |
| Raspberry Pi 4 `uart3` via `dtoverlay=uart3` | BCM2711 hardware PL011 | Dedicated hardware UART for LD19 @ 230400 baud on GPIO4 (TXD3) / GPIO5 (RXD3) — LD19 only needs RX from Pi's perspective (one-way sensor → host) | GPIO14/15 (`ttyAMA0`) is already burned by the ESP32 HAT link at 115200 and cannot be shared. `uart2` (GPIO0/1) conflicts with the ID_EEPROM I2C lines reserved for HAT autodetect. `uart4` (GPIO8/9) conflicts with the WS2812 status LED (GPIO8) already used by the HAT firmware. `uart5` (GPIO12/13) is free but adjacent to the BTS7960 PWM lines on the existing HAT; `uart3` on GPIO4/5 is the cleanest free pair. Hardware PL011 (not miniUART) means 230400 is rock-solid — miniUART `ttyS0` is tied to the VPU clock and drifts at non-115200 rates. |
| `linux-serial` / udev symlink (`/dev/ttyLIDAR`) | n/a | Stable device path for the driver container to mount | Mirrors the existing `/dev/ttyESP32` and `/dev/ttyGNSS` pattern in `udev/99-mower.rules`. The `uart3` overlay exposes the port as `/dev/ttyAMA1` on Pi 4 (numbering of PL011 instances after ttyAMA0); a udev symlink decouples the compose file from kernel enumeration order. |
| Docker service `ldlidar` (new) | ROS2 Humble base image | Containerized ROS2 node running `ldlidar_stl_ros2`, publishing `/scan` over CycloneDDS on host network | Consistent with existing `docker/gnss`, `docker/imu`, `docker/micro-ros-agent` layout: one Dockerfile per node, `network_mode: host`, device file mounted in via `devices:`, config dropped in via volume mount. No architectural novelty. |
| `roslibjs` (already in stack) | 2.1.0 | Browser subscription to `/scan` over existing rosbridge proxy | Already in `package.json`. `sensor_msgs/LaserScan` is a plain JSON message (ranges[], intensities[], angle_min, angle_max, angle_increment) — no binary framing concerns. |
| Custom HTML5 Canvas 2D polar renderer | — (vanilla React 19) | Draws scan points as a polar overlay on the existing Leaflet map page | LaserScan is ~450 points @ 10 Hz — trivial workload for 2D canvas. Avoids dragging in Three.js/react-three-fiber just for 2D polar dots. `ros3djs` is effectively unmaintained (last meaningful release 2019) and couples to legacy Three.js versions; not a good citizen in a React 19 + Next.js 16 app. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sensor_msgs` (ROS2 Humble) | bundled | `LaserScan` message type | Always — it's what the driver publishes and rosbridge serializes |
| `tf2_ros` static_transform_publisher | bundled | Static TF from `base_link` → `laser` frame so downstream consumers (future Nav2, slam_toolbox) have a correct frame tree | Launch once per boot; can live in the same launch file as the driver |
| Existing NaN sanitization layer (`web/server.mjs`) | in-tree | Strips NaN from JSON before it hits the browser | LD19 emits NaN / Inf for out-of-range points in LaserScan `ranges[]`; the existing sanitizer already handles this for `/fix` — it will work unchanged for `/scan` |
| `rosbridge_suite` (already running) | Humble | WS bridge for browser | Already deployed; just add `/scan` to the topic allow-list if one is configured |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `picocom` / `minicom` @ 230400 8N1 | Bench-test the LD19 packet stream before wiring up ROS2 | `picocom -b 230400 /dev/ttyAMA1` — expect binary garbage; confirms electrical + permissions |
| `ros2 topic hz /scan` | Verify scan rate (~10 Hz nominal for LD19) | First thing to run after the driver container starts |
| `rviz2` (optional, X-forwarded or on dev laptop) | Sanity-check the scan visually before wiring web viz | Not required for the milestone, but saves a round trip if web rendering looks wrong |

## Pi 4 UART Wiring — Prescriptive

**Enable in `/boot/firmware/config.txt` (Ubuntu 22.04) or `/boot/config.txt` (Raspberry Pi OS):**

```ini
enable_uart=1          # already set for ttyAMA0
dtoverlay=uart3        # adds /dev/ttyAMA1 on GPIO4(TX)/GPIO5(RX)
```

**Wiring to LD19 (LD19 has only 4 wires — VCC 5V, GND, TX, RX pin present but unused):**

| LD19 pin | Pi 4 pin (physical / BCM) |
|----------|---------------------------|
| VCC (5V) | Pin 4 (5V rail) or HAT-regulated 5V |
| GND | Pin 6 or any GND |
| TX (data out) | Pin 7 / GPIO4 — Pi's RXD3 |
| RX (unused) | leave unconnected |

LD19 is **one-way**: it starts streaming the moment power is applied, no host commands. Pi's TXD3 is not needed.

**HAT revision note:** GPIO4/5 pass through the 40-pin stacking header, so the existing v2.0 HAT does not strictly need a respin — a wire pigtail or a small daughter connector on the pass-through header is sufficient for this milestone. A cleaner HAT v2.1 with a dedicated LD19 JST-GH footprint is a follow-up, not a blocker.

## Installation

**ROS2 driver (new docker/ldlidar/Dockerfile):**

```bash
# Inside container build
git clone https://github.com/ldrobotSensorTeam/ldlidar_stl_ros2.git \
  /ros2_ws/src/ldlidar_stl_ros2
cd /ros2_ws && colcon build --packages-select ldlidar_stl_ros2
```

**Launch parameters (LD19-specific):**

```yaml
product_name: 'LDLiDAR_LD19'
topic_name: '/scan'
frame_id: 'laser'
port_name: '/dev/ttyLIDAR'   # udev symlink → /dev/ttyAMA1
port_baudrate: 230400
laser_scan_dir: true         # flip if scan appears mirrored
enable_angle_crop_func: false
```

**Web (no new deps):**

```bash
# Nothing to install — roslib 2.1.0 and React 19 already present.
# Add a new component: web/components/lidar-scan-overlay.tsx
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `ldlidar_stl_ros2` (official) | `Myzhar/ldrobot-lidar-ros2` | If you need ROS2 Lifecycle-node semantics (managed start/stop/configure transitions) — Myzhar's fork wraps the driver as a LifecycleNode, nicer for Nav2 bring-up orchestration later. Downside: more ceremony, and it pulls `nav2_utils` which is heavier than this milestone needs. Reasonable to swap to this in the Nav2 milestone. |
| `ldlidar_stl_ros2` | `ldlidar_ros2` ("NEW" from same vendor) | If you later add an LD14 / LD14P unit to the fleet — the `_ros2` repo adds LD14 support but is earlier in its lifecycle (17 commits vs the mature `_stl_ros2`). No upside for LD19-only today. |
| `ldlidar_stl_ros2` | `richardw347/ld19_lidar` | Minimal single-purpose driver; useful as a reference implementation or if debugging a parser issue, but abandoned-ish and no intensity/angle-crop features. |
| Hardware `uart3` on GPIO4/5 | USB-UART dongle on Pi USB port | If the HAT cannot be modified at all and pigtailing to GPIO4/5 is unacceptable. Downside: consumes a USB port, adds a CP2102/CH340 between you and the sensor, and creates a fourth device-path (`/dev/ttyUSB0`) to udev-symlink. Works, but less clean than the native PL011 route. |
| Hardware `uart3` | `uart5` on GPIO12/13 | If GPIO4/5 are needed for a future peripheral (e.g. 1-Wire temp sensor). `uart5` is electrically equivalent but physically closer to the BTS7960 PWM traces on the existing HAT — slightly worse EMI story for a 230400 baud signal. |
| Canvas 2D polar overlay | `react-three-fiber` + drei | If you later want to render a fused 3D scene (robot model + scan + path + costmap) on a dedicated 3D view page. Overkill for a 2D polar dot cloud on the existing Leaflet map. |
| Canvas 2D polar overlay | Foxglove Studio (embedded or standalone) | If you want pro-grade multi-panel robot observability and are willing to run it alongside the existing Next.js dashboard. Not a replacement for the dashboard — it's a different tool aimed at developers, not end-users. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `ttyS0` (miniUART) on Pi 4 for LD19 | miniUART baud clock is derived from the VPU core clock and jitters at non-115200 rates; 230400 is unreliable and drops bytes → CRC8 failures in the LD19 packet parser | Any PL011-backed UART (`ttyAMA1` via `dtoverlay=uart3`) |
| `dtoverlay=uart2` (GPIO0/1) | Collides with the HAT ID EEPROM I2C lines that Pi firmware probes at boot for HAT autodetect; breaks the v2.0 HAT's existing identification | `dtoverlay=uart3` on GPIO4/5 |
| `dtoverlay=uart4` (GPIO8/9) | GPIO8 drives the WS2812 status LED on the existing HAT — taking it for UART kills the status LED feature | `dtoverlay=uart3` |
| Routing LD19 through the ESP32 as a pass-through | Adds 115200-baud serialization + micro-ROS message overhead + ESP32-C3 single-core CPU budget (already running motor control + encoder ISRs + watchdog) to a 230400 baud sensor stream with real-time constraints. Will drop scan points under load. | Direct Pi UART connection |
| `ros3djs` for LaserScan viz | Last meaningful release 2019, pinned to legacy Three.js, unmaintained, poor fit for React 19 + Next.js 16 App Router and server components | Plain Canvas2D component, or react-three-fiber if 3D is genuinely needed |
| `ros2djs` for LaserScan viz | Similarly unmaintained; was never first-class for LaserScan (designed for occupancy grids) | Plain Canvas2D component |
| `ld19_lidar` (richardw347) as the production driver | Narrower feature set, less active, no angle-crop / intensity handling — fine as a reference but not as the deployed driver | `ldlidar_stl_ros2` |

## Stack Patterns by Variant

**If the wire run from LD19 to Pi is > 20 cm (mower chassis mounting):**
- Keep `dtoverlay=uart3` but add a series resistor (~330Ω) on the LD19 TX line and a 100nF decoupling cap at the Pi end
- Consider shielded cable; 230400 baud TTL is not bulletproof over long unshielded jumpers near motor PWM

**If the web dashboard later needs to render multiple lidars or fused pointclouds:**
- Graduate from Canvas2D to `react-three-fiber` + `@react-three/drei`
- Use `BufferGeometry` + `Points` material for scan rendering
- Skip `ros3djs` entirely

**If you later migrate to Pi 5:**
- Pi 5 has different UART numbering and more flexible pin muxing
- `dtoverlay=uart3` still works but review the Pi 5 dt-bindings file, and reverify which `ttyAMAn` the kernel assigns

**If Nav2 / slam_toolbox comes online in a later milestone:**
- Swap to `Myzhar/ldrobot-lidar-ros2` for LifecycleNode support, OR keep `ldlidar_stl_ros2` and wrap it in your own lifecycle manager
- Ensure the static TF `base_link → laser` is correct to mm-level — slam_toolbox is unforgiving of lever-arm errors

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `ldlidar_stl_ros2` @ HEAD | ROS2 Foxy, Galactic, Humble, Iron, Jazzy | Vendor claims "Foxy and above"; Humble is the sweet spot with the most community validation |
| `ldlidar_stl_ros2` | `rmw_cyclonedds_cpp` | No middleware-specific code; uses standard `sensor_msgs/LaserScan` pub — safe with CycloneDDS |
| `sensor_msgs/LaserScan` JSON via rosbridge | `roslib@2.1.0` | Works; NaN values in `ranges[]` require the existing NaN sanitization proxy |
| `dtoverlay=uart3` | Ubuntu 22.04 on Pi 4 | Confirmed in Raspberry Pi kernel docs; config lives in `/boot/firmware/config.txt` on Ubuntu 22.04 (not `/boot/config.txt`) |
| LD19 protocol | `ldlidar_stl_ros2` driver | 230400 8N1, 0x54/0x2C header, 12 points/packet, CRC8 — parser handles this natively |

## Verified Protocol Facts (LD19)

- **Baud:** 230400, 8N1, no parity, no flow control — verified against LDROBOT Development Manual v2.3 (Elecrow PDF) and LudovaTech tutorial repo
- **Direction:** One-way (sensor → host); sensor auto-starts on power-up, no command protocol
- **Packet header:** 0x54 0x2C
- **Frame layout:** Header + VerLen (1B) + Speed (2B) + StartAngle (2B) + 12× {Distance (2B), Intensity (1B)} + EndAngle (2B) + Timestamp (2B) + CRC8 (1B) = 47 bytes
- **Distance units:** mm (uint16)
- **Scan rate:** ~10 Hz nominal (speed field is rotation speed in deg/s)
- **Out-of-range / invalid points:** Surface as NaN in `LaserScan.ranges[]` — handled by existing NaN sanitizer

Confidence: HIGH (Manufacturer manual + independent tutorial + driver source agree)

## Sources

- [ldlidar_stl_ros2 — LDROBOT official ROS2 driver](https://github.com/ldrobotSensorTeam/ldlidar_stl_ros2) — driver choice, launch params, LD19 support — **HIGH**
- [ldlidar_ros2 — LDROBOT newer variant (LD14+)](https://github.com/ldrobotSensorTeam/ldlidar_ros2) — alternative comparison — **HIGH**
- [Myzhar/ldrobot-lidar-ros2 — Lifecycle-node alternative](https://github.com/Myzhar/ldrobot-lidar-ros2) — alternative for future Nav2 milestone — **HIGH**
- [richardw347/ld19_lidar — minimal reference driver](https://github.com/richardw347/ld19_lidar) — alternative / reference — **MEDIUM**
- [LDROBOT LD19 Development Manual v2.3 (PDF)](https://www.elecrow.com/download/product/SLD06360F/LD19_Development%20Manual_V2.3.pdf) — protocol spec, baud rate, packet format — **HIGH**
- [LudovaTech/lidar-LD19-tutorial](https://github.com/LudovaTech/lidar-LD19-tutorial) — independent protocol verification — **HIGH**
- [Raspberry Pi documentation — UART configuration](https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/computers/configuration/uart.adoc) — dtoverlay pin assignments — **HIGH**
- [Raspberry Pi Forums — Pi 4 Activating additional UART ports](https://forums.raspberrypi.com/viewtopic.php?t=244827) — uart2-5 reliability, GPIO conflicts, miniUART caveats — **HIGH**
- [Waveshare DTOF LIDAR LD19 wiki](https://www.waveshare.com/wiki/DTOF_LIDAR_LD19) — wiring reference — **MEDIUM**
- [Setting Up STL-19P on ROS 2 Jazzy (Nov 2025)](https://harminder.dev/blog/2025/11/02/setting-up-and-running-the-d500-lidar-kits-stl-19p-on-ros-2-jazzy/) — recent maintenance confirmation of the LDROBOT driver — **MEDIUM**
- [RobotWebTools/ros3djs](https://github.com/RobotWebTools/ros3djs) — checked for viability, ruled out as unmaintained — **HIGH**
- [roslib on npm](https://www.npmjs.com/package/roslib) — current version 2.1.0 already in project — **HIGH**

---
*Stack research for: LD19 LiDAR integration into existing ROS2 Humble + Pi 4 + Next.js stack*
*Researched: 2026-04-14*
