# Architecture Research — LD19 LiDAR Integration

**Domain:** Brownfield ROS2 Humble robotic mower — adding a 2D LiDAR sensor
**Researched:** 2026-04-14
**Confidence:** HIGH (driver + UART facts verified against LDROBOT and Raspberry Pi official docs; web viz and watchdog patterns from ROS2 community practice, MEDIUM)

## Standard Architecture

### System Overview (post-LD19)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Browser (Next.js 16 / React 19)                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────────────────┐  │
│  │ map/       │  │ teleop/    │  │ ScanOverlay (new)                  │  │
│  │ page.tsx   │  │ page.tsx   │  │ - polar → canvas renderer          │  │
│  └─────┬──────┘  └─────┬──────┘  └───────────────┬────────────────────┘  │
│        │               │                         │                        │
│        └───────────────┴─── Zustand stores ──────┘                        │
│                 (useScanStore — new, throttled)                           │
├───────────────────────────────┬───────────────────────────────────────────┤
│                               │ WebSocket /rosbridge                       │
│                               │ (NaN-sanitized, LaserScan: throttle_rate) │
├───────────────────────────────▼───────────────────────────────────────────┤
│                   web/server.mjs (Node proxy) → rosbridge :9090            │
├──────────────────────────────────────────────────────────────────────────┤
│                  ROS2 Humble / CycloneDDS (network_mode: host)             │
│  ┌──────────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐ ┌────────────────┐ │
│  │micro-ros │ │ gnss │ │ imu  │ │ nav  │ │ rosbridge│ │ lidar (NEW)    │ │
│  │ agent    │ │/fix  │ │/imu  │ │EKF   │ │ :9090    │ │ ldlidar_stl_   │ │
│  │/cmd_vel  │ │      │ │      │ │      │ │          │ │ ros2_node      │ │
│  │/odom     │ │      │ │      │ │/odo- │ │          │ │ → /scan        │ │
│  │          │ │      │ │      │ │metry/│ │          │ │                │ │
│  │          │ │      │ │      │ │filt. │ │          │ │                │ │
│  └────┬─────┘ └──┬───┘ └──┬───┘ └──┬───┘ └────┬─────┘ └───────┬────────┘ │
│       │          │        │        │          │                │          │
│       │          │        │        │          │   ┌────────────▼────────┐ │
│       │          │        │        │          │   │ safety_watchdog     │ │
│       │          │        │        │          │   │ (NEW)               │ │
│       │          │        │        │          │   │ sub: /scan,/cmd_vel │ │
│       │          │        │        │          │   │ pub: /cmd_vel_safe  │ │
│       │          │        │        │          │   └────────────┬────────┘ │
├───────┼──────────┼────────┼────────┼──────────┼────────────────┼──────────┤
│       │ UART     │ USB    │ I2C-1  │          │                │ UART     │
│       │ ttyAMA0  │ ttyGNSS│ 0x68   │          │                │ ttyAMA1  │
│       ▼          ▼        ▼                                    ▼          │
│   ESP32-C3    UM980     MPU6050                              LD19         │
│   (HAT)       GNSS      IMU                                  LiDAR        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|---------------|----------------|
| `lidar` container (NEW) | Read LD19 UART frames, publish `sensor_msgs/LaserScan` to `/scan` at 10 Hz | New Docker service following `docker/imu/` pattern; wraps `ldlidar_stl_ros2` driver |
| `safety_watchdog` node (NEW) | Subscribe `/scan` + teleop `/cmd_vel_raw`, gate forward motion when min-range inside threshold, publish `/cmd_vel` | Small Python node; can colocate in existing `nav` container or be its own container |
| Web `ScanOverlay` component (NEW) | Render 360° polar scan on existing `map/page.tsx`, canvas-layered over Leaflet robot position | New React component + `use-scan-store.ts` Zustand store |
| `rosbridge` (existing) | Marshal `/scan` to browser with `throttle_rate` + `compression: "cbor"` to cap bandwidth | No code change; browser sets throttle via subscribe opts |
| `web/server.mjs` (existing) | Proxy + NaN sanitization | Reused unchanged — `/scan` ranges can contain `Infinity`/`NaN` for no-return, sanitizer already handles NaN (verify `Infinity` path, see Pitfalls) |
| HAT PCB (existing v2.0) | Break LD19 UART pins + 5V/GND to a pigtail header | Physical rework — see HAT Implications below |

## TF Tree Additions

Existing tree (inferred from EKF + navsat_transform config):

```
map
 └── odom
      └── base_link
           ├── imu_link            (existing)
           └── gps_link            (existing)
```

Post-LD19:

```
map
 └── odom
      └── base_link
           ├── imu_link
           ├── gps_link
           └── laser_frame        ← NEW, static transform
```

- **Transform:** `base_link → laser_frame` published by a `static_transform_publisher` (in the lidar container or in the existing `mower_nav_launch.py`)
- **Parameters:** `x, y, z` = LD19 mount offset from base_link origin (measured on chassis); `yaw` typically 0 (sensor forward = robot forward); LD19 spins CCW with 0° typically at its connector — **verify with one test scan in RViz** before trusting
- **Driver frame_id:** Set `frame_id: laser_frame` in launch params (not `base_laser` — prefer project-consistent naming)
- **Critical:** LD19 mounted **upside-down** would need `roll: pi` in the static TF; this is common when mounting below a chassis plate

## UART Multiplexing on Pi 4

This is the core HAT/wiring decision. Current state: `ttyAMA0` (GPIO14/15) is occupied by ESP32 HAT link. The LD19 needs a second UART at 230400 baud.

### Options (ranked)

**Option A — `dtoverlay=uart3` on GPIO4/5 (RECOMMENDED)**

- Add to `/boot/firmware/config.txt`: `dtoverlay=uart3`
- Uses GPIO4 (TXD3) / GPIO5 (RXD3) — both are free on the Pi 40-pin header in the HAT v2.0 schematic (need to verify no HAT trace conflict)
- Appears as `/dev/ttyAMA1` (the Pi renumbers PL011 UARTs when overlays are added; verify with `ls /dev/ttyAMA*` post-boot — could land on ttyAMA2)
- **Why uart3, not uart2:** UART2 uses GPIO0/1, which are traditionally reserved for HAT ID EEPROM (ID_SD/ID_SC). Using them breaks HAT autodetection and is officially discouraged.
- **Why not uart4/5:** GPIO8-15 range overlaps with existing HAT usage (SPI0 CS0 = GPIO8, and the ESP32 UART link is on 14/15). uart3 on GPIO4/5 has the least conflict surface.
- **Flow control:** Not needed — LD19 is one-way (LiDAR → Pi only at 230400; the Pi never sends to the LiDAR)
- **Confidence:** HIGH (Pi docs confirm pin map; MEDIUM on exact device-node numbering — must be empirically verified)

**Option B — USB-to-UART dongle (e.g., CP2102 or CH340)**

- Plug LD19 into a USB serial adapter, appears as `/dev/ttyUSB0`
- **Pros:** Zero HAT rework; just a udev rule (add `/dev/ttyLIDAR` symlink alongside existing `/dev/ttyESP32`, `/dev/ttyGNSS`)
- **Cons:** Consumes a USB port, adds cable bulk, and is architecturally inconsistent with the "HAT-centric" design stated in PROJECT.md key decisions
- **When to choose:** If bench-testing *before* a HAT spin, or if the HAT spin is deferred

**Option C — Soft UART via `dtoverlay=sc16is752-spi` or similar expansion IC**

- Not recommended. Adds BOM, schematic complexity, driver surface. Overkill for one additional serial port.

### Recommendation

**Option A (dtoverlay=uart3 on GPIO4/5) for production**, **Option B (USB dongle) for initial bring-up**. This matches the brownfield discipline — prove `/scan` flows end-to-end on a USB dongle first, then migrate to HAT-integrated UART once the data pipeline is validated.

## HAT PCB Implications

The v2.0 HAT (100×80 mm, freshly committed to git) does not currently route LD19 power or serial. Two paths:

| Path | Scope | When justified |
|------|-------|---------------|
| **Pigtail / header hack** | Solder 4-wire pigtail (5V, GND, TX4→GPIO5/RX, RX←GPIO4/TX) directly to HAT pads or a new 2.54 mm 4-pin header; no re-fab | v1 goal (prove `/scan` visible) — sufficient, reversible |
| **HAT v2.1 spin** | Add JST-PH 4-pin connector to HAT, silkscreen "LIDAR UART3", route GPIO4/5 + filtered 5V to the connector, optionally add TVS diode | Once LD19 is committed hardware, before enclosing mower |

**Recommendation:** Ship v1 with a pigtail (LiDAR connector on a flying lead breakout). Revise PCB to v2.1 only *after* the safety-watchdog and scan viz work confirm the sensor location + mounting orientation are final. Premature spin = rework risk.

**Power:** LD19 draws ~180 mA @ 5V. The HAT already has a MINI560 5V rail for the Pi; LD19 can tap off that same rail. Budget check: verify MINI560 headroom against Pi + LD19 peak (should be comfortable — MINI560 is typically rated 5 A).

## Safety-Stop Architecture

### Topology

```
teleop/page.tsx → roslib publish → /cmd_vel_raw (NEW topic)
                                       │
                                       ▼
                            safety_watchdog node
                                       │
                                       ▼
                              /cmd_vel (existing)
                                       │
                                       ▼
                              micro-ros-agent → ESP32

/scan → safety_watchdog (subscribe, 10 Hz)
```

**Decision — topic renaming:** Rename teleop publisher from `/cmd_vel` to `/cmd_vel_raw`. Safety watchdog becomes the sole publisher of `/cmd_vel` (the topic the ESP32 listens on). This is the cleanest "defense in depth" layout — nothing can reach the motors without passing the gate.

**Alternative (no rename):** Use a `twist_mux` node in front of the ESP32, with safety watchdog as a high-priority input. More standard in Nav2 stacks but heavier for v1.

### Watchdog logic (v1, minimal)

1. Subscribe `/scan` (LaserScan) and `/cmd_vel_raw` (Twist)
2. On each scan: compute `min_range_forward` within ±30° front arc, ignoring `Infinity`/`NaN`/zero values
3. If `min_range_forward < SAFETY_THRESHOLD` (e.g., 0.4 m) and `twist.linear.x > 0`: publish `Twist{0,0,0}` to `/cmd_vel`
4. Else: pass `/cmd_vel_raw` through to `/cmd_vel`
5. Independent timeout: if no `/scan` received in >1 s, also zero `/cmd_vel` (sensor-fault fail-safe)

**Where it lives:** New Python node in existing `nav` container (reuses rclpy + robot_localization image). Avoids a new Docker service at v1.

**Confidence:** MEDIUM — exact threshold, arc width, and hysteresis are tuning decisions that belong to the implementation phase, not research.

## Web Viz Architecture

### Data-rate reality check

- LD19: 4500 pts/s = 450 pts/rev @ 10 Hz revs
- Per LaserScan message: ~450 ranges + intensities = ~7 KB raw float32 → ~3.5 KB with `compression: "cbor"` over rosbridge
- At 10 Hz: ~35 KB/s. Fine over LAN WebSocket, but enough to cause UI jank if React re-renders a 500-point SVG on every frame.

### Recommended flow

1. **rosbridge subscription** with explicit options:
   - `throttle_rate: 100` (ms) — cap at 10 Hz (match sensor rate; don't over-throttle or the viz looks stuttery)
   - `compression: "cbor"` — binary-efficient; rosbridge supports it natively
   - `queue_length: 1` — always render the latest, never queue backlog
2. **Zustand store** (`use-scan-store.ts`): holds the *latest* LaserScan only — ranges as a `Float32Array`, plus angle_min/angle_increment. No history. No array reallocation on update (reuse the same Float32Array if length matches).
3. **Renderer:** **Canvas 2D**, not SVG, not React-per-point. Single `<canvas>` overlay, imperatively redrawn inside a `requestAnimationFrame` loop that reads from the Zustand store. React never re-renders the canvas element.
4. **Placement:** New `<ScanOverlay>` component on `map/page.tsx`, absolutely positioned over the Leaflet map, centered on the robot's current pose. Robot orientation (from `/odometry/filtered`) rotates the canvas; range rings render at 1 m / 2 m / 5 m for user scale.

### Anti-pattern to avoid

Rendering each scan point as a React component or SVG circle. At 450 points × 10 Hz this will tank the dashboard. Canvas 2D is ~100× cheaper.

## Data Flow (end-to-end, new scan path)

```
LD19 hardware
    ↓ UART 230400 baud (Pi GPIO5 RX / ttyAMA1)
ldlidar_stl_ros2_node (lidar container)
    ↓ sensor_msgs/LaserScan on /scan, frame_id=laser_frame, 10 Hz
    ├──► safety_watchdog (nav container)
    │       ↓ /cmd_vel (gated)
    │    micro-ros-agent → ESP32 → motors
    │
    └──► rosbridge :9090
            ↓ WebSocket (throttle_rate=100, compression=cbor)
         web/server.mjs (NaN + Infinity sanitize)
            ↓
         useScanStore (Float32Array, latest-only)
            ↓ requestAnimationFrame
         <canvas> on map/page.tsx
```

## Suggested Build Order

Order matters — each step must be provable before the next begins.

1. **UART bring-up (bench, USB dongle)** — Plug LD19 into USB-UART adapter on dev machine, confirm driver spins up, `ros2 topic echo /scan` shows valid ranges. Validates the driver choice before touching Pi hardware.
2. **Containerize lidar service** — `docker/lidar/Dockerfile`, add to `docker-compose.yml` with `depends_on: []` (independent), device mount `/dev/ttyUSB0` or `/dev/ttyLIDAR`.
3. **Pi 4 UART3 enable** — Add `dtoverlay=uart3` to `/boot/firmware/config.txt`, reboot, confirm `/dev/ttyAMA1` exists, move LD19 from USB to GPIO4/5 via pigtail, update docker-compose device mount.
4. **udev rule** — Add `/dev/ttyLIDAR` symlink in `udev/99-mower.rules` for consistency with existing ESP32/GNSS rules (even for ttyAMA*, a symlink keeps compose config clean).
5. **Static TF** — Add `base_link → laser_frame` to `config/mower_nav_launch.py` with measured offsets.
6. **Rosbridge exposure + web scan store** — `use-scan-store.ts`, subscribe with throttle+cbor, verify ranges reach browser via devtools.
7. **Canvas overlay on map page** — `<ScanOverlay>` component. **This is the milestone "success" gate** per PROJECT.md ("v1 success = `/scan` visible in web UI").
8. **Safety watchdog node** — Add `/cmd_vel_raw` → `/cmd_vel` gating in nav container; rename teleop publisher.
9. **HAT v2.1 spin (optional, deferred)** — Add LD19 connector footprint once mounting is finalized.

Dependencies: steps 1→2→3 are sequential (hardware bring-up chain). Steps 5, 6, 7 can overlap once step 4 is done. Step 8 is independent of viz (can be developed in parallel with 6–7 but must be tested with real `/scan` from step 5).

## Anti-Patterns

### AP-1: Putting LiDAR on the ESP32

Adding the LiDAR to the ESP32 would overload an already-busy micro-ROS serial link (shared with cmd_vel + odom + encoder counts) and push 230400-baud LiDAR frames through a 115200-baud transport. **Do this instead:** LiDAR is a Pi-direct sensor; the ESP32 stays motor-only.

### AP-2: Reusing `ttyAMA0`

Tempting because it's "the UART that works." Breaks the ESP32 link instantly and there's no multiplexing at the hardware layer. **Do this instead:** `dtoverlay=uart3`.

### AP-3: Publishing `/scan` straight to the ESP32 as an obstacle flag

Moves safety logic into firmware where it's hard to iterate and untestable from the host. **Do this instead:** Safety watchdog as a ROS2 node; firmware stays a dumb actuator with its 500 ms `cmd_vel` watchdog as last-resort.

### AP-4: No throttle on `/scan` to rosbridge

Unthrottled LaserScan at 10 Hz will saturate WebSocket buffers on mobile clients and cause UI stalls. **Do this instead:** explicit `throttle_rate` + `compression: "cbor"` on subscribe.

### AP-5: Using `ttyS0` (miniUART) for LiDAR

The miniUART has no hardware FIFO depth guarantees and clock-drifts with CPU frequency scaling. At 230400 baud you'll see frame errors. **Do this instead:** Use a PL011 UART via `dtoverlay=uart3`.

## Integration Points

| Boundary | Communication | Notes |
|----------|---------------|-------|
| LD19 ↔ lidar container | UART 230400 8N1 | One-way; driver does not need to write to sensor |
| lidar ↔ nav (watchdog) | DDS topic `/scan` | Same host, CycloneDDS shared memory — negligible cost |
| lidar ↔ rosbridge | DDS topic `/scan` | Rosbridge subscribes once per connected browser client |
| watchdog ↔ micro-ros-agent | DDS topic `/cmd_vel` | Unchanged contract with ESP32 |
| Browser ↔ rosbridge | WebSocket w/ throttle+cbor | ~35 KB/s budgeted |
| HAT ↔ LD19 | Pigtail (v1) → connector (v2.1) | 4-wire: 5V, GND, TX, RX |

## Sources

- [ldrobotSensorTeam/ldlidar_stl_ros2 (official LD19/LD06 driver)](https://github.com/ldrobotSensorTeam/ldlidar_stl_ros2) — confirms 230400 baud, launch param structure, `product_name: LDLiDAR_LD06`/`LD19`
- [LD19 Development Manual v2.3 (Elecrow PDF)](https://www.elecrow.com/download/product/SLD06360F/LD19_Development%20Manual_V2.3.pdf) — UART frame format, rotation rate
- [Raspberry Pi docs — configuration/uart.adoc](https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/computers/configuration/uart.adoc) — authoritative UART overlay pin mapping (HIGH confidence)
- [Raspberry Pi Forums — Pi-4 Activating additional UART ports](https://forums.raspberrypi.com/viewtopic.php?t=244827) — dtoverlay=uart2..5, GPIO conflict notes, ID EEPROM warning for uart2
- [rosbridge throttle_rate discussion (ROS Answers)](https://answers.ros.org/question/204919/rosbridge-20-limit-bandwith/) — throttle_rate semantics and LaserScan bandwidth control
- [Linorobot ldlidar ROS2 package](https://github.com/linorobot/ldlidar) — community-maintained alternative; useful cross-reference

---
*Architecture research for: LD19 LiDAR integration into ROS2 Humble brownfield mower*
*Researched: 2026-04-14*
