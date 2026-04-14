# Pitfalls Research

**Domain:** LD19 2D LiDAR integration on Raspberry Pi 4 + ROS2 Humble (dockerized) + existing ESP32-C3 UART HAT, outdoor lawn mower, rosbridge web visualization
**Researched:** 2026-04-14
**Confidence:** HIGH for Pi 4 UART / LD19 driver specifics (verified via LDRobot manual + Pi documentation + driver repos); MEDIUM for outdoor lawn-specific behavior (fewer empirical sources, mostly commercial product marketing).

---

## Critical Pitfalls

### Pitfall 1: Putting the LD19 on the miniUART (ttyS0) — clock-dependent baud and jitter at 230400

**What goes wrong:**
LD19 streams 4500 points/s over UART at **230400 baud, 8N1**. The Pi 4's miniUART (`ttyS0` on GPIO14/15 when `enable_uart=1` without overlays) derives its baudrate from the **VPU core clock**. The core clock scales with CPU load. Symptoms: sporadic `ldlidar communication is abnormal` errors, CRC failures inside the driver, scan frames dropped, `/scan` stalls for seconds at a time when the Pi is busy (e.g., when rosbridge is encoding frames or micro-ros-agent bursts).

**Why it happens:**
People see "UART enabled, device shows up at `/dev/ttyS0`" and assume any UART is equivalent. It isn't: miniUART baud literally depends on core_freq unless you pin it. Full PL011 UART (`ttyAMA0`) has an independent clock and is stable at high baud — but on this project `ttyAMA0` is **already consumed by the ESP32 HAT link**.

**How to avoid:**
Do **not** place the LD19 on `ttyS0`. Either (a) enable a secondary PL011 via `dtoverlay=uart2` (GPIO0/1 — but conflicts with HAT ID EEPROM pins; see Pitfall 6), `dtoverlay=uart3` (GPIO4/5), `dtoverlay=uart4` (GPIO8/9), or `dtoverlay=uart5` (GPIO12/13), and route it via the HAT; or (b) use a USB-UART adapter (CP2102/CH340) for the LiDAR and keep ESP32 on `ttyAMA0`. If `ttyS0` is unavoidable for any reason, also pin `core_freq=250` and `core_freq_min=250` in `/boot/config.txt` to stabilize its clock — but this is a workaround, not a fix.

**Warning signs:**
- `[ERROR] ldlidar communication is abnormal` in the driver log
- `/scan` publishes erratically (target 10 Hz, actual oscillates 6–11 Hz)
- CRC / frame-header sync errors spike when CPU load rises
- `dmesg` shows `ttyS0` overruns

**Phase to address:** Phase 1 (hardware wiring / UART routing decision) — this is the gating decision for the whole milestone.

---

### Pitfall 2: Forgetting `disable_bluetooth` / `miniuart-bt` overlay when adding extra UARTs

**What goes wrong:**
Developer adds `dtoverlay=uart3` to `/boot/config.txt` for the LiDAR, leaves Bluetooth enabled on its default UART, and doesn't realize that on Pi 4 the **primary PL011 is bonded to Bluetooth by default** — so `ttyAMA0` (currently serving the ESP32 HAT) may silently re-route or exhibit unstable baud when Bluetooth activity occurs. Or developer enables `miniuart-bt` to "free up ttyAMA0", but this relegates BT to the miniUART, which in turn destabilizes anything on `ttyS0` and pins core_freq.

**Why it happens:**
Pi 4 UART topology is genuinely confusing: there are six UARTs, but only one PL011 is wired to GPIO14/15 by default, Bluetooth owns it out of the box, and the "obvious" fix (swap BT to miniUART) has CPU-clock side effects that break other things.

**How to avoid:**
Explicit stance in ROADMAP: **Bluetooth is disabled** (`dtoverlay=disable-bt` + `systemctl disable hciuart`). ESP32 HAT keeps `ttyAMA0` (PL011) as it is today. LiDAR gets its own secondary UART via `dtoverlay=uart3` (or chosen overlay) with documented GPIO pin pair. Commit the `/boot/config.txt` changes to the repo (or at minimum document them in `docs/setup-guide.md`) so they survive Pi reimaging.

**Warning signs:**
- `/dev/serial0` and `/dev/serial1` symlinks flipping between boots
- ESP32 micro-ROS agent reconnects whenever BT-adjacent work happens
- `ls -l /dev/ttyAMA*` shows unexpected devices appearing/disappearing
- Different baudrate behavior between `stty` readback and what you configured

**Phase to address:** Phase 1 (UART routing).

---

### Pitfall 3: Using `/dev/ttyAMA1` (or similar) instead of a stable udev path

**What goes wrong:**
Driver is configured with `port: /dev/ttyAMA1`. Works today. Next kernel update or adding another USB-serial device shifts enumeration — suddenly `ttyAMA1` is the ESP32 or nothing at all, and the LD19 container either can't open the port or opens the wrong device. Motors could receive garbage if the wrong device is treated as LiDAR (unlikely to command motion, but will desync everything).

**Why it happens:**
TTY device numbering is enumeration-order dependent, not stable. The existing repo already uses `/dev/ttyAMA0` for the ESP32, which is stable only because Pi UART overlays pin PL011 → ttyAMA0. Secondary UARTs (`ttyAMA1..5`) depend on overlay load order.

**How to avoid:**
Create a **udev rule** (`/etc/udev/rules.d/99-mowerbot.rules`) that binds by `KERNELS==` / device-tree path and emits stable symlinks:
- `/dev/mowerbot/esp32` → ESP32 UART
- `/dev/mowerbot/lidar` → LD19 UART

Reference the symlinks from docker-compose `devices:` mounts and from driver launch params. Check the symlink into the repo alongside `docker/`. This also lets the `docker-compose.yml` be portable across Pi reimages.

**Warning signs:**
- "works on my Pi but not the spare Pi" bugs
- Driver fails to start after unrelated apt upgrade
- Device path in logs doesn't match what docker-compose mounted

**Phase to address:** Phase 1 (hardware/UART).

---

### Pitfall 4: Publishing `/scan` with wrong `frame_id` or inverted angle direction

**What goes wrong:**
LD19 natively uses a **left-handed coordinate system** (angle increases clockwise when viewed from top). ROS REP-103 is right-handed (counter-clockwise positive). If the driver's `laser_scan_dir` is set wrong, the entire scan is mirrored: obstacles on the robot's left appear on its right. Obstacle-stop hook misfires. Future Nav2 costmap inflates obstacles in the wrong hemisphere. If `frame_id` is left at the driver default (`lidar_frame`, `laser`, `base_scan`, etc.) without a matching static TF from `base_link`, RViz shows nothing, EKF rejects the sensor, and Nav2 won't launch because TF chain is broken.

**Why it happens:**
LD19 driver (`ldlidar_stl_ros2`) has a `laser_scan_dir` parameter that defaults to counter-clockwise for RViz convention — but several community drivers and older forks default the other way. Frame IDs are set by whoever copied the launch file first and rarely revisited.

**How to avoid:**
- Fix `frame_id: laser_link` (matching REP-105 naming conventions) in driver config from day one; add a static TF publisher `base_link → laser_link` with explicit x/y/z and yaw based on the physical mount on the mower.
- Set `laser_scan_dir: true` (counter-clockwise, right-handed) to match REP-103.
- Validate in RViz: place a known asymmetric obstacle (e.g., wall on robot's left side only) and confirm returns land on +Y in `base_link`.
- Write the static TF as a dedicated node or launch entry in the `nav` container — not scattered across the LiDAR container, or you'll have TF race conditions.

**Warning signs:**
- RViz shows scan but robot drives into things "on the left" more often
- `ros2 run tf2_ros tf2_echo base_link laser_link` returns error
- EKF log: "could not transform from laser_link to base_link"
- Nav2 / costmap complains about frame not in TF tree

**Phase to address:** Phase 2 (driver integration) and Phase 3 (TF + visualization).

---

### Pitfall 5: Trusting `sensor_msgs/LaserScan` over rosbridge at 10 Hz without throttling

**What goes wrong:**
LD19 publishes ~456 points per scan at 10 Hz. Rosbridge serializes each scan to JSON — every float becomes ~15–20 bytes of text (`ranges[]` alone is ~8 KB JSON). At 10 Hz that's 80+ KB/s of JSON going to each connected browser, plus `intensities[]`. On a Pi 4 with rosbridge + Next.js dev server + micro-ros-agent + EKF + NTRIP all running, the WebSocket starts dropping or buffering; the browser tab shows progressively stale scans with growing latency (lag "accumulation" — frames queue up faster than the client consumes them). NaN handling (already in the codebase) hides the symptom because range=inf/NaN values pass through the sanitizer as 0 and briefly look plausible.

**Why it happens:**
Rosbridge's default compression (`"png"` or `"cbor"`) is tuned for images, not LaserScan. Developers test over localhost where bandwidth is infinite and miss the real-world backpressure. 10 Hz feels low, so it's assumed "safe."

**How to avoid:**
- Apply a `throttle` filter: publish a separate `/scan/viz` topic at 5 Hz (or even 2 Hz) for the browser, keep 10 Hz on `/scan` for internal consumers (future Nav2, safety watchdog).
- Use rosbridge's `throttle_rate` parameter on the subscribe call from the browser: `{op: "subscribe", topic: "/scan", throttle_rate: 200}` (ms).
- Use CBOR compression (`compression: "cbor"`) on the subscribe call — smaller than JSON for numeric arrays.
- Strip `intensities[]` in a relay node if the web UI doesn't render intensity — roughly halves payload.
- Consider downsampling to every Nth beam (e.g., 90 beams / 4° resolution) for the viz topic; keep full resolution for Nav2.

**Warning signs:**
- Browser scan render lags further and further behind real obstacles
- Chrome DevTools Network tab shows WebSocket buffered-amount growing
- CPU of `rosbridge_websocket` process > 40% sustained on Pi 4
- Opening the dashboard on two browsers simultaneously makes `/scan` hitch

**Phase to address:** Phase 3 (web visualization).

---

### Pitfall 6: Adding UART2 (GPIO0/1) without realizing it kills HAT ID EEPROM

**What goes wrong:**
Developer adds `dtoverlay=uart2` to route LiDAR serial to GPIO0/1 because they're "unused" on the current HAT. GPIO0/1 are **ID_SD/ID_SC**, the HAT EEPROM ID pins. The Pi's HAT auto-detection breaks; custom dtoverlays that the HAT was supposed to auto-load stop loading; cascading failures that look unrelated to LiDAR ("why did my I2C sensor addresses change?").

**Why it happens:**
GPIO0/1 look free on most schematics — their HAT EEPROM role is a convention most hobbyists never encounter until their HAT "stops working."

**How to avoid:**
**Never use GPIO0/1 for UART on a project that ships a HAT.** Pick `uart3` (GPIO4/5), `uart4` (GPIO8/9), or `uart5` (GPIO12/13). Check existing HAT v2.0 schematic — verify chosen GPIOs aren't already routed to BTS7960, MINI560, ADS1115, or GY-521. Document pin assignment in `hardware/` docs and `docs/pcb-motor-controller.md`.

**Warning signs:**
- HAT EEPROM overlays stop auto-loading after config.txt change
- I2C device discovery order changes
- Pi boot messages mention HAT ID read failure

**Phase to address:** Phase 1 (UART routing) + Phase 1 (HAT revision if needed).

---

### Pitfall 7: False-positive auto-stop in tall grass (watchdog fires mid-mow)

**What goes wrong:**
Naive obstacle watchdog: "if any beam of `/scan` returns < 0.5 m, zero `cmd_vel`." Tall grass, dangling leaves, a dandelion seed head, or even the mower's own wheel spray of cut grass gives sub-threshold returns. Mower auto-stops every 3 meters, completes no mission, user disables the safety hook entirely, now the safety net is gone.

**Why it happens:**
LD19 is a time-of-flight sensor that returns **any** surface it hits — including vegetation. It has no semantic understanding of "obstacle" vs "grass." 2D scan at mower deck height (typically 15–25 cm) guarantees grass strikes.

**How to avoid:**
- **Mount the LiDAR above the grass line** — ideally 25–40 cm above ground, above typical uncut grass height. Mount height is part of the hardware decision in Phase 1.
- **Require persistence**: a point must appear in N consecutive scans (e.g., 3 frames = 300 ms) in roughly the same angular bin before triggering stop. Single-frame hits are ignored.
- **Require cluster size**: require ≥ K beams with returns < threshold in a contiguous angular window (e.g., 5 beams ≈ 4°) — single-beam hits (a blade of grass) are ignored.
- **Forward-arc only**: only monitor the front ±45° (or ±60°) of the scan for the safety watchdog. Rear/side returns don't trigger auto-stop (motion is forward-dominant).
- **Tune threshold based on mower speed** (current MAX_SPEED=0.28 m/s → ~1 s stopping distance at ~0.3 m, so use 0.4–0.6 m threshold with hysteresis).
- **Log every trigger** with the scan snapshot so false positives can be diagnosed and thresholds refined.

**Warning signs:**
- Mower stops every few seconds in field testing but nothing visible is in front
- User manually disables `/scan`-based watchdog
- Auto-stop log correlates with high grass or wind

**Phase to address:** Phase 4 (safety watchdog / obstacle auto-stop hook).

---

### Pitfall 8: Sunlight blinding the LD19 and producing dropouts, not errors

**What goes wrong:**
LD19 is rated for **30,000 lux** ambient (noted as "FHL-LD19" variant) but direct summer sun can exceed 100,000 lux. When the laser's return signal is drowned out by IR in sunlight, affected beams return **NaN or inf** (max range or no-return), not an error. The driver dutifully publishes those as range=inf in the LaserScan message. The existing NaN sanitization layer in the web UI converts them to 0 or ignores them — but the safety watchdog, if it filters by range < threshold, **silently sees no obstacles** in the sun-blinded angular sector. Mower drives confidently into a fence because the fence is in the blinded zone.

**Why it happens:**
"No return" looks identical to "clear path" in raw LaserScan. The project already has NaN handling (per existing codebase) for display — but that's a display fix, not a safety fix.

**How to avoid:**
- Treat range=inf / NaN as **"unknown,"** not as "clear." The safety watchdog should derate confidence (or add margin) in sectors with high NaN rates.
- Log per-scan statistics: what % of beams returned valid data this scan, in each angular sector. Alert if > 30% of a sector is invalid.
- Do not run aggressive missions in direct sun at sun angles where the laser looks toward the sun (morning/evening low-angle).
- Future phase: fuse with a second sensor (camera or bumper) so LiDAR isn't the single safety source.

**Warning signs:**
- Valid-beam % drops mid-day in specific compass directions
- NaN clusters correlate with sun azimuth
- Scan "holes" appear at consistent angles that track the sun over a session

**Phase to address:** Phase 4 (safety watchdog) — must be designed with NaN-as-unknown semantics from the start.

---

### Pitfall 9: Driver Docker container missing DDS discovery because `network_mode: host` isn't enough

**What goes wrong:**
A new `lidar` service is added to `docker-compose.yml` with `network_mode: host` (matching the existing pattern). Locally the driver starts, `/scan` publishes inside the container, but EKF / rosbridge / web don't see it. Or worse: sometimes they see it, sometimes they don't, depending on container startup order.

**Why it happens:**
CycloneDDS discovery over host network works **most of the time** but is known to miss a random subset of peers if PID namespaces aren't shared (each container generates a GUID derived partly from PID, collisions or ordering artifacts cause drops). Also, some hosts have `net.ipv4.ip_multicast_all=0` or a firewall rule that drops 239.255.0.1:7400 traffic locally.

**How to avoid:**
- Match the **existing** container configuration exactly: `network_mode: host`, `ipc: host`, `pid: host`, same `CYCLONEDDS_URI` env and mounted `cyclonedds.xml` if one exists in the repo.
- Verify the host has multicast working: `ip maddr show` should list 239.255.0.1 on the loopback/host interface.
- Verify no `ROS_DOMAIN_ID` mismatch between containers (grep docker-compose for `ROS_DOMAIN_ID` — must be identical across all services).
- Add a health check: `ros2 topic list | grep /scan` from inside the `nav` container after `lidar` container is up; fail fast if missing.

**Warning signs:**
- `/scan` exists inside `lidar` container but not inside `nav` or `rosbridge` containers (`ros2 topic list`)
- Intermittent "ghost" scan visibility across restarts
- `ros2 doctor` reports discovery warnings

**Phase to address:** Phase 2 (driver containerization).

---

## Moderate Pitfalls

### Pitfall 10: Fixed LiDAR motor speed under load — scan frame drift without noticing

**What goes wrong:**
LD19 has internal closed-loop speed control at 10 Hz default. Under vibration or low battery (when internal 5V droops), the motor PID may ride the edge of its control range; scan frame timestamps slip. EKF fuses stale scans as if fresh, odometry drifts. If the driver doesn't use the per-scan timestamp from the packet but instead uses `now()`, scan-to-odom alignment is wrong.

**How to avoid:** Use driver mode that stamps `header.stamp` from the **first-beam timestamp** in the scan packet, not the receive time. Verify by checking `ros2 topic hz /scan` — should be dead steady at 10.0 Hz (± 0.1), not drifting with CPU load. If drift is seen, switch to external PWM speed control and close the loop yourself.

**Phase to address:** Phase 2.

---

### Pitfall 11: LD19 5V rail shared with Pi drawing through HAT — brown-out during motor spike

**What goes wrong:**
LD19 draws ~180 mA steady, ~300 mA transient (motor startup). If wired onto the Pi's 5V rail (which on this project passes through the MINI560 buck on the HAT), a motor startup transient from the BTS7960s could droop 5V just enough to reset the LiDAR — or trigger a brief UART corruption that the driver reports as "communication abnormal."

**How to avoid:** Either run LD19 from a dedicated buck (second MINI560 on the HAT revision) or add a bulk cap (470 µF electrolytic + 10 µF ceramic) close to the LD19 power pins. Document the 5V budget: Pi (~3 A peak) + LD19 (~0.3 A) + HAT logic = size the main MINI560 accordingly (pre-existing concern in CONCERNS.md — "MINI560 worst-case analysis" — this pitfall lands in that same bucket).

**Phase to address:** Phase 1 (hardware) — ties into HAT revision decision.

---

### Pitfall 12: `ldlidar_stl_ros2` vs `ldlidar_ros2` vs Myzhar's fork — picking the wrong driver

**What goes wrong:**
Three maintained drivers exist: `ldrobotSensorTeam/ldlidar_stl_ros2` (official, supports LD06/LD19/STL27L, Humble-tested), `ldrobotSensorTeam/ldlidar_ros2` (newer official, different API), and `Myzhar/ldrobot-lidar-ros2` (lifecycle nodes, more idiomatic ROS2). Picking the wrong one means retrofitting later when launch params don't match tutorials.

**How to avoid:** For Humble + LD19 default, use **`ldrobotSensorTeam/ldlidar_stl_ros2`** — most documentation, most issue-tracker activity, matches LD19's `FHL-LD19P` product family. Pin a specific commit SHA in the Dockerfile, not `main`.

**Phase to address:** Phase 2.

---

### Pitfall 13: `/scan` QoS mismatch between driver and subscribers

**What goes wrong:**
LD19 driver publishes with `RELIABLE` QoS, Nav2 / web subscribers expect `BEST_EFFORT` (sensor QoS profile), or vice versa. Subscribers silently get nothing — `ros2 topic list` shows the topic, `ros2 topic echo` works (it negotiates), but the actual Nav2/EKF/web node doesn't receive anything because of QoS incompatibility.

**How to avoid:** Publish `/scan` with `rclcpp::SensorDataQoS()` (BEST_EFFORT, KEEP_LAST depth 5). All subscribers use the same. Document this in ARCHITECTURE.

**Warning signs:** `ros2 topic echo /scan` works but EKF/web sees nothing. `ros2 topic info /scan --verbose` shows mismatched QoS policies.

**Phase to address:** Phase 2 / Phase 3.

---

### Pitfall 14: Forgetting to declare `/scan` in `rosbridge` whitelist or topic_list

**What goes wrong:**
Existing rosbridge config may have an explicit topic allow-list (some configs do, for security). New `/scan` topic isn't on it, browser subscribe silently returns nothing or an unhelpful error.

**How to avoid:** Grep existing rosbridge launch/config for `topics_glob` / `services_glob` / allow-list settings; add `/scan` and `/scan/viz`. If there's no whitelist today, note this in the setup docs.

**Phase to address:** Phase 3.

---

### Pitfall 15: Latency blind spots in safety watchdog — decoupled from cmd_vel loop

**What goes wrong:**
Safety watchdog is a separate ROS2 node that subscribes to `/scan`, checks threshold, publishes zero `cmd_vel` on violation. Problem: `cmd_vel` is already being published by the teleop/nav node at 10–20 Hz. The zero-message from the watchdog and the non-zero message from teleop race into the `cmd_vel` topic — whichever arrives last at the ESP32 wins. Stall situations: motors keep running because teleop re-asserted after the zero.

**How to avoid:** Implement the watchdog as a **multiplexer** (twist_mux pattern): all cmd_vel sources publish to distinct topics (`/cmd_vel_teleop`, `/cmd_vel_nav`), the safety node is the **only** publisher on `/cmd_vel`, and it either forwards the highest-priority source or zeros it. This matches the existing 500 ms firmware-side watchdog (which stays as last-line defense) but adds a scan-aware gate upstream.

**Warning signs:** Mower briefly stops then resumes on its own when obstacle persists. Log shows rapid zero/non-zero alternation on `/cmd_vel`.

**Phase to address:** Phase 4.

---

### Pitfall 16: Publishing LaserScan with `angle_min`/`angle_max` reversed or off by π

**What goes wrong:**
If `angle_min = π` and `angle_max = -π` (reversed), or the driver emits `angle_min = 0, angle_max = 2π` instead of the REP-standard `-π, π`, downstream consumers (RViz overlays, web polar renderer, Nav2 costmap) may plot rays in the wrong hemisphere. The web UI's 2D polar overlay will appear rotated 180°.

**How to avoid:** Validate once with `ros2 topic echo /scan --once` and check `angle_min`, `angle_max`, `angle_increment`. REP convention: `angle_min ≈ -π`, `angle_max ≈ +π`, increment positive. The `ldlidar_stl_ros2` driver handles this correctly when `laser_scan_dir: true`, but fork drivers may not.

**Phase to address:** Phase 2 (driver integration validation).

---

## Minor Pitfalls

### Pitfall 17: Not version-pinning the LiDAR driver image

**What goes wrong:** Dockerfile `FROM ros:humble` + `git clone` without pinning → rebuild six months later pulls a new driver commit with breaking launch-param rename.
**How to avoid:** Pin by SHA; rebuild only on intentional updates.
**Phase to address:** Phase 2.

---

### Pitfall 18: RViz right-handed, web UI left-handed inconsistency

**What goes wrong:** RViz shows scan correctly but the web UI 2D polar overlay draws the scan mirrored because the canvas Y-axis is flipped (screen coordinates). Users think the driver is broken.
**How to avoid:** Document the canvas transform explicitly in the map page; add a test overlay ("obstacle to robot-left should appear on the left of the render").
**Phase to address:** Phase 3.

---

### Pitfall 19: Ignoring `intensities[]` when filtering reflective/absorbent surfaces

**What goes wrong:** LD19 intensity varies with surface material. Low-intensity returns (dark cloth, black fence) are still valid distances but many filters use intensity thresholds to reject noise. Overly aggressive threshold rejects real obstacles.
**How to avoid:** Don't filter by intensity for safety-critical stop decisions. Use intensity only as a secondary signal.
**Phase to address:** Phase 4.

---

### Pitfall 20: Assuming 12 m range in outdoor bright conditions

**What goes wrong:** LD19 datasheet says 12 m indoor, but outdoor sunny max useful range drops to ~6–8 m on low-albedo (dark) targets. Navigation plans made assuming 12 m horizon are optimistic.
**How to avoid:** Conservative planning horizon in Nav2 / costmap (set max range to ~6 m for outdoor).
**Phase to address:** Future Nav2 milestone (noted for continuity).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| USB-UART adapter for LD19 instead of HAT-integrated UART | No HAT revision; works today | Dangling cable, unreliable mechanical, one more point of failure on a mower | Phase 1 proof-of-concept only; commit to HAT integration by end of milestone |
| Hard-coded `/dev/ttyAMA1` instead of udev symlink | Faster first-boot | Breaks across reimages / kernel updates | Never for shipped config; acceptable for same-day dev iteration |
| Forwarding full-rate /scan to browser | Simplest subscribe | WebSocket backpressure, stale scan, UI lag | Never — throttle from day one |
| Single-beam obstacle threshold in safety watchdog | One-line check | Constant false positives in grass, user disables safety | Never |
| Treating NaN/inf as "clear path" | Avoids thinking about sensor limits | Silent safety gap in sunlight/black surfaces | Never |
| Skipping static TF from base_link → laser_link | Driver works standalone | Breaks EKF, Nav2, RViz; hidden until integration | Never |
| Using `laser_scan_dir: false` + compensating downstream | Matches Windows tool / legacy tutorial | Every new consumer must remember to un-flip | Never — fix at source |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LD19 + existing ESP32 HAT UART | Assume `ttyAMA0` can be shared or switched between them | Strict one-device-per-UART; LiDAR gets own dtoverlay UART (uart3/4/5) or USB-UART |
| LD19 + Pi 4 Bluetooth | Leave BT default; add LiDAR overlay on top | Explicit `disable-bt` + disable hciuart; document in setup-guide |
| LD19 driver + rosbridge | Subscribe with default QoS, default compression | Use sensor QoS (BEST_EFFORT), CBOR compression, throttle_rate 200ms |
| LD19 driver + robot_localization EKF | Not fusing scan; but TF must still resolve | `base_link → laser_link` static TF must exist even if scan isn't fused |
| LD19 + CycloneDDS + existing host-network containers | Forget `ipc: host` + `pid: host` — discovery flaky | Match the other services' docker-compose block byte-for-byte on network/ipc/pid settings |
| LD19 scan + existing NaN sanitizer | Rely on sanitizer to "handle" bad data for safety | Sanitizer is display-layer; safety watchdog must treat NaN/inf as unknown, not zero, not clear |
| LD19 motor PWM pin | Leave floating; assume 10 Hz default is fine forever | If vibration seen, move to closed-loop external PWM with PID on Pi side |
| /scan + firmware 500 ms watchdog | Design scan-watchdog independently | Layer scan-watchdog on top of (not instead of) firmware watchdog; keep firmware watchdog as last-line defense |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| 10 Hz JSON over rosbridge to browser | WebSocket buffer grows, UI scans lag | throttle_rate + CBOR + drop intensities | As soon as any second client connects or Pi load rises |
| Unthrottled scan to safety watchdog across DDS domain | 10 Hz cmd_vel computation + serialization | Run watchdog in same container / process as nav if possible; use sensor QoS | Under combined load (NTRIP updates + EKF + nav all spiking) |
| Full 456-beam scan used for obstacle check every frame | CPU bound on Pi 4 | Reduce to forward 90° window, 90 beams | When Nav2 is added on top and also consumes full-res /scan |
| Encoding NaN in JSON over rosbridge | Non-standard, some parsers choke | Replace NaN with `null` or max-range sentinel at publish time | Any day — NaN in JSON is not spec-compliant |

---

## Phase Mapping Summary

| Phase | Pitfalls to address |
|-------|---------------------|
| Phase 1 — Hardware / UART routing | 1, 2, 3, 6, 11 |
| Phase 2 — Driver containerization + ROS2 topic | 4, 9, 10, 12, 13, 16, 17 |
| Phase 3 — Web visualization | 4 (TF validation), 5, 14, 18 |
| Phase 4 — Safety watchdog / obstacle auto-stop | 7, 8, 15, 19 |
| Future (post-milestone) — Nav2 / SLAM | 20, and re-audit full list |

---

## Sources

- [ldrobotSensorTeam/ldlidar_stl_ros2 — official Humble driver](https://github.com/ldrobotSensorTeam/ldlidar_stl_ros2) (HIGH — used for driver choice, frame_id, laser_scan_dir parameter)
- [LD19 Development Manual V2.3 (Elecrow PDF)](https://www.elecrow.com/download/product/SLD06360F/LD19_Development%20Manual_V2.3.pdf) (HIGH — coordinate system, PWM motor control, baud 230400)
- [Waveshare DTOF LIDAR LD19 wiki](https://www.waveshare.com/wiki/DTOF_LIDAR_LD19) (MEDIUM — power/range figures)
- [Myzhar/ldrobot-lidar-ros2 (lifecycle fork)](https://github.com/Myzhar/ldrobot-lidar-ros2) (MEDIUM — alternative driver comparison)
- [Raspberry Pi Forums: Pi-4 Activating additional UART ports](https://forums.raspberrypi.com/viewtopic.php?t=244827) (HIGH — uart2/3/4/5 overlay mapping)
- [Raspberry Pi Forums: Pi 4 GPIO UART (ttyS0) not working](https://forums.raspberrypi.com/viewtopic.php?t=244991) (HIGH — miniUART core_freq dependency)
- [Raspberry Pi Forums: UART/BT overlay but UART still unstable](https://forums.raspberrypi.com/viewtopic.php?t=275052) (HIGH — miniuart-bt side effects)
- [Raspberry Pi Forums: Consistent device paths for extra UARTs](https://forums.raspberrypi.com/viewtopic.php?t=347868) (HIGH — udev stability)
- [Raspberry Pi UART configuration docs](https://www.raspberrypi.org/documentation/configuration/uart.md) (HIGH — authoritative)
- [Fix ROS 2 Discovery Issues in Docker — Markaicode](https://markaicode.com/fix-ros2-docker-discovery-issues/) (MEDIUM — host/ipc/pid sharing)
- [CycloneDDS GitHub Issue #687 — multiple nodes unicast](https://github.com/eclipse-cyclonedds/cyclonedds/issues/687) (MEDIUM — discovery edge cases)
- [Nav2 — Setting Up Transformations](https://docs.nav2.org/setup_guides/transformation/setup_transforms.html) (HIGH — TF conventions, REP-105)
- [robot_localization state estimation docs](https://docs.ros.org/en/melodic/api/robot_localization/html/state_estimation_nodes.html) (HIGH — frame_id rules)
- [kiwicampus/rosboard_client (rosbridge bandwidth comparison)](https://github.com/kiwicampus/rosboard_client) (MEDIUM — rosbridge JSON bandwidth issues)
- [RobotWebTools/rosbridge_suite](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/README.md) (HIGH — throttle_rate, compression options)
- [Top 5 Considerations for Outdoor LiDAR — LiDAR News](https://lidarnews.com/articles/top-5-considerations-for-choosing-lidar-for-outdoor-robots/) (MEDIUM — sunlight/weather false positives, multi-echo)
- [Top 5 Considerations Outdoor LiDAR — SICK](https://sickconnect.com/top-5-considerations-choosing-ourdoor-lidar-robots/) (MEDIUM — sunlight blinding, multi-echo mitigation)
- [Hesai — LiDAR in robotic lawn mowers](https://www.hesaitech.com/no-wires-no-hassle-how-lidar-unlocks-true-intelligence-in-robotic-lawn-mowers/) (LOW — commercial, but confirms grass/vegetation false-return problem)
