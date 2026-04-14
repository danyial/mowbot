# Phase 1: Hardware & UART Routing - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Get the LD19 LiDAR electrically reachable from the Pi 4 on a stable, dedicated PL011 UART device path (`/dev/ttyLIDAR`), without breaking the existing HAT/ESP32 serial link on `ttyAMA0`. Phase 1 ends when `picocom 230400 /dev/ttyLIDAR` shows valid `0x54 0x2C` packet headers, three consecutive reboots all produce the same udev symlink, and the ESP32 `/odom` regression check stays green.

**Out of bounds for Phase 1:**
- Driver containerization / `/scan` publication — Phase 2.
- TF calibration of mount offsets — Phase 2 measures and records.
- Any web UI work — Phase 3.
- Safety watchdog — explicitly deferred (out of milestone scope).
- HAT v2.1 PCB respin — deferred to v2 milestone (pigtail suffices).
- Weather shroud mechanical design — deferred to v2 (rule + docs only this phase).

</domain>

<decisions>
## Implementation Decisions

### Boot Config
- **D-01:** `dtoverlay=disable-bt` is assumed already present in `/boot/firmware/config.txt`. Evidence: the existing codebase uses `/dev/ttyAMA0` at 115200 for the ESP32 link (docker-compose.yml, CLAUDE.md) — on Pi 4 this only works with Bluetooth disabled so `ttyAMA0` binds to GPIO14/15 PL011. Phase 1 does **not** add `disable-bt`; it is treated as pre-existing baseline state that the plan's first task verifies before making any further changes.
- **D-02:** Phase 1 adds exactly one line to `/boot/firmware/config.txt`: `dtoverlay=uart3` (on GPIO4/5). Research anchor already rules out alternatives: `uart2` collides with HAT ID EEPROM on GPIO0/1; `uart4` collides with WS2812 on GPIO8/9; `uart5` collides with BTS7960 PWM traces; `ttyS0` miniUART is unreliable at 230400 under CPU load.
- **D-03:** After reboot, the new PL011 node is expected at `/dev/ttyAMA1` (or higher — enumeration not guaranteed). The plan must `ls /dev/ttyAMA*` and record the actual node name, then bind the udev rule to the device-tree path (not the `ttyAMAn` number) so enumeration shifts across kernels don't break `/dev/ttyLIDAR`.

### Wiring Path
- **D-04:** **Pigtail direct to Pi 40-pin GPIO.** The LD19's 4-pin ZH1.5T cable is terminated onto a small header/dupont pigtail that plugs onto Pi GPIO — bypassing HAT v2.0 entirely. Zero HAT rework this milestone. Documented in `docs/` with pin-level wiring diagram.
- **D-05:** Pin mapping (Pi 40-pin header ↔ LD19 4-pin JST per datasheet §5.3):
  - LD19 pin 1 (Tx, 3.3V logic) → Pi GPIO5 / BCM5 (physical pin 29) = uart3_rx.
  - LD19 pin 2 (PWM) → **Pi GND (physical pin 30 or any GND)** — grounded per datasheet requirement ("When not using external speed control, the PWM pin must be grounded"). Motor will not spin otherwise.
  - LD19 pin 3 (GND) → Pi GND (any GND pin).
  - LD19 pin 4 (P5V) → see D-06 (rail decision).
  - Note: LD19 Tx is output-only; Pi GPIO4 (uart3_tx) is left unconnected (sensor is one-way per datasheet §5.4).
- **D-06:** **5V source: shared MINI560 rail, validated by measurement.** Phase 1 includes a measurement task: with the mower powered, motors cycled through a startup transient, and LD19 drawing steady current, measure rail voltage at the LD19 feed point. Target ≥4.85V (margin above datasheet min 4.5V). Evidence committed to `docs/`. If measured <4.85V, switch to a dedicated rail (Pi 5V via USB-C PSU, or second MINI560) before Phase 1 completion.

### Device Path
- **D-07:** Extend the existing `udev/99-mower.rules` file with a new entry binding **by device-tree path** (NOT by USB VID/PID) to create `/dev/ttyLIDAR`. This differs from the existing rules: the ESP32 is wired via UART on `ttyAMA0` (no udev symlink used in the live path — see note below), and `/dev/ttyGNSS` is a USB-UART device bound by CH341 VID/PID (`1a86:7523`). LD19 is on a Pi-internal UART, so its udev matcher is a `DEVPATH`/`KERNELS`-style pattern tied to the `uart3` device-tree node. Rule must survive `udevadm control --reload-rules && udevadm trigger` and three consecutive reboots.
- **D-08:** Bytes-flowing verification is `picocom -b 230400 /dev/ttyLIDAR` shows the `0x54 0x2C` packet header pattern. The plan's verification task does this — no driver, no ROS2, just raw bytes.

### Regression — ESP32 Link Integrity
- **D-09:** After all boot-config + udev + wiring changes, verify the ESP32 link is unchanged: from inside the existing `nav` container, `ros2 topic echo /odom` must show live encoder data. This is the plan's final gate before Phase 1 is marked complete. ROADMAP success criterion #4.

### Weather / Environmental
- **D-10:** LD19 is **IP5X — dust-resistant only, NOT rain-resistant**. Phase 1 scope: document the limit in `docs/` (add to the hardware wiring doc or a new `docs/operating-envelope.md`) and establish a "no-mow-in-rain" operator rule. Physical weather shroud is deferred to v2. Record in PROJECT.md "Out of Scope" section that mechanical weather protection is v2-tracked.
- **D-11:** Operating temperature window per datasheet: −10 °C to +45 °C. Document alongside the IP rating. Not a v1 hardware deliverable — awareness-only.

### Claude's Discretion
- Exact GND pin choice among the many Pi 40-pin GND pins (any works electrically).
- Whether to add `enable_uart=1` explicitly alongside `dtoverlay=uart3` (often redundant but harmless — planner decides).
- Exact udev rule syntax (ATTRS path pattern) — pattern must match the device-tree path for uart3, planner researches kernel-specific string.
- Format of the wiring doc (Markdown with ASCII pinout vs. a KiCad schematic snippet vs. both).
- Whether to record `cat /boot/firmware/config.txt` diff as a pre/post snapshot in `docs/` or only narrate the change.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` §"Phase 1: Hardware & UART Routing" — goal + 5 success criteria verbatim.
- `.planning/REQUIREMENTS.md` §"Hardware & UART Routing" — HW-01 through HW-05.

### LiDAR vendor specs (user-supplied, 2026-04-14)
- `docs/datasheets/lidar/D500-STL-19P-Datasheet.pdf` — electrical/mechanical spec. See §4.2 (ZH1.5T-4P pinout, 230400 UART, 3.3V logic), §4.1 (IP5X, temp range), §5.3 (connector).
- `docs/datasheets/lidar/LD19-Development-Manual-V2.3.pdf` — protocol reference. §2 (communication interface, PWM-must-be-grounded rule), §3 (0x54/0x2C packet format).
- `docs/datasheets/lidar/README.md` — curated summary of key facts, including the PWM-ground and IP5X flags that shape Phase 1 decisions.

### Research anchors
- `.planning/research/SUMMARY.md` §"Phase 1" and §"Critical Pitfalls" 1–3, 6, 11 (miniUART jitter, HAT EEPROM collision, udev, 5V brownout).
- `.planning/research/STACK.md` — Pi 4 UART matrix, driver choice, rosbridge tuning (Phase 2/3 relevance).
- `.planning/research/PITFALLS.md` — full pitfall treatments.

### Existing codebase
- `docker-compose.yml` — shows current `/dev/ttyAMA0:/dev/ttyAMA0` device mount for ESP32 (micro-ros-agent). Phase 1 must not break this.
- `CLAUDE.md` — references `/dev/ttyESP32` as if active, but this is **stale**: ESP32 runs on UART `/dev/ttyAMA0` (see `docker-compose.yml`). The only live USB udev symlink today is `/dev/ttyGNSS` (CH341 USB-UART to the UM980 GNSS). Treat CLAUDE.md mentions of `ttyESP32` as outdated; do not propagate into new code or docs.
- `udev/99-mower.rules` — exists. Contains a CP2102→`ttyESP32` rule (obsolete dev-kit fallback, harmless) and a CH341→`ttyGNSS` rule (live). Phase 1 EXTENDS this file with a new LD19 entry. The existing entries are NOT touched in Phase 1 (cleanup of the obsolete ESP32 rule is a separate `/gsd-quick` todo, not in this phase's scope).
- `hardware/` — KiCad HAT v2.0 schematic. Visually check GPIO4/5 routing through HAT pass-through header before committing the pigtail plan (research flag from SUMMARY.md "Gaps to Address").

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Existing udev symlink pattern** — **only `/dev/ttyGNSS` is live** (CH341 USB-UART → UM980 GNSS, bound by VID/PID `1a86:7523`). The `ttyESP32` rule in `udev/99-mower.rules` is an obsolete CP2102-USB-fallback from a pre-HAT topology; the real ESP32 link is UART `/dev/ttyAMA0`. `/dev/ttyLIDAR` will use a **different** binding style than either existing rule — matching the `uart3` device-tree node, not a USB VID/PID.
- **Docker device-mount pattern** — `docker-compose.yml` mounts `${ESP32_DEVICE:-/dev/ttyAMA0}:/dev/ttyAMA0` for micro-ros-agent. Note: `.env.example` currently sets `ESP32_DEVICE=/dev/ttyESP32` which incorrectly overrides the correct UART default — this is a pre-existing bug flagged here but NOT fixed in Phase 1 (separate `/gsd-quick` cleanup). Phase 2 will reuse the `${VAR:-/dev/ttyLIDAR}:/dev/ttyLIDAR` override pattern. Phase 1 does not touch compose.
- **`.env.example`** — Defines `ESP32_DEVICE` / `GNSS_DEVICE`. Phase 1 may add `LIDAR_DEVICE=/dev/ttyLIDAR` for Phase 2's benefit (optional — Claude's discretion). Phase 1 does NOT fix the existing `ESP32_DEVICE` bug.

### Established Patterns
- `commit_docs: true` in `.planning/config.json` means phase CONTEXT/PLAN/VERIFICATION commit automatically.
- Branching strategy: `none` — Phase 1 lands directly on `main`, same as Phase 0.
- `hardware/` directory has uncommitted WIP (PCB v2.0 files, STEP models, DRC reports) — Phase 1 INHERITS this dirty state as disclosed in Phase 0's ADOPTION.md. Phase 1 does not respin the PCB but MAY commit hardware-relevant documentation updates (wiring diagram, pigtail instructions) that describe the real as-built state.

### Integration Points
- `/boot/firmware/config.txt` — the ONE file change that matters most. Must be edited on the Pi itself (not checked into this repo). Plan must document both the change and the `cat` verification step.
- `udev/99-mower.rules` — repo-tracked; committed change.
- `docs/` — where the wiring diagram, 5V measurement record, and IP5X operator rule live.

</code_context>

<specifics>
## Specific Ideas

- User explicitly asked that the LD19 datasheet + dev manual PDFs (committed in `1c67a6c`) be used as canonical refs — not just the existing research summary. Planner must quote exact values from the vendor PDFs (pinout, PWM-ground requirement, IP5X) rather than paraphrasing research.
- Measurement-first on the 5V rail: the user chose "measure, then decide" over "commit to MINI560 now." This preference means Phase 1's plan includes a physical measurement task with a defined pass/fail threshold (≥4.85V), NOT an analytic argument about MINI560 spec margin.
- IP5X rule + docs only — no mechanical scope creep. If a weather shroud comes up during planning, it gets noted in Deferred Ideas and the plan does not grow.

</specifics>

<deferred>
## Deferred Ideas

- **HAT v2.1 PCB respin with dedicated LD19 header/JST** — v2 milestone. Pigtail on HAT v2.0 is the this-milestone answer.
- **Physical weather shroud / IP-rated enclosure for LD19** — v2 milestone (new requirement, mechanical-design sub-project). Tracked by D-10's documentation.
- **External PWM-based motor-speed control of the LD19** — not needed for a 10 Hz scan rate; internal regulation is default and sufficient. PWM pin permanently grounded.
- **USB-UART dongle fallback** — research-mentioned as a fallback if GPIO4/5 can't be routed. Not activated unless the pigtail approach hits an unexpected HAT-v2.0 routing block during Phase 1 execution; in that case, planner/executor falls back and logs a deviation.
- **Obsolete `/dev/ttyESP32` cleanup** — the CP2102→`ttyESP32` udev rule, `.env.example` `ESP32_DEVICE=/dev/ttyESP32` override, and `CLAUDE.md` / `README.md` / `setup.sh` references are all stale (ESP32 is on UART `/dev/ttyAMA0`, not USB). Explicitly flagged by user 2026-04-14. Out of Phase 1 scope — handle as a separate `/gsd-quick` doc-cleanup task after Phase 1 completes, so Phase 1 stays focused on LD19 wiring.

</deferred>

---

*Phase: 01-hardware-uart-routing*
*Context gathered: 2026-04-14*
