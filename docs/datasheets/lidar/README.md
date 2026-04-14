# LD19 / STL-19P LiDAR — Official Vendor Docs

Source: Shenzhen LDROBOT Co., Ltd. Supplied by user 2026-04-14.

The LD19 and STL-19P share the same protocol and interface. The STL-19P is the
industrial/branded variant of the LD19 — these manuals are interchangeable for
our purposes.

## Files

- **`LD19-Development-Manual-V2.3.pdf`** — Protocol-of-record. Packet format
  (0x54 header, VerLen 0x2C = 12 points/packet), CRC8 table, coordinate system,
  ROS/ROS2 driver repos, udev/permission notes.
- **`D500-STL-19P-Datasheet.pdf`** — Electrical + mechanical parameters. Use for
  wiring, power-budget, and mechanical-mount decisions.

## Key facts downstream agents must honor

### Electrical / communication
- **UART:** 230400 baud, 8N1, **one-way** (sensor → host, no commands accepted).
- **Connector:** ZH1.5T-4P 1.5mm. Pinout (pin 1 → 4): **Tx, PWM, GND, P5V**.
- **Power:** 5V nominal (4.5–5.5V), ~290mA working current, TBD inrush.
- **PWM pin MUST be grounded when external speed control is not used** — otherwise
  the motor will not spin in internal-speed mode. This is not optional.
- **Logic levels:** 3.3V (typical) for Tx and PWM — directly compatible with
  Raspberry Pi 4 GPIO. No level shifter needed.
- **External speed control (optional):** PWM 20–50 kHz (30 kHz recommended),
  duty cycle outside (45%, 55%) for ≥100 ms to enter external mode. Once
  entered, stays until power-cycle.

### Protocol (LD19 Manual §3)
- Packet: `0x54` header + `0x2C` VerLen + 2B speed (deg/s) + 2B start_angle
  (0.01°) + 12 × {2B distance (mm) + 1B intensity} + 2B end_angle + 2B timestamp
  (ms, wraps at 30000) + 1B CRC8.
- Per-point angle = start + i × (end − start) / (len − 1).
- Intensity ≈ 200 for white target within 6 m.
- Timestamp wraps at 30000 ms — driver must handle.

### Mechanical / environmental (STL-19P Datasheet §4, §5)
- **Dimensions:** 54.00 × 46.29 × 35.0 mm (L × W × H). Mounting: 3 × M2.5 holes.
- **Weight:** 45 g without cable.
- **Ranging:** 0.03–12 m (white 80% reflectivity), 0.03–8 m (black 4%).
- **Accuracy:** ±10 mm @ 0.03–0.5 m; ±20 mm @ 0.5–2 m; ±30 mm @ 2–12 m.
- **Scan rate:** 10 Hz default (internal PID); externally 6–13 Hz via PWM.
- **Angular resolution:** 0.72° @ 10 Hz.
- **Environmental:** −10 °C to +45 °C operating, **IP5X (dust only — NOT water-resistant)**.
- **Laser safety:** Class 1 (IEC 60825), 895–915 nm infrared.

### Coordinate system
- LD19 uses **left-handed / clockwise** convention (front of sensor = 0°, angle
  increases CW). The official `ldlidar_stl_ros2` driver transforms to ROS2's
  right-handed / CCW convention before publishing `sensor_msgs/LaserScan` —
  downstream code should consume the ROS2 convention, not the raw packet one.

### Driver
- Upstream: <https://github.com/ldrobotSensorTeam/ldlidar_stl_ros2> (ROS2).
- Repo also ships the bare-metal SDK (`ldlidar_stl_sdk`) and ROS1 variant.
- Pin driver by commit SHA (per PROJECT.md "pin by SHA" decision).

### Flags for Phase 1 (brownfield planning)
- **IP5X is a real concern** for outdoor lawn-mower use. Plan for a weather
  shroud, a pop-up bay, or a "no-mow in rain" rule. Do NOT assume the sensor
  survives wet grass/dew/rain unprotected.
- **Inrush current** on motor startup is listed as TBD — measure in Phase 1 when
  sizing the 5V rail (per ROADMAP success criterion 5: ≥ 4.85 V under transient).
- No USB anywhere in the native connector — this is a bare UART + 5V sensor. The
  CP2102 adapter shown in the manual is a dev-kit accessory only; our design
  wires the 4-pin JST directly to Pi GPIO + 5V rail.
