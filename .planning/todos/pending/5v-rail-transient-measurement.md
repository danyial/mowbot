---
title: Post-motor-connection validation (HW-04 /odom publisher + HW-05 5V transient)
area: hardware
created: 2026-04-14
source: phase-1-execution
priority: high
reopen_trigger: JGB37-520 motors + 11-tick encoders + BTS7960 drivers physically wired to HAT v2.0 and ESP32
blocks: Phase 4+ (autonomous outdoor operation, safety watchdog)
---

# Post-Motor-Connection Validation

**Status (2026-04-14):** DEFERRED during Phase 1. The two hardware-requirements below both depend on the drive train being physically connected. Phase 1 closes with HW-01..HW-03 fully satisfied; this todo covers HW-04 and HW-05 together because they share a single upstream blocker (motors not yet wired).

## Re-open trigger

Motors, encoders, and BTS7960 drivers electrically connected to the HAT v2.0. Verified by:
- PWM + direction GPIOs on the ESP32 routed to the two BTS7960 modules
- Both wheel encoders' A/B channels routed to the ESP32's ISR-capable GPIOs
- `+12V` motor rail live from the XT60 input through HAT routing

## Part A — HW-04: ESP32 `/odom` publisher + HAT-link regression

**Problem:** The current ESP32 firmware (`firmware/src/main.cpp`) subscribes to `/cmd_vel` via micro-ROS but does NOT publish `/odom`. Confirmed by:
- `grep -n rcl_publisher_init firmware/src/main.cpp` → zero matches
- `ros2 topic list` on the Pi 2026-04-14 → no `/odom` topic
- micro-ROS agent logs show only `create_subscriber`/`create_datareader`, never `create_publisher`/`create_datawriter`

**What to do when motors are connected:**

1. Extend `firmware/src/main.cpp` with a `nav_msgs__msg__Odometry` publisher on `/odom`.
2. Integrate encoder counts with the differential-drive kinematics already in the firmware to produce pose + twist.
3. Publish at ~20 Hz (matches existing firmware loop).
4. Build + flash via PlatformIO, restart `mower-micro-ros` container.
5. Run the ROADMAP §"Phase 1" #4 regression gate verbatim:

   ```bash
   # On the Pi (or via ssh)
   docker exec mower-nav bash -c 'source /opt/ros/humble/setup.bash && \
     timeout 5 ros2 topic echo /odom --once'
   docker exec mower-nav bash -c 'source /opt/ros/humble/setup.bash && \
     timeout 5 ros2 topic hz /odom'
   ```

   Expected: populated `nav_msgs/msg/Odometry` with recent timestamp, ~20 Hz rate.

6. Update `.planning/REQUIREMENTS.md` — mark HW-04 as verified with date + commit SHA.

**Scope note:** This is firmware work — likely large enough to be its own phase rather than a tail of Phase 1. Revisit sizing when picking it up.

## Part B — HW-05: 5V rail measurement under motor transient + LD19 load

**Procedure (verbatim from `.planning/phases/01-hardware-uart-routing/01-RESEARCH.md` Finding 7):**

- **Instrument:** DMM with min/max-hold (Fluke 117 / UT61E class) or handheld oscilloscope.
- **Probe point:** Red on LD19 JST pin 4 (P5V), black on LD19 JST pin 3 (GND) — measured AT THE SENSOR (load side of pigtail).
- **Power:** Real battery, not bench PSU. Record SoC at start.

**5 runs with DMM min/max-hold engaged:**

| Run | Scenario                         | Trigger                                                               |
|-----|----------------------------------|-----------------------------------------------------------------------|
| 1   | LD19 idle spinning               | LD19 powered, motors idle — 30 s                                      |
| 2   | Left motor hard-start forward    | `ros2 topic pub --once /cmd_vel … linear.x: 0.14, angular.z: 0.28`    |
| 3   | Right motor hard-start forward   | `… linear.x: 0.14, angular.z: -0.28`                                  |
| 4   | Both motors hard-start forward   | `… linear.x: 0.28, angular.z: 0.0`                                    |
| 5   | Both motors hard-start reverse   | `… linear.x: -0.28, angular.z: 0.0`                                   |

Record Steady V + Min V per row into `docs/5v-rail-measurement-ld19.md`.

**Pass/Fail thresholds:**
- Steady ≥ 4.90 V AND transient-min ≥ 4.85 V → **PASS** (shared MINI560 accepted).
- Transient-min 4.70–4.85 V → **MARGINAL** (add 470 µF bulk + 10 µF ceramic near LD19 pins, remeasure).
- Transient-min < 4.70 V OR LD19 resets → **FAIL** (switch to dedicated rail).

Then update `.planning/REQUIREMENTS.md` — mark HW-05 verified.

## Why defer together

Both requirements need the drive train electrically live, and the 5V measurement benefits from having `/odom` available to verify the LiDAR is actually streaming during the motor-transient runs. Single post-connection session knocks both out.

## References

- `.planning/phases/01-hardware-uart-routing/01-RESEARCH.md` Finding 7 (5V protocol), Finding 8 (regression command sequence)
- `.planning/phases/01-hardware-uart-routing/01-CONTEXT.md` D-06, D-09
- `docs/5v-rail-measurement-ld19.md` (stub; measurement rows to be filled when re-opened)
- `docs/lidar-wiring.md` (pigtail wiring — LD19 side already complete)
- ROADMAP.md §"Phase 1" success criteria #4 + #5 / REQUIREMENTS.md HW-04, HW-05
- Firmware entry: `firmware/src/main.cpp` — publisher to be added
