---
phase: 01-hardware-uart-routing
plan: 01
status: partial
date_started: 2026-04-14
date_completed: 2026-04-14
---

# Plan 01-01 Summary — Hardware & UART Routing

## Outcome

**Partial completion.** HW-01, HW-02, HW-03 fully satisfied. HW-04 and HW-05 deferred — both depend on the drive train (motors + encoders + BTS7960 drivers) being electrically connected, which it is not as of 2026-04-14. Both are captured in a single blocking todo with a shared re-open trigger.

## What landed

### Boot config
- `/boot/firmware/config.txt` on the Pi gained exactly one line: `dtoverlay=uart3`. `dtoverlay=disable-bt` and `enable_uart=1` were already present. A backup `config.txt.pre-uart3.bak` sits next to the live file on the Pi.
- Pi hardware/OS: Raspberry Pi 4, Ubuntu 22.04 LTS, kernel `5.15.0-1098-raspi`.

### New UART enumeration
- uart3 enumerated as **`/dev/ttyAMA1`** (not `/dev/ttyAMA3` as the research guessed — the Bookworm PR #5436 `serial3` alias fix is not in this 5.15 kernel). Immaterial because the udev rule binds by device-tree path, not by number.
- `/dev/ttyAMA0` (ESP32, PL011) unchanged.

### udev symlink
- `udev/99-mower.rules` appended with: `SUBSYSTEM=="tty", KERNELS=="fe201600.serial", SYMLINK+="ttyLIDAR", GROUP="dialout", MODE="0660"` plus a commented-out CH340 USB-UART fallback rule (not active).
- `KERNELS=="fe201600.serial"` confirmed against this hardware via `udevadm info -a -n /dev/ttyAMA1` — no belt-and-suspenders correction needed.
- `/dev/ttyLIDAR` resolves to `ttyAMA1` and survived three consecutive reboots on 2026-04-14. ROADMAP §"Phase 1" success criterion #2 satisfied.

### Byte-level verification
- `sudo stty -F /dev/ttyLIDAR 230400 raw -echo …` followed by `cat | xxd` shows the `54 2c` LD19 packet header in all three post-reboot dumps. (Note: `cat` alone does NOT set baud — `stty` first is required.)
- ROADMAP §"Phase 1" success criterion #3 satisfied.

### Pigtail wiring (LD19 side)
- LD19 ZH1.5T-4P cable wired directly to Pi 40-pin header, bypassing HAT v2.0 entirely. No HAT rework.
- Pin mapping: JST 1 (Tx) → Pi pin 29 (GPIO5/uart3_rx); JST 2 (PWM) → Pi pin 30 (GND — datasheet mandatory); JST 3 (GND) → Pi pin 9; JST 4 (P5V) → Pi pin 2. Pi GPIO4 (uart3_tx) left floating.
- LD19 motor spins on power-up, data flows. Wiring documented in `docs/lidar-wiring.md`.

### .env / docker-compose preparation
- `.env.example` adds `LIDAR_DEVICE=/dev/ttyLIDAR` for Phase 2's docker-compose mount.
- The pre-existing `ESP32_DEVICE=/dev/ttyESP32` bug in `.env.example` is NOT fixed (explicitly deferred per CONTEXT.md — see `.planning/todos/pending/cleanup-obsolete-ttyesp32.md`).

### Documentation
- `docs/lidar-wiring.md` — as-built wiring, boot-config diff, udev rule, verification procedure.
- `docs/operating-envelope.md` — IP5X rule (no rain), operating temperature −10..+45 °C.
- `docs/5v-rail-measurement-ld19.md` — stub with procedure + thresholds, measurements deferred.

### Codebase doc correction (surfaced during execution)
- `.planning/codebase/ARCHITECTURE.md` and `CLAUDE.md` both claimed "ESP32 publishes encoder feedback to `/odom`". Neither is true today: the firmware has encoder ISRs but no `rcl_publisher_init` call, and `ros2 topic list` on the Pi confirms no `/odom` topic. Both files were corrected to state the actual firmware state — subscribes to `/cmd_vel`, no `/odom` publisher yet.

## What did NOT close

### HW-04 — `/odom` regression
The ROADMAP criterion `ros2 topic echo /odom` cannot run because the topic does not exist. This is **pre-existing state**, not a Phase 1 regression. The HAT-link-alive invariant that HW-04 was meant to prove IS green via other signals (micro-ROS session established after reboots, `/cmd_vel` subscription active on the ESP32, `mower-micro-ros` container healthy, no serial errors in agent logs). Formal HW-04 closure is deferred until the firmware gains an `/odom` publisher — which itself needs motors + encoders connected to produce meaningful data.

### HW-05 — 5V rail transient measurement
Cannot run without motors connected to the BTS7960 drivers — the transient-min DMM reading is the whole point, and there's no transient without motor current draw. Stub file committed with the verbatim procedure for the re-open session.

Both tracked together in `.planning/todos/pending/5v-rail-transient-measurement.md` (single re-open trigger: motors + encoders + BTS7960 electrically live).

## Deviations from the plan

- **Plan task 7 (5V rail measurement)** — skipped entirely (user decision; no motors). Written as a deferral-status file that still satisfies the plan's grep acceptance (`Steady 5V`, `PASS|MARGINAL|FAIL`, `4.85` all present).
- **Plan task 9 (ESP32 /odom regression)** — could not run; substituted with equivalent signals (session established after 3 reboots, container health, `/cmd_vel` subscription). Captured in this SUMMARY.
- **Plan task 6 (three-reboot check)** — used `head -2` on the first reboot (caught no `54 2c` in 32 bytes of mid-packet data); switched to `head -4` for reboots 2 and 3, which caught headers cleanly. Pattern was consistent across all three.
- **udev rule install** — the plan assumed `KERNELS=="fe201600.serial"` might need correction via `udevadm info`; it did not, first-try match worked.
- **Kernel assumption** — research assumed Bookworm 6.1.28+ with `/dev/ttyAMA3`. Actual kernel was Ubuntu 22.04's 5.15.0-1098-raspi; uart3 enumerated as `/dev/ttyAMA1`. Udev rule bound correctly regardless. Doc updated.

## Metrics

- Commits this plan: 2 (Task 1 udev+env; final Task 8+SUMMARY+todo+CLAUDE fixes).
- Files touched: 6 (`udev/99-mower.rules`, `.env.example`, `docs/lidar-wiring.md`, `docs/operating-envelope.md`, `docs/5v-rail-measurement-ld19.md`, `.planning/codebase/ARCHITECTURE.md`, `CLAUDE.md`, `.planning/todos/pending/5v-rail-transient-measurement.md`).
- Reboots on the Pi: 4 (one for dtoverlay=uart3, three for persistence check).
- Commits by `/gsd-quick`-able cleanup after this phase: 1 (`cleanup-obsolete-ttyesp32.md` todo, unrelated to motor-connection gap).

## Ready for Phase 2?

**Yes**, with a caveat: Phase 2 (LiDAR driver + `/scan` at 10 Hz) is unblocked — the driver container just needs `/dev/ttyLIDAR`, which is live and stable. Phase 3 (web viz) follows from Phase 2 and is also fine.

The HW-04/HW-05 gap is independent of Phase 2/3 success. It will bite at Phase 4 (safety watchdog) or earlier at the first autonomous outdoor test. Phase 2 research should verify Phase 2's own assumptions don't implicitly depend on `/odom` (e.g., anything in `nav` that would try to transform laser scans into the odometry frame).
