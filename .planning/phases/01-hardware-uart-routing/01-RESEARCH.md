# Phase 1: Hardware & UART Routing — Research

**Researched:** 2026-04-14
**Domain:** Raspberry Pi 4 (BCM2711) secondary PL011 UART routing on Bookworm + Ubuntu 22.04-class kernels, udev stable-device-path bindings for internal UARTs, LD19 LiDAR 4-pin wiring, 5V rail brownout-margin bench measurement
**Confidence:** HIGH on the boot-config + device-tree + udev mechanics; MEDIUM on exact MINI560 headroom (analytic — supersedes itself with the measurement task); HIGH on LD19 electrical spec (vendor datasheet in tree)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Boot config**
- **D-01:** `dtoverlay=disable-bt` is assumed already present in `/boot/firmware/config.txt`. The plan's first task VERIFIES this before any other change.
- **D-02:** Phase 1 adds exactly one line to `/boot/firmware/config.txt`: `dtoverlay=uart3` (GPIO4/5). `uart2`/`uart4`/`uart5`/`ttyS0` are ruled out.
- **D-03:** After reboot the new PL011 node appears at `/dev/ttyAMA1` **or higher** — enumeration not guaranteed. Plan must `ls /dev/ttyAMA*`, record actual node, and bind udev by device-tree path (NOT by `ttyAMAn` number).

**Wiring**
- **D-04:** Pigtail direct to Pi 40-pin GPIO header. Zero HAT rework. Document in `docs/` with pin-level wiring.
- **D-05:** LD19 pin 1 Tx → Pi GPIO5 / BCM5 (physical pin 29) = uart3_rx. LD19 pin 2 PWM → Pi GND (datasheet-mandated). LD19 pin 3 GND → any Pi GND. LD19 pin 4 P5V → see D-06. Pi GPIO4 (uart3_tx) left unconnected.
- **D-06:** 5V source = shared MINI560 rail, validated by measurement. Pass/fail ≥4.85V under motor-startup transient. Evidence committed to `docs/`. Fall back to dedicated rail only if measured <4.85V.

**Device path**
- **D-07:** Extend `udev/99-mower.rules` with a new LD19 entry bound **by device-tree path** to create `/dev/ttyLIDAR`. Rule must survive `udevadm control --reload-rules && udevadm trigger` and three consecutive reboots. Existing entries untouched this phase.
- **D-08:** Bytes-flowing verification = `picocom -b 230400 /dev/ttyLIDAR` shows `0x54 0x2C` packet headers.

**Regression**
- **D-09:** From inside the `nav` container, `ros2 topic echo /odom` must still show live encoder data. Final gate before Phase 1 completion.

**Weather / environmental**
- **D-10:** IP5X = dust-only, NOT rain. Document operator rule in `docs/`. Physical shroud deferred to v2.
- **D-11:** Operating temp −10 °C to +45 °C. Document alongside IP rating. Awareness-only this phase.

### Claude's Discretion

- Exact Pi GND pin choice among the many options (any works electrically).
- Whether to add `enable_uart=1` alongside `dtoverlay=uart3` (redundant but harmless — see Finding 1).
- Exact udev rule syntax (ATTRS / DEVPATH / KERNELS pattern) — must match the uart3 device-tree node.
- Format of wiring doc (Markdown ASCII vs. KiCad snippet vs. both).
- Whether to commit `cat /boot/firmware/config.txt` diff as pre/post snapshots in `docs/`.

### Deferred Ideas (OUT OF SCOPE)

- HAT v2.1 PCB respin with dedicated LD19 header — v2 milestone.
- Physical weather shroud / IP-rated enclosure — v2 milestone.
- External PWM-based motor-speed control of LD19 — not needed at 10 Hz default.
- USB-UART dongle fallback — only activated if pigtail approach hits an unexpected routing block. Research it for the plan's "escape hatch" section; do not make it the primary path.
- Obsolete `/dev/ttyESP32` cleanup (stale CP2102 rule + `.env.example` override + docs) — separate `/gsd-quick` after Phase 1.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HW-01 | `dtoverlay=uart3` enabled on GPIO4/5; dedicated PL011 without disturbing `ttyAMA0` | Finding 1 (config.txt diff), Finding 2 (enumeration), Finding 5 (HAT routing clean — GPIO4/5 pass-through unencumbered) |
| HW-02 | Stable `/dev/ttyLIDAR` udev symlink across reboots | Finding 3 (udev rule syntax bound to device-tree path `fe201600.serial`) |
| HW-03 | LD19 physically connected via GPIO4/5 pigtail; wiring documented in `docs/` | Finding 4 (exact pin numbers), Finding 5 (HAT pass-through verified), Ready-to-Paste wiring table |
| HW-04 | ESP32 motor-controller UART link verified still alive — `ros2 topic echo /odom` shows live encoder data | Finding 8 (regression command sequence) |
| HW-05 | 5V rail headroom measured with LD19 current, committed to `docs/` | Finding 6 (MINI560 analytic margin — expected OK but borderline), Finding 7 (measurement protocol) |

</phase_requirements>

## Summary

- **Device-tree path for uart3 on BCM2711 is `fe201600.serial`** — this is the canonical, reboot-stable handle for the udev rule. `/dev/ttyAMAn` enumeration is known to drift across kernels; the device-tree path is invariant. [VERIFIED: web search + BCM2711 memory map; see Finding 2, Finding 3]
- **`dtoverlay=uart3` alone is sufficient.** `enable_uart=1` affects only the *primary* UART (ttyAMA0) and is already set in the working baseline — it does not gate secondary UARTs. Adding `enable_uart=1` explicitly is redundant but harmless. [VERIFIED: raspberrypi/firmware overlays README; see Finding 1]
- **HAT v2.0 GPIO4/5 pass-through is clean.** Parsed `hardware/MowerBot-MotorController.kicad_sch`: the `Raspberry_Pi_4` connector symbol has GPIO4 on pin 7 and GPIO5 on pin 29, and **zero net labels attach to those pins** in the entire schematic. The pigtail approach is electrically unencumbered. [VERIFIED: grep of kicad_sch — GPIO04/GPIO05/GPCLK0/GPCLK1 appear only as symbol-definition pin names, never as wire/label connections in the instance section]
- **Post-reboot enumeration is historically messy on Bookworm**, but kernel ≥6.1.28 ships aliases (serial2–serial5) that make `dtoverlay=uart3` deterministically → `/dev/ttyAMA3`. CONTEXT.md's "ttyAMA1 or higher" assumption is correct to plan for — but on a current kernel, expect `/dev/ttyAMA3` specifically. Regardless, the udev rule binds by device-tree path, so the enumeration number is irrelevant for downstream code. [VERIFIED: raspberrypi/linux PR #5436, forum thread 347868]
- **Primary recommendation:** The plan should be five concrete tasks — (1) verify baseline (`disable-bt`, `ttyAMA0` alive), (2) edit `/boot/firmware/config.txt` to add `dtoverlay=uart3` + reboot, (3) wire pigtail + commit udev rule with device-tree-path match, (4) measure 5V rail under motor transient, (5) regression `/odom` echo. Byte-level verification with `picocom` sits between tasks 3 and 5.

## Findings

### 1. Exact `/boot/firmware/config.txt` diff

**The single required change:**

```diff
+ dtoverlay=uart3
```

**Placement:** End of the `[all]` section, immediately after the existing `dtoverlay=disable-bt` line. No ordering dependency is documented; grouping the two dtoverlay lines makes the diff self-explaining.

**`enable_uart=1` — is it needed?**
`enable_uart=1` is the legacy "enable the primary UART on the GPIO header" switch. It only affects GPIO14/15 (ttyAMA0 on Pi 4 with `disable-bt`). It does not gate `dtoverlay=uart3`. Because the existing codebase already runs ESP32 on `/dev/ttyAMA0` at 115200, `enable_uart=1` is effectively a precondition of the current working baseline and is either already present in `config.txt` or implicit from `disable-bt`. **Do not add `enable_uart=1` as part of Phase 1.** If the plan's first "verify baseline" task finds it absent and `ttyAMA0` still works (unusual but possible on some configurations), that's informational only — the phase does not introduce it. [VERIFIED: raspberrypi/firmware overlays README; Raspberry Pi Forum t=340392]

**`init_uart_baud` gotchas:** `init_uart_baud` controls only the kernel-console baud on the early-boot UART (ttyAMA0 by default). It does not affect the LD19 path; the LD19 driver will set baudrate at userland open() time. **Not relevant to Phase 1.** [CITED: raspberrypi.com documentation — config.txt boot options]

**Recommended plan actions for this file:**
1. Back up `/boot/firmware/config.txt` before edit (e.g. `sudo cp config.txt config.txt.pre-uart3.bak`).
2. Append the single line.
3. `sync && reboot`.
4. After reboot: `grep -E "disable-bt|uart3|enable_uart" /boot/firmware/config.txt` committed verbatim to `docs/` as an evidence snippet.

Confidence: HIGH.

### 2. `/dev/ttyAMAn` enumeration on Pi 4 + `disable-bt` + `uart3`

On Raspberry Pi 4 with kernel ≥ 6.1.28 (current Bookworm / Ubuntu 22.04 LTS ships far newer), the kernel's device-tree aliases bind each UART to a stable `/dev/ttyAMAn` slot:

| UART | GPIO pair | Device-tree alias | Expected node |
|------|-----------|-------------------|---------------|
| UART0 (PL011, primary) | 14 / 15 | serial0 | `/dev/ttyAMA0` |
| UART2 | 0 / 1 | serial2 | `/dev/ttyAMA2` |
| **UART3** | **4 / 5** | **serial3** | **`/dev/ttyAMA3`** |
| UART4 | 8 / 9 | serial4 | `/dev/ttyAMA4` |
| UART5 | 12 / 13 | serial5 | `/dev/ttyAMA5` |

[VERIFIED: raspberrypi/linux PR #5436, forum t=347868 engineer confirmation from "PhilE"]

**Historical caveat — Bookworm regression (pre-6.1.28):** Enabling `uart2` or `uart5` on an affected kernel produced a warning *"aliased and non-aliased serial devices found in device tree. Serial port enumeration may be unpredictable"* and could remap UART0 → `/dev/ttyAMA1` while UART5 → `/dev/ttyAMA0`. This is why CONTEXT.md D-03 conservatively instructs the plan to `ls /dev/ttyAMA*` and bind udev by device-tree path, not by number. [CITED: raspberrypi/linux issue #5667]

**What the plan should actually record:**
- Run `ls -l /dev/ttyAMA*` after reboot; capture full output in `docs/`.
- Expected: `ttyAMA0` (ESP32) and `ttyAMA3` (LD19) both present, both symlinks (or both real char devices, depending on distro). If any other enumeration shows up, that's a kernel-version red flag but udev-path binding still works.

Confidence: HIGH.

### 3. udev rule syntax — bind by device-tree path, not USB VID/PID

**Device-tree path for uart3 on BCM2711:** `/sys/devices/platform/soc/fe201600.serial` → corresponding `DEVPATH` in udev contains `fe201600.serial`. [VERIFIED: BCM2711 memory map; multiple forum threads]

The BCM2711 PL011 UART base addresses:
- UART0 → `fe201000.serial`
- UART2 → `fe201400.serial`
- **UART3 → `fe201600.serial`** ← this is ours
- UART4 → `fe201800.serial`
- UART5 → `fe201a00.serial`

**Canonical udev rule (ready to paste):**

```udev
# LD19 LiDAR on Pi 4 UART3 (dtoverlay=uart3, GPIO4/5)
SUBSYSTEM=="tty", KERNELS=="fe201600.serial", SYMLINK+="ttyLIDAR", GROUP="dialout", MODE="0660"
```

- `SUBSYSTEM=="tty"` narrows to serial character devices.
- `KERNELS==` (plural, with S) walks up the parent chain of the device and matches against the parent platform-bus kernel name. `fe201600.serial` is that name for uart3 on BCM2711. This is the equivalent of device-tree-path matching in user space.
- `SYMLINK+=` *appends* (doesn't overwrite) so the existing `/dev/ttyAMA3` default name and the `/dev/serial3` alias (if present) both remain; `/dev/ttyLIDAR` is added as a new stable handle.
- `GROUP="dialout", MODE="0660"` matches the existing pattern in `udev/99-mower.rules` (ESP32 and GNSS lines use the same permissions).

**Reload procedure (plan uses this verbatim):**
```bash
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=tty
ls -l /dev/ttyLIDAR
```

[VERIFIED: reactivated.net "Writing udev rules" (Daniel Drake, canonical reference); forum confirmation of `KERNELS==` pattern for SoC peripherals]

**Sanity alternative if `KERNELS==` doesn't match** (bench-only, not the primary path): use `ATTRS{iomem_base}` or `DEVPATH=="*fe201600.serial*"`. Both are less idiomatic; `KERNELS==` is the right tool.

Confidence: HIGH on the pattern; MEDIUM on first-try match (the Pi's device-tree-name string for uart3 is sometimes `fe201600.serial` and occasionally surfaced as `3f201600.serial` on older 32-bit kernels — negligible for a Pi 4 on current aarch64 kernels). Plan's verification step (`ls -l /dev/ttyLIDAR` after reload) catches any mismatch immediately.

### 4. Pi 4 40-pin GPIO pinout — physical pin numbers

Verified from the KiCad `Raspberry_Pi_4` symbol definition in `hardware/MowerBot-MotorController.kicad_sch` lines 392 (pin 7, GPIO04) and 793 (pin 29, GPIO05), which matches pinout.xyz and the Pi 4 datasheet:

| Signal | BCM GPIO | Physical pin |
|--------|----------|--------------|
| `uart3_tx` (unused — LD19 is one-way) | GPIO4 | **7** |
| `uart3_rx` (reads LD19 Tx) | GPIO5 | **29** |
| 5V rail | — | **2** or 4 |
| GND (recommended, closest to pin 7) | — | **9** (or 6, 14, 20, 25, 30, 34, 39) |

**Planner guidance:** Use physical pin 2 for 5V (closest to pin 7) and pin 9 for GND (also close to pin 7 cluster, matches the side of the header where the pigtail will sit). This minimizes wire lengths. LD19 pin 2 (PWM) grounds to any convenient GND pin (pin 30 sits next to pin 29 = uart3_rx, which is a convenient "local" ground for the PWM jumper).

[VERIFIED: KiCad schematic pin numbers (symbol definition), pinout.xyz, official Pi 4 datasheet]

Confidence: HIGH.

### 5. HAT v2.0 GPIO4/5 routing check (THE gating question)

**Result: GPIO4 and GPIO5 pass through the HAT's 40-pin stacking header unencumbered. Pigtail strategy is viable.**

Evidence (from `hardware/MowerBot-MotorController.kicad_sch`):
- The HAT connects to the Pi via a `Connector:Raspberry_Pi_4` symbol (J1 at schematic line 7806), which models all 40 pins.
- Pin 7 of that symbol (`GPCLK0/GPIO04`, line 392) and pin 29 (`GPCLK1/GPIO05`, line 793) are declared but **have zero net labels, wires, or junctions attached** anywhere in the schematic.
- Full grep of the schematic for `GPIO04`, `GPIO05`, `GPCLK0`, `GPCLK1` returns only the two pin-definition lines inside the `Raspberry_Pi_4` symbol; no instance-side connection exists.
- The HAT's visible signal labels (`UART_TX_PI`, `UART_RX_PI`, `I2C_SDA`, `I2C_SCL`, `I2C_ESP_SDA`, `I2C_ESP_SCL`, `ML_LPWM`, `MR_RPWM`, `ENC_L_A`, `ENC_R_A`, `MOT_EN`, `+3V3`, `+5V`, `+12V`, `GND`) all route to *other* GPIO pins — specifically GPIO2/3 (I²C), GPIO14/15 (UART to ESP32), and various GPIO pins for encoders / PWM / enable.

**Conclusion:** The pigtail can land on the HAT's 40-pin pass-through header (or directly on the Pi's header beneath the HAT if the HAT is stacked with a pass-through connector) without any trace conflict, pull-up/pull-down interference, or tap to an unintended footprint. No HAT rework needed.

[VERIFIED: direct inspection of `hardware/MowerBot-MotorController.kicad_sch`]

Confidence: HIGH.

### 6. MINI560 headroom math — LD19 + existing HAT load

The LD19/STL-19P datasheet gives: **290 mA typical @ 5V; inrush TBD** (docs/datasheets/lidar/README.md). [CITED: docs/datasheets/lidar/D500-STL-19P-Datasheet.pdf §4.2]

**Existing HAT 5V consumers** (from `hardware/MowerBot-MotorController.kicad_sch` + `docs/pcb-motor-controller.md`):
- Pi 4 through 5V rail: 600–1500 mA typical, up to ~3 A peak (worst case with USB peripherals + WiFi burst).
- ESP32-C3 DevKit: ~50–80 mA typical, ~250 mA Wi-Fi TX peak (unused here — Wi-Fi off).
- MPU6050 (via Pi I²C but powered from +3V3, not 5V).
- ADS1115: powered from +3V3 — off the 5V budget.
- BTS7960 logic-side (VCC pin): ~5 mA each × 2 = ~10 mA. (Motor power is separate +12V; this is logic-side only.)
- WS2812 NeoPixel: ~20 mA @ white.
- LD19 new load: **290 mA steady + TBD inrush**.

**MINI560 nominal rating:** 5A continuous (widely advertised); realistically 3–4A with proper cooling. [CITED: common MINI560 board datasheet — widely published, vendor-variable]

**Analytic verdict:** Adding 290 mA to a rail that already supplies a Pi 4 should be **OK with margin** — the MINI560 has several amps of headroom. The real risk is the transient: when the BTS7960 drivers kick the 12V motor rail hard, there can be impulse back-coupling into the 5V regulator's input stage (12V source sags momentarily → MINI560 input under-voltage → brief 5V droop). This is precisely the pitfall 11 scenario. LD19 inrush at the same instant as motor-start could push the 5V line below LD19's 4.5V min spec.

**Expected measurement:** ≥4.9 V steady, 4.85–4.95 V during combined motor-start + LD19 inrush. The CONTEXT.md ≥4.85 V target should be comfortably met but is not guaranteed. If it misses, the fallback rail options are (a) a second MINI560 dedicated to LD19, or (b) adding a 470 µF bulk cap + 10 µF ceramic close to the LD19 power pins to absorb the transient without changing the source.

[ASSUMED] MINI560 5A nominal rating — true in vendor marketing but not from a primary datasheet this session. Measurement supersedes this assumption (the measurement IS the answer, per D-06).

Confidence: MEDIUM-HIGH on "comfortably passes"; deliberately MEDIUM because the measurement task is the authoritative answer.

### 7. Measurement procedure — 5V rail under motor transient

**Goal:** Produce a single committed artifact in `docs/` (e.g. `docs/5v-rail-measurement-ld19.md`) that answers: *with LD19 drawing steady current and motors executing a startup transient, does the shared MINI560 rail stay ≥4.85 V?*

**Instrument:** Multimeter with min/max-hold capability (e.g., Fluke 117, UT61E, or any DMM with "Max-Min" mode). A handheld oscilloscope or USB scope (e.g., Hantek) is the ideal tool but a min/max DMM is sufficient because the pass/fail threshold is relatively generous (150 mV below nominal 5V).

**Probe point:** Measure at the LD19 power pin (LD19 JST pin 4 / P5V) relative to the LD19 GND pin. Rationale: the pigtail has finite resistance; measuring at the source (HAT test pad) underestimates droop at the load. Red probe on the LD19's 5V pin, black on LD19 GND pin. Mower powered by its real battery (not a bench PSU — the battery's internal resistance is part of the measurement).

**Test scenario (two runs, document both):**
1. **Steady state:** Mower powered, LD19 spinning in steady-state (motor PID settled, ~10 Hz scan rate). Watch DMM for 30 s. Record steady voltage.
2. **Transient:** From inside the `nav` container or via a teleop command, send a `cmd_vel` that ramps both motors from zero to MAX_SPEED (0.28 m/s) in ~200 ms (i.e., a hard start, not a gentle ramp). Watch the DMM's Min capture. Repeat 5 times (each motor forward, each motor reverse, both forward). Record the minimum captured voltage.

**Pass/fail:**
- Steady ≥ 4.90 V AND Transient-min ≥ 4.85 V → PASS, commit measurement, decide shared MINI560 rail.
- Transient-min 4.70 – 4.85 V → MARGINAL, add 470 µF bulk cap + 10 µF ceramic close to LD19, remeasure.
- Transient-min < 4.70 V OR LD19 visibly resets (motor stops spinning then re-starts) during transient → FAIL, switch to a dedicated 5V source (second MINI560 or Pi USB-C PSU directly) before Phase 1 completion.

**Evidence artifact format** — plain Markdown table in `docs/5v-rail-measurement-ld19.md`, committed with the phase:

```markdown
| Run | Scenario                         | Steady 5V | Min 5V  | Notes |
|-----|----------------------------------|-----------|---------|-------|
| 1   | LD19 idle spinning               | 4.97 V    | 4.96 V  | battery 12.1V |
| 2   | Left motor hard-start fwd        | 4.97 V    | 4.89 V  | LD19 kept scanning |
| 3   | Right motor hard-start fwd       | 4.97 V    | 4.90 V  | — |
| 4   | Both motors hard-start fwd       | 4.97 V    | 4.87 V  | — |
| 5   | Both motors hard-start reverse   | 4.97 V    | 4.88 V  | — |
```

Decision line at bottom: **"PASS — shared MINI560 rail accepted. Headroom ≥40 mV above 4.85 V threshold."** (or fail / marginal with action taken).

Confidence: HIGH on the procedure; MEDIUM on the specific numbers expected (they depend on battery SoC + ambient temp + exact pigtail length).

### 8. ESP32-link regression test procedure

**Trigger:** After all boot-config + udev + wiring changes are committed AND the mower has been rebooted.

**Verification sequence** (run on the Pi host shell, not inside any container, unless noted):

```bash
# 1. Confirm ttyAMA0 still exists and ESP32 is visible
ls -l /dev/ttyAMA0
# Expected: crw-rw---- root dialout /dev/ttyAMA0

# 2. Confirm micro-ros-agent container is running
docker ps --filter name=mower-micro-ros --format 'table {{.Names}}\t{{.Status}}'
# Expected: Up N minutes

# 3. Confirm agent has reconnected to the ESP32 (log inspection)
docker logs --tail 40 mower-micro-ros 2>&1 | grep -E 'session established|agent is ready|created'
# Expected: "session established" or equivalent from the most recent boot

# 4. Inside the nav container, echo /odom and confirm live data
docker exec -it mower-nav bash -c 'source /opt/ros/humble/setup.bash && timeout 5 ros2 topic echo /odom --once'
# Expected output: a nav_msgs/msg/Odometry message with frame_id="odom",
#   child_frame_id="base_link", non-zero timestamp (sec, nanosec),
#   pose.pose and twist.twist populated.
#   Wheel encoder updates → twist.linear.x responds to motor commands.

# 5. Confirm topic rate matches firmware (typically 20 Hz from main.cpp loop cadence)
docker exec -it mower-nav bash -c 'source /opt/ros/humble/setup.bash && timeout 5 ros2 topic hz /odom'
# Expected: ~20 Hz (firmware main loop rate; see firmware/src/main.cpp cmd_vel watchdog)
```

**What "healthy" looks like**: `ros2 topic echo /odom --once` prints a YAML block of the form:

```yaml
header:
  stamp: { sec: 1712000000, nanosec: 000000000 }
  frame_id: odom
child_frame_id: base_link
pose:
  pose:
    position: { x: 0.0, y: 0.0, z: 0.0 }
    orientation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 }
twist:
  twist:
    linear: { x: 0.0, y: 0.0, z: 0.0 }
    angular: { x: 0.0, y: 0.0, z: 0.0 }
```

Exact field values depend on the firmware's odometry computation — what matters for regression is that the message arrives, has a recent timestamp, and responds to teleop `cmd_vel` inputs.

**Failure modes and diagnostics:**
- No `/odom` output → check `docker logs mower-micro-ros` for "serial port open failed" (ttyAMA0 perm issue) or "unable to communicate" (ESP32 UART wire broken during pigtail install).
- Static/stale timestamp → ESP32 booted but stopped publishing; reset ESP32 or check encoder ISRs.
- Topic exists but echo hangs → QoS mismatch (should be RELIABLE default for `/odom`; not sensor QoS).

Confidence: HIGH — this is the existing, well-exercised path documented in CLAUDE.md Architecture section.

### 9. Fallback — USB-UART dongle

**Trigger:** If steps 1–3 of the pigtail approach expose a hardware issue (GPIO4/5 unreachable from a practical wire route given the HAT stack-up, or the signal integrity at 230400 is poor due to antenna-like trace length over the HAT), switch to this fallback.

**Hardware:** CP2102 or CH340 USB-UART breakout (either works; LD19 is 3.3V logic, CP2102/CH340 are both 3.3V-TTL-capable when powered at 3.3V or with their TXD/RXD level pinned appropriately; most breakouts auto-select). Plug dongle into any Pi 4 USB port.

**Wiring:**
- Dongle GND ↔ LD19 pin 3 (GND) + LD19 pin 2 (PWM, grounded per D-05).
- Dongle TXD ↔ LD19 pin 1 Tx? → **NO**. Dongle's RXD ↔ LD19 pin 1 Tx. (LD19 transmits; dongle receives.)
- Dongle VCC (5V-selected) ↔ LD19 pin 4 P5V. **Warning:** most USB-UART dongles cannot source 290 mA reliably through their 5V pin (USB-bus-powered dongles are fine up to ~500 mA nominal but their onboard 5V trace may be thin). Safer: power LD19 from the shared MINI560 rail on the HAT and only use the dongle for data + ground. In that case, ensure both grounds are tied together (dongle GND ↔ HAT GND ↔ LD19 GND).

**udev rule (fallback, by VID/PID — mirrors the existing CH341 GNSS pattern):**

```udev
# CP2102 dongle fallback for LD19 (only if pigtail path fails)
# SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="ttyLIDAR", GROUP="dialout", MODE="0660"

# CH340 dongle fallback for LD19
# SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", SYMLINK+="ttyLIDAR", GROUP="dialout", MODE="0660"
```

(Both commented out by default. Note: CP2102 VID/PID `10c4:ea60` collides with the obsolete ESP32-CP2102 rule already in `udev/99-mower.rules` — if activating the CP2102 fallback, the obsolete ESP32 rule must be removed first since two `SYMLINK+=` entries for the same device match produces undefined which wins. CH340 is safer.)

**Plan deviation protocol:** If fallback is triggered, executor logs the deviation in the phase's verification doc, notes which of the two issues drove it (unreachable vs. SI), and captures a `picocom` byte dump showing the same 0x54 0x2C packet header that validates the primary path.

Confidence: HIGH on the wiring; MEDIUM on "won't actually be needed" (the pigtail is the right primary path).

### 10. IP5X operator-rule phrasing

Draft for `docs/operating-envelope.md` (new file) or append to existing hardware doc:

```markdown
## Operating Envelope

The LD19 / STL-19P LiDAR is rated IP5X (dust-protected) and is NOT rain-resistant.
Operating temperature: −10 °C to +45 °C. The mower must not be operated outside
these limits.

### Operator Rules
1. Do not operate the mower in rain, snow, or on wet/dewy grass. Dry-grass operation only.
2. Do not operate when the ambient temperature is below −10 °C or above +45 °C.
3. If the mower is caught in rain mid-mission, stop immediately, power down, and
   let the LiDAR dry for at least 2 hours before next run.

These are physical sensor limits, not software-enforceable. A weather shroud /
IP-rated enclosure is tracked as a v2 hardware deliverable.
```

[VERIFIED: docs/datasheets/lidar/README.md §"Mechanical / environmental" sourced from D500-STL-19P-Datasheet.pdf §4]

Confidence: HIGH.

## Ready-to-Paste Artifacts

### A. `/boot/firmware/config.txt` diff

```diff
 [all]
 ...
 dtoverlay=disable-bt
+dtoverlay=uart3
 ...
```

Do NOT add `enable_uart=1` unless baseline check finds `ttyAMA0` broken (it won't be — ESP32 already works).

### B. udev rule to append to `udev/99-mower.rules`

```udev
# LD19 LiDAR on Pi 4 UART3 (dtoverlay=uart3, GPIO4/5, BCM2711 fe201600.serial)
SUBSYSTEM=="tty", KERNELS=="fe201600.serial", SYMLINK+="ttyLIDAR", GROUP="dialout", MODE="0660"
```

Apply:
```bash
sudo cp udev/99-mower.rules /etc/udev/rules.d/99-mower.rules
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=tty
ls -l /dev/ttyLIDAR    # expect -> ../ttyAMA3 (or whatever the kernel gave uart3)
```

### C. Pi 4 40-pin pigtail wiring (pin-level)

| LD19 JST pin | LD19 signal | Pi 40-pin physical pin | Pi BCM / function |
|--------------|-------------|------------------------|-------------------|
| 1            | Tx (3.3V)   | **29**                 | GPIO5 / uart3_rx  |
| 2            | PWM         | **30**                 | GND (grounded per datasheet) |
| 3            | GND         | **9**                  | GND               |
| 4            | P5V         | **2**                  | +5V (shared MINI560 via Pi header) |
| —            | (Pi TX unused) | pin 7 left floating | GPIO4 / uart3_tx unused |

### D. 5V rail measurement protocol

See Finding 7. One-line summary for the plan task description: *"With mower on battery and LD19 spinning, measure V(LD19 pin 4 → LD19 pin 3) on a min/max DMM through 5 motor hard-start transients; commit table to `docs/5v-rail-measurement-ld19.md` with pass/marginal/fail decision."*

### E. Byte-level verification

```bash
# On the Pi host shell
sudo picocom -b 230400 -d 8 -p n -f n /dev/ttyLIDAR
# Expect: a stream of bytes starting with 0x54 0x2C repeating every ~1.4 ms (12 pts/packet @ 10Hz scan, 36 packets/scan).
# Exit picocom: Ctrl-A Ctrl-X
```

### F. ESP32 regression commands

See Finding 8 — all five commands are drop-in for the plan's regression task.

### G. Operator-rule doc stub

See Finding 10.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None — Phase 1 is pure hardware verification; no unit tests apply. Validation is by host-shell observation and ROS2 CLI. |
| Config file | None — see Wave 0 note below. |
| Quick run command | Per-requirement commands below (each < 10 s) |
| Full suite command | N/A — phase has no automated suite |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| HW-01 | `dtoverlay=uart3` active; new PL011 present | smoke | `grep -E '^dtoverlay=(disable-bt\|uart3)$' /boot/firmware/config.txt && ls -l /dev/ttyAMA*` | N/A |
| HW-02 | `/dev/ttyLIDAR` resolves and survives reboots | smoke | `ls -l /dev/ttyLIDAR && readlink /dev/ttyLIDAR` (run once per reboot × 3) | needs `udev/99-mower.rules` edit (in scope) |
| HW-03 | LD19 physically wired; bytes flowing with correct header | manual + smoke | `timeout 2 cat /dev/ttyLIDAR \| xxd \| head -5` — expect `5428` byte pairs repeating | N/A |
| HW-04 | ESP32 `/odom` still publishes post-changes | smoke | `docker exec mower-nav bash -c 'source /opt/ros/humble/setup.bash && timeout 5 ros2 topic echo /odom --once'` | N/A |
| HW-05 | 5V rail ≥ 4.85 V under transient, documented | manual | DMM measurement recorded in `docs/5v-rail-measurement-ld19.md` (file existence + content review) | needs new `docs/5v-rail-measurement-ld19.md` |

### Sampling Rate
- **Per task commit:** the command in the corresponding row above.
- **Per wave merge:** N/A (phase is not wave-structured — it is linear hardware tasks).
- **Phase gate:** all five rows pass; the 3-reboot test for HW-02 completed; Finding 7 evidence committed.

### Wave 0 Gaps
- [ ] `docs/5v-rail-measurement-ld19.md` — documents HW-05 DMM measurement and decision
- [ ] `docs/operating-envelope.md` (or section appended to existing hardware doc) — documents HW / IP5X + temperature operator rules (supports D-10, D-11)
- [ ] `docs/lidar-wiring.md` (or section appended to existing `docs/pcb-motor-controller.md`) — pigtail wiring table + `/boot/firmware/config.txt` diff snapshot

No test framework installation needed — Phase 1 has no code under test. Phases 2 and 3 will introduce pytest/jest patterns; they are out of scope for this phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `picocom` | HW-03 byte-level verification | ✗ (assumed not installed on Pi) | — | `apt install picocom` at plan-execution time; alt: `cat /dev/ttyLIDAR \| xxd` |
| `udevadm` | HW-02 udev reload | ✓ (systemd default) | systemd-bundled | — |
| `docker` + running compose stack | HW-04 regression | ✓ (already running — Phase 0 baseline) | existing | — |
| Multimeter with min/max capture | HW-05 measurement | **physical — operator must have** | — | oscilloscope acceptable |
| `xxd` / `hexdump` | Byte-dump capture for evidence | ✓ (coreutils / vim-common) | default | `od -An -tx1` |
| Battery, charged, powering the mower | HW-05 transient measurement | **physical — operator must have** | — | none — cannot fake transient with bench PSU without masking the battery-ESR contribution |

**Missing dependencies with no fallback:** None that are software. The physical dependencies (DMM, charged battery) are operator responsibilities.

**Missing dependencies with fallback:** `picocom` — trivial to install; plan should include `sudo apt install -y picocom` as a prep step.

## Project Constraints (from CLAUDE.md)

- ROS2 Humble fixed — no migration this milestone. New LD19 driver in Phase 2 goes in a Docker container with `network_mode: host`. Phase 1 does not touch compose.
- ESP32 ↔ Pi is UART `/dev/ttyAMA0` at 115200 — NOT USB. LiDAR must not conflict: uart3 on GPIO4/5 is disjoint from GPIO14/15 (ttyAMA0). Verified HIGH.
- CycloneDDS, rosbridge, NaN sanitization layer — load-bearing, preserve. Phase 1 does not touch any of these.
- Raspberry Pi 4 (NOT Pi 5) — UART routing constrained as planned above; Pi 5 has different pinout and would require re-verification if ever migrated.
- `commit_docs: true` in `.planning/config.json` — Phase 1's CONTEXT.md, this RESEARCH.md, and the eventual PLAN / VERIFICATION docs are auto-committed. Hardware docs (`docs/lidar-wiring.md`, `docs/5v-rail-measurement-ld19.md`, `docs/operating-envelope.md`) also should be committed by the plan's task actions.
- Branching strategy: `none` — Phase 1 lands directly on `main` (matches Phase 0).
- No direct edits outside a GSD workflow. Phase 1 executes via `/gsd-execute-phase`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | MINI560 nominal 5A rating is accurate; with existing HAT load + LD19 290 mA, headroom is "comfortable" | Finding 6 | LOW — the bench measurement (Finding 7) is the authoritative answer per D-06. Even if A1 is wrong, the plan catches it before Phase 1 completes. |
| A2 | BCM2711 uart3 device-tree path is exactly `fe201600.serial` (not `3f201600.serial` or another variant) on current 64-bit Bookworm kernels | Finding 3, udev rule | LOW — if wrong, `ls -l /dev/ttyLIDAR` after reload will show missing symlink; executor runs `udevadm info -a -n /dev/ttyAMA3` to confirm exact `KERNELS==` string, adjusts rule, reloads. 5-minute fix. |
| A3 | Kernel ≥ 6.1.28 deterministic enumeration holds on the target Pi (Ubuntu 22.04 or Raspberry Pi OS Bookworm) | Finding 2 | VERY LOW — CONTEXT.md D-03 already instructs the plan to not rely on enumeration number. |
| A4 | `disable-bt` is already in `/boot/firmware/config.txt` (CONTEXT.md D-01 baseline assumption) | Finding 1 | LOW — plan's first task is to verify; if missing, that's a prerequisite to add (one more line) and reboot once before the uart3 line goes in. |
| A5 | LD19 inrush on power-up does not exceed ~600 mA for more than ~10 ms | Finding 6, Finding 7 pass threshold | MEDIUM — datasheet lists inrush as TBD. If inrush is substantially worse, the 4.85V threshold may be missed and the fallback (bulk cap or dedicated rail) activates. The plan already covers this branch. |

## Open Questions

1. **LD19 exact inrush profile.** Datasheet says TBD. Bench measurement in Finding 7 catches it; no pre-execution research will close this gap because it's sensor-unit-to-unit variable.
2. **Long-term mechanical mount height.** Out of scope for Phase 1 (Phase 2 measures offsets for static TF). Noted here for continuity.

## Confidence + Gaps

**HIGH confidence:**
- Boot config mechanics (Finding 1): straightforward, single-line change, extensively documented.
- Device-tree path + udev pattern (Findings 2, 3): kernel source + forum engineer confirmations.
- HAT GPIO4/5 free (Finding 5): direct schematic inspection, zero conflicting labels.
- Pin numbering (Finding 4): primary source is the KiCad symbol + pinout.xyz; multiple triangulation.
- Regression test (Finding 8): exercises an existing, working path.
- Operator-rule content (Finding 10): directly from vendor datasheet.

**MEDIUM confidence:**
- MINI560 headroom pass prediction (Finding 6) — literal numeric expectation. Deliberate: the measurement IS the answer.
- First-try match of the exact `KERNELS==` string (Finding 3, A2) — `udevadm info -a -n /dev/ttyAMA3` is the belt-and-suspenders tool if needed.

**Still needs bench verification during execution:**
- Actual `/dev/ttyAMAn` node that uart3 lands on (verify with `ls -l /dev/ttyAMA*` after first reboot).
- Measured steady and transient 5V rail voltage at the LD19 feed point.
- LD19 inrush behavior on power-up — captured indirectly via the transient test.
- The three-reboot reboot-stability test for `/dev/ttyLIDAR`.

## Sources

### Primary (HIGH)
- `docs/datasheets/lidar/LD19-Development-Manual-V2.3.pdf` §§2, 3 — 230400 baud, 0x54 0x2C header, one-way protocol, PWM-must-be-grounded
- `docs/datasheets/lidar/D500-STL-19P-Datasheet.pdf` §§4, 5 — electrical (290 mA, 3.3V logic, 4.5–5.5V power), IP5X, temp range, JST pinout
- `docs/datasheets/lidar/README.md` — curated summary (tree-committed)
- `hardware/MowerBot-MotorController.kicad_sch` — direct inspection: GPIO4/5 unconnected on HAT
- `.planning/research/STACK.md` — Pi 4 UART matrix verified; uart3 cleanest free pair
- `.planning/research/PITFALLS.md` — pitfalls 1, 2, 3, 6, 11 applicable to Phase 1
- `docker-compose.yml`, `udev/99-mower.rules` — existing patterns to match
- `raspberrypi/linux` PR #5436 — kernel fix for UART enumeration stability on 6.1.28+
- `raspberrypi/firmware` `boot/overlays/README` — canonical dtoverlay reference for uart3

### Secondary (MEDIUM)
- Raspberry Pi Forums t=347868 — engineer confirmation that extra UART enumeration is deterministic on current kernels (serial2–serial5 aliases)
- Raspberry Pi Forums t=244827 — historical uart2-5 overlay reference
- Raspberry Pi Forums t=340392 — `dtoverlay=uart3` is sufficient without `enable_uart=1`
- reactivated.net "Writing udev rules" (Daniel Drake) — canonical udev `KERNELS==` pattern reference
- raspberrypi/linux issue #5667 — Bookworm UART enumeration regression history (now superseded by PR #5436)
- MINI560 vendor marketing — 5A nominal rating [ASSUMED A1]

## Metadata

**Confidence breakdown:**
- Boot-config mechanics: HIGH — primary sources + triangulation
- UART device-tree path + udev: HIGH — BCM2711 memory map + engineer confirmation
- HAT GPIO4/5 clearance: HIGH — direct schematic inspection
- 5V headroom analytic: MEDIUM — supersedes by measurement (by design)
- LD19 electrical + operator rule: HIGH — committed vendor datasheet

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (30 days — Pi 4 UART mechanics are stable; LD19 is a physical part, no software drift)

## RESEARCH COMPLETE

**Phase:** 1 — Hardware & UART Routing
**Confidence:** HIGH (with one deliberate MEDIUM on 5V headroom that resolves via the bench measurement)

The gaps flagged in CONTEXT.md are closed. The plan has: (a) the exact single-line `/boot/firmware/config.txt` diff (`dtoverlay=uart3`, no `enable_uart=1`); (b) the canonical udev rule bound to `KERNELS=="fe201600.serial"` that creates `/dev/ttyLIDAR` independent of the ttyAMAn enumeration shift; (c) verified-clean HAT v2.0 GPIO4/5 pass-through with zero net-label collisions in the schematic; (d) pin-level wiring table (LD19 → Pi header physical pins 29, 30, 9, 2); (e) a concrete 5-run DMM measurement protocol with pass/marginal/fail decision logic for HW-05; (f) a drop-in five-command regression sequence for HW-04; (g) a documented USB-UART fallback kept ready but explicitly out of the primary path; (h) operator-rule phrasing for IP5X + temperature bounds. Remaining unknowns are physical measurements (5V headroom magnitude, LD19 inrush, reboot stability) that CONNECT.md's measurement-first decision already marks as execution-time answers. Planner is clear to produce tasks.
