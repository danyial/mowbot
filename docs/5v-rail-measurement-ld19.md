# 5V Rail Measurement — LD19 on Shared MINI560

**Status (2026-04-14):** **DEFERRED** — motors are not yet electrically connected to the BTS7960 drivers on this HAT, so the combined-load transient portion of the measurement cannot be run. HW-05 is therefore partially open. Phase 1 closes with HW-01..HW-04 satisfied and HW-05 tracked as a blocking pre-autonomy task.

**Why this matters:** A sub-4.85 V dip during a motor hard-start while the LiDAR is drawing its 290 mA steady current could brown out the sensor mid-mission, blinding obstacle avoidance exactly when it matters most. The measurement is cheap; the failure mode is not.

**Re-open trigger:** Motors wired to the BTS7960 drivers AND encoder feedback live (`ros2 topic echo /odom` reports non-zero twist under `cmd_vel` input). See `.planning/todos/pending/5v-rail-transient-measurement.md`.

## Procedure (execute when motors are connected)

**Instrument:** DMM with min/max-hold (Fluke 117 / UT61E class) OR handheld oscilloscope.

**Probe point:** Red on LD19 JST pin 4 (P5V), black on LD19 JST pin 3 (GND) — measured at the sensor (load side of pigtail, NOT at the HAT test pad — the pigtail has finite resistance and HAT-side measurement would be optimistically biased).

**Power source:** Real battery at a realistic SoC (NOT bench PSU — the battery's internal resistance is part of the measurement).

**Ambient:** Indoor bench or representative outdoor temperature.

## Measurements

Execute 5 runs. Record DMM **Steady V** (running average while holding) and DMM **Min V** (min-hold captured during the scenario).

| Run | Scenario                         | Steady 5V | Min 5V  | Notes |
|-----|----------------------------------|-----------|---------|-------|
| 1   | LD19 idle spinning (no motors)   |  _TBD_    |  _TBD_  | Battery V at start |
| 2   | Left motor hard-start fwd        |  _TBD_    |  _TBD_  | LD19 kept scanning? |
| 3   | Right motor hard-start fwd       |  _TBD_    |  _TBD_  |       |
| 4   | Both motors hard-start fwd       |  _TBD_    |  _TBD_  |       |
| 5   | Both motors hard-start reverse   |  _TBD_    |  _TBD_  |       |

**Trigger commands** (firmware watchdog auto-stops after 500 ms without new `cmd_vel` — each `--once` gives a clean ~200 ms hard-start transient):

```bash
# Run 2 — left motor hard-start forward
docker exec -it mower-nav bash -c 'source /opt/ros/humble/setup.bash && \
  ros2 topic pub --once /cmd_vel geometry_msgs/msg/Twist \
  "{linear: {x: 0.14}, angular: {z: 0.28}}"'
# Run 3 — right: linear.x 0.14, angular.z -0.28
# Run 4 — both fwd: linear.x 0.28, angular.z 0.0
# Run 5 — both rev: linear.x -0.28, angular.z 0.0
```

## Decision thresholds (per RESEARCH.md Finding 7)

- Steady ≥ 4.90 V AND transient-min ≥ 4.85 V → **PASS** — shared MINI560 rail accepted.
- Transient-min 4.70–4.85 V → **MARGINAL** — add 470 µF bulk cap + 10 µF ceramic near the LD19 power pins, remeasure.
- Transient-min < 4.70 V OR LD19 visibly resets during transient → **FAIL** — switch to dedicated rail (second MINI560 or Pi USB-C PSU) before marking closed.

**Result:** _DEFERRED (motors not yet connected as of 2026-04-14)_
**Action taken:** _Stub file committed; re-open triggered when motors live. Todo: `.planning/todos/pending/5v-rail-transient-measurement.md`._
