# Codebase Concerns

**Analysis Date:** 2026-04-14

## Hardware: PCB Design Issues

### DRC Violations (2 errors)

**Courtyard Overlap Errors:**
- Issue: Two component courtyard overlap violations detected at (115.824mm, 78.298mm) and (123.444mm, 93.3215mm)
- Files: `hardware/MowerBot-MotorController.kicad_pcb`, `hardware/MowerBot-MotorController_drc_violations.json`
- Impact: Components may physically collide during assembly or operation. Risk of damaged solder joints, failed connections, or component destruction.
- Fix approach: Review actual component placement in PCB layout. Likely involves repositioning either the MINI560 step-down module (30x18mm) or nearby components (R1, R2, C2, C3) away from overlapping footprints. May require shrinking PCB or moving components to different layer/area.

### ERC Warnings (4 expected, benign)

**Isolated Pin Labels:**
- Files: `hardware/MowerBot-MotorController.kicad_sch` (lines 5-16)
- Issue: Labels `ML_R_IS`, `ML_L_IS`, `MR_R_IS`, `MR_L_IS` connected to only one pin each
- Impact: Expected warnings — these are placeholder nets for future current-sense implementation. Intentionally unconnected per schematic documentation.
- Status: Acknowledged in design; not a critical issue.

## Firmware Safety Gaps

### Motor Runaway Risk (Critical)

**Insufficient Safeguards:**
- Files: `firmware/src/main.cpp` (lines 224-241, 375-389)
- Issue: Timeout-based watchdog stops motors after 500ms (CMD_TIMEOUT_MS). If UART communication drops but agent stays connected at ROS level, motors could receive stale `cmd_vel` messages or the timeout could be circumvented.
- Problem: Only **time-based** shutdown. No current-sensing feedback, stall detection, or emergency stop circuit.
- Scenario: Robot stuck in obstacle → motor stalls drawing high current → thermal runaway of BTS7960 → potential fire or component failure.
- Fix approach: 
  1. Implement current-sense monitoring via ADS1115 (hardware ready, see `hardware/MowerBot-MotorController.kicad_sch` lines 412-443)
  2. Add stall-current threshold detection in firmware
  3. Add hardware watchdog timer (separate from software timeout)
  4. Implement E-stop circuit (manual kill switch or software command priority)

### Motor Test Pulse in Production Code

**Auto-Test in Setup:**
- Files: `firmware/src/main.cpp` (lines 312-340)
- Issue: 5-second delay at boot, then 1-second forward + 1-second reverse test pulses (30% power). Marked with comment "ENTFERNEN wenn Motoren bestaetigt funktionieren!" (REMOVE when motors confirmed working).
- Impact: Every firmware upload auto-tests motors without user awareness. Hazardous on assembled robot — could cause unexpected motion during development/debug.
- Fix approach: Disable test pulse in production. Move to optional debug mode (compile flag or UART command).

### No Strapping Pin Conflict Documentation

**GPIO9 Strapping Pin Usage:**
- Files: `firmware/src/main.cpp` (line 42), `hardware/MowerBot-MotorController.kicad_sch` (line 306)
- Issue: Encoder R_B uses GPIO9, which is an **ESP32-C3 strapping pin** (strap_in3). Pull-down resistors are applied, but there's minimal documentation about potential boot conflicts.
- Impact: Encoder activity during boot could theoretically affect boot mode selection. Though unlikely (encoder inactive at startup), it's fragile.
- Fix approach: Add explicit note in firmware and schematic: "GPIO9 must stay LOW during boot. Verified safe with pull-down + encoder idle state."

### No Explicit Motor State Recovery

**Disconnected State Handling:**
- Files: `firmware/src/main.cpp` (lines 392-397)
- Issue: When agent disconnects, state machine destroys ROS entities and returns to WAITING_AGENT. No attempt to resume mid-motion or safe shutdown sequence.
- Impact: If ROS agent crashes mid-motion, motors stop immediately. Next reconnection will require explicit velocity command to restart. Risk of unexpected behavior if shutdown wasn't clean.
- Fix approach: Add graceful shutdown state with gradual deceleration ramp (1-2 second wind-down) instead of hard stop.

## Hardware Integration Concerns

### Current Sense Implementation Incomplete

**Missing Current Monitoring:**
- Files: `hardware/MowerBot-MotorController.kicad_sch` (lines 412-443)
- Issue: ADS1115 16-bit I2C ADC is designed into schematic but not populated. Resistor networks (R_sense 1.2kΩ) and filter capacitors (C_filter 10nF) marked as "TODO". Firmware has zero current-sense code.
- Impact: No way to detect motor stall, overload, or component failure. Violates safety assumptions (overcurrent shutdown mentioned in PCB docs but not implemented).
- Fix approach:
  1. Add R_sense (4x 1.2kΩ 0805 SMD) to BTS7960 current-sense outputs (J2/J3 pins 5-6)
  2. Add C_filter (4x 10nF 0805 SMD) anti-alias filters
  3. Populate ADS1115 breakout module (already in library, `hardware/MowerBot.kicad_sym`)
  4. Implement Pi-side current monitoring code (ROS topic `/motor_currents`)
  5. Add firmware soft-limit: if any motor draws >20A sustained, shut down motors and alert Pi

### Shared I2C Bus Not Explicitly Managed

**I2C Contention Risk:**
- Files: `hardware/MowerBot-MotorController.kicad_sch` (lines 275-290, 333-338)
- Issue: MPU6050 accelerometer (U2) and future ADS1115 ADC both on **Raspberry Pi I2C1 bus** (GPIO2/3). No pull-up specifications, no address conflict analysis documented.
- Known addresses: MPU6050 = 0x68 (with AD0=GND), ADS1115 = 0x48 (default). No conflict, but bus clock speed and pull-up value not specified.
- Impact: If either device behaves poorly (floating pins, slow response), I2C deadlock could prevent Pi from communicating with both sensors. No firmware-level isolation or retry logic.
- Fix approach:
  1. Document Pi I2C clock speed requirement (100kHz standard should work)
  2. Verify pull-up resistors on Pi side (typically 4.7kΩ, built into Pi)
  3. Add I2C bus monitor code on Pi: detect stalls, implement recovery/reset protocol
  4. Firmware: add I2C address scanning at startup to validate sensor presence

### UART Framing Assumptions

**Serial Configuration Loose:**
- Files: `firmware/src/main.cpp` (line 345)
- Issue: UART configured as 115200 8N1 (8 bits, no parity, 1 stop). micro-ROS transport layer (`set_microros_serial_transports(Serial1)`) relies on framing. No explicit flow control (RTS/CTS) defined.
- Impact: If Pi and ESP32 UART buffers drift or packet corruption occurs, ROS message framing could break silently. No explicit packet boundary detection or error recovery.
- Fix approach:
  1. Add hardware flow control signals (RTS/CTS) if available on Pi HAT PCB
  2. Implement ROS packet timeout/retry logic in micro-ROS agent
  3. Add UART parity checking (8E1 or 8O1) for higher reliability
  4. Document baud rate tolerance: verify both Pi serial driver and ESP32 actual frequency match spec

### No Power Sequencing Definition

**Supply Startup Timing Undefined:**
- Files: `hardware/MowerBot-MotorController.kicad_sch` (lines 52-82)
- Issue: Three power rails: 12V (from battery), 5V (MINI560 step-down), 3.3V (ESP32-C3 internal). No power-on sequencing spec — MINI560 enable pin not controlled (default ON). Capacitors C1, C2, C3 marked TODO in schematic.
- Impact: 
  - If 5V power glitches, motor PWM could enter undefined state
  - 3.3V droop during motor startup could cause ESP32 brown-out
  - No inrush current limiting on 12V input
- Fix approach:
  1. Measure actual MINI560 output with worst-case 12V (10-14V) input under max current (motors + Pi + ESP32)
  2. Calculate and verify C2 (output smoothing) value: target <50mV ripple at 5A load
  3. Add TVS diode or inrush limiter on 12V input (J6)
  4. Verify ESP32 brownout reset threshold aligns with 3.3V worst-case

## Testing & Verification Gaps

### No Motor Characterization Data

**Missing Performance Baseline:**
- Files: `firmware/src/main.cpp` (lines 75-79)
- Parameters hardcoded: MAX_SPEED=0.28 m/s, ENCODER_TICKS_REV=11, WHEEL_DIAMETER=0.07m, WHEEL_SEPARATION=0.20m
- Issue: No documented testing confirming actual motor speed, encoder tick accuracy, or wheel geometry under load
- Impact: Kinematic commands may be inaccurate if actual hardware differs. Encoder counts could drift if ticks-per-rev is wrong.
- Fix approach: Measure actual RPM, encoder ticks, wheel diameter on assembled robot. Update firmware constants. Document test procedure.

### Encoder Direction Not Verified

**Quadrature Encoding Assumption:**
- Files: `firmware/src/main.cpp` (lines 146-154)
- Issue: ISR only counts RISING edge on channel A, checks B direction. No validation that encoder wiring is correct phase (A leads B for forward).
- Impact: Reversed encoder wires would cause odometry to run backwards undetected
- Fix approach: Add self-test in firmware: drive forward 1m, verify encoder counts are positive. Log warning if reversed detected.

### No End-to-End Integration Test

**Hardware-Firmware-ROS Loop Not Verified:**
- No documented integration test verifying:
  1. Pi sends cmd_vel → ESP32 receives and executes → motors move
  2. Encoder feedback → ESP32 publishes odometry → Pi receives
  3. Timeout triggers watchdog → motors stop
  4. I2C sensor reads return valid data
- Fix approach: Write integration test script (ROS2 node + shell script) that validates entire control loop before deployment.

## Missing Pieces

### Emergency Stop Circuit

**No Hardware E-Stop:**
- Issue: Firmware watchdog depends on software timeout. If both UART and ROS hang, motors keep running.
- Fix: Add hardwired E-stop circuit: latching relay or manual kill switch that directly disables BTS7960 enable pins independent of firmware.

### Current Sense (Partially Designed, Not Integrated)

**Designed but Unpopulated:**
- Files: `hardware/MowerBot-MotorController.kicad_sch` lines 412-443
- ADS1115 ADC and passive components ready in design, but missing from firmware and not populated on PCB
- Priority: **High** — blocking overload protection

### Thermal Management

**No Heatsink or Thermal Analysis:**
- BTS7960 modules rated for continuous 30A but dissipate power as I²R heat
- At 10A sustained with motor stall risk, thermal runaway possible without airflow
- No thermal shutdown, temperature monitoring, or dissipation strategy documented

## Documented TODOs in Code

**From `docs/pcb-motor-controller.md`:**

| Line | TODO Item | Status |
|------|-----------|--------|
| 63   | C1: 100uF/50V input cap placement | Design incomplete |
| 72-73| C2/C3: output caps and filter placement | Design incomplete |
| 421  | ADS1115 schematic integration | Designed but not schematized |
| 422  | R_sense resistors (current sense) | TODO |
| 423  | C_filter capacitors (anti-alias) | TODO |

**From `docs/` directory:**
- `docs/troubleshooting.md`: "TODO: Häufige Probleme und Lösungen" (Common problems doc not started)
- `docs/setup-guide.md`: "TODO: Vollständige Installationsanleitung" (Setup guide skeleton only)
- `docs/hardware.md`: "TODO: Hardwareliste und Verkabelung" (Hardware list/wiring guide not started)

## Fragile Areas

### Boot Sequence Race Condition

**Potential Issue:**
- Files: `firmware/src/main.cpp` (lines 271-349)
- Setup runs motor test pulse *before* waiting for ROS agent connection
- If Pi boots faster than ESP32 and sends cmd_vel before agent state machine reaches AGENT_CONNECTED, command may be dropped
- Fix: Delay motor test until agent detected, or add command queue during setup phase

### Soft-Reset vs Hard-Reset Ambiguity

**Issue:**
- No distinction between firmware reset (watchdog timeout) and deliberate stop
- If motor watchdog triggers, LED goes GREEN (idle state) but it's unclear if this is intentional idle or timeout shutdown
- Fix: Use distinct LED color for watchdog timeout (e.g., ORANGE blink pattern) vs idle (solid GREEN)

### Encoder Interrupt Overflow

**Issue:**
- Files: `firmware/src/main.cpp` (lines 110-112, 146-154)
- `encoder_*_count` are 32-bit `long`. At 11 ticks/rev and ~76 RPM, encoder accumulates ~14 ticks/second
- 32-bit signed long rolls over after ~5 years of continuous running (not an immediate issue but edge case)
- Fix: Use 64-bit accumulator or implement position reset/wrap-around logic if robot runs continuously

---

*Concerns audit: 2026-04-14*
