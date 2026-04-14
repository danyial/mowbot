# LiDAR Mount — `base_link → laser_frame` Reference

This document captures the conventions, measurement procedure, and angle-crop
procedure needed to commit real values into
[`docker/lidar/launch/lidar.launch.py`](../docker/lidar/launch/lidar.launch.py)
once the LD19 is physically mounted on the robot chassis. Phase 2 ships with
zero placeholders per CONTEXT §D-05/D-07; this doc is the handoff for the
physical-mount day.

---

## 1. Reference frames (REP-103 / REP-105)

### `base_link` origin

`base_link` is the primary robot body frame. Its origin is defined as the
**midpoint between the two drive-wheel contact patches, at ground level**
(REP-105 convention). Axes follow REP-103:

- **+x** → forward (direction of travel at positive linear velocity)
- **+y** → left (robot's left side when looking forward)
- **+z** → up (away from ground)
- Rotations: right-hand rule around each axis (yaw around z, pitch around y,
  roll around x).

### Wheel geometry (from `config/robot.yaml`)

| Parameter | Value | Source |
|-----------|-------|--------|
| `wheel_separation` | 0.20 m | `config/robot.yaml` line 8 |
| `wheel_diameter` | 0.07 m | `config/robot.yaml` line 9 |
| `wheel_radius` | 0.035 m | `config/robot.yaml` line 10 |

The `base_link` origin sits **halfway between** the two wheel contact
points (so ±0.10 m in y from each wheel), **at ground level** (z = 0, i.e.
0.035 m below the wheel axle).

### `laser_frame`

`laser_frame` is the LD19's own measurement frame. The driver (`ldlidar_stl_ros2`)
is configured with `laser_scan_dir: True`, which **flips the raw clockwise
sensor rotation to REP-103's counter-clockwise (CCW) convention** — so
`angle_min=0`, `angle_increment > 0` maps to REP-103 CCW angles in the
`laser_frame`.

Origin of `laser_frame` = geometric centre of the LD19's rotating mirror
(≈ middle of the sensor housing; see LDROBOT D500-STL-19P datasheet §5.5).

---

## 2. Measuring the static transform

The `base_link → laser_frame` static TF is published by
`static_transform_publisher` in
[`docker/lidar/launch/lidar.launch.py`](../docker/lidar/launch/lidar.launch.py).
The `arguments=` list must hold six measured values plus the two frame
names:

```python
arguments=['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'base_link', 'laser_frame']
```

### Measurement table

| Axis  | Units   | Tool              | Tolerance |
|-------|---------|-------------------|-----------|
| x     | metres  | tape / calipers   | ±5 mm     |
| y     | metres  | tape / calipers   | ±5 mm     |
| z     | metres  | tape / calipers   | ±5 mm     |
| yaw   | radians | digital protractor| ±2°       |
| pitch | radians | digital protractor| ±2°       |
| roll  | radians | digital protractor| ±2°       |

Notes:
- **x**: forward offset of the LD19 housing centre from `base_link` origin
  (positive if the LiDAR is ahead of the wheel axle).
- **y**: left offset (positive if the LD19 is offset to the robot's left).
- **z**: height of the LD19's rotating mirror centre above the ground plane.
  Typical mount: `z ≈ chassis_height + housing_half_height`.
- **yaw**: rotation around +z. `yaw = 0` means the LD19's cable exits
  **toward the rear** of the robot (−x) per datasheet §5.5. If the cable
  exits forward, `yaw = π`.
- **pitch** / **roll**: zero if the LD19 is level; measure with a digital
  angle gauge placed on the housing top.

Convert degrees to radians before committing: `rad = deg × (π / 180)`.

---

## 3. Committing the values

1. Edit
   [`docker/lidar/launch/lidar.launch.py`](../docker/lidar/launch/lidar.launch.py)
   — replace the six `'0'` placeholders in the `static_transform_publisher`
   `arguments=` list with the measured values (as Python strings).
2. Remove the `TODO(lidar-mount):` comment block above the TF node.
3. Rebuild and redeploy the lidar service on the Pi:
   ```bash
   scp docker/lidar/launch/lidar.launch.py pi@mower.local:~/mowbot/docker/lidar/launch/
   ssh pi@mower.local 'cd ~/mowbot && docker compose build lidar && docker compose up -d lidar'
   ```
4. Verify:
   ```bash
   docker exec mower-nav bash -lc 'source /opt/ros/humble/setup.bash && \
     ros2 run tf2_ros tf2_echo base_link laser_frame'
   ```
   The reported translation/rotation should match the measured values.

### As-measured values

| Date       | x (m) | y (m) | z (m) | yaw (rad) | pitch (rad) | roll (rad) | Measured by |
|------------|-------|-------|-------|-----------|-------------|------------|-------------|
| _TBD_      | _TBD_ | _TBD_ | _TBD_ | _TBD_     | _TBD_       | _TBD_      | _TBD_       |

Phase 2 ships with zero placeholders (identity TF) per CONTEXT §D-05/D-07.
Real values measured on physical-mount day.

---

## 4. Self-hit angle crop

The LD19 sweeps 360° and will see the robot's own chassis (wheels, mast,
battery box, …) at fixed angular sectors. These self-hits must be cropped
to prevent the planner and costmap from treating chassis edges as
obstacles.

The driver exposes three relevant parameters in
[`docker/lidar/launch/lidar.launch.py`](../docker/lidar/launch/lidar.launch.py):

```python
{'enable_angle_crop_func': False},
{'angle_crop_min': 135.0},
{'angle_crop_max': 225.0},
```

Phase 2 ships with `enable_angle_crop_func: False` (full 360° publication)
per CONTEXT §D-08 so we can characterize self-hits in-situ before masking.

### Procedure to characterize and apply the crop

1. **Park the robot in a clear indoor space** (≥ 2 m clearance in every
   direction).
2. Run the service and dump a full scan:
   ```bash
   docker exec mower-nav bash -lc 'source /opt/ros/humble/setup.bash && \
     ros2 topic echo /scan --once' > /tmp/scan.yaml
   ```
3. Walk around the robot and note angular sectors where ranges come back
   consistently low (< 0.3 m) — these are chassis self-hits.
4. Convert sector bounds from bin index → degrees:
   ```
   angle_deg = (bin_index × angle_increment + angle_min) × (180 / π)
   ```
   (`angle_min`, `angle_increment` are fields in the LaserScan header.)
5. **Unit caveat** — `angle_crop_min` / `angle_crop_max` are specified in
   **degrees, in the driver's internal frame after the `laser_scan_dir`
   flip**. This is the non-obvious bit: the launch-file values (135.0,
   225.0) are driver-internal degrees, NOT `laser_frame` radians. Use
   degrees. Verify after each change with `ros2 topic echo /scan --once`
   and confirm the cropped sector returns `inf` or `nan` as expected.
6. Commit and redeploy: edit `lidar.launch.py`, set
   `enable_angle_crop_func: True`, update `angle_crop_min` / `angle_crop_max`,
   rebuild and bring the lidar service up.

### Sample self-hit log

| Date       | min_deg | max_deg | Reason               | Measured by |
|------------|---------|---------|----------------------|-------------|
| _TBD_      | _TBD_   | _TBD_   | _TBD_                | _TBD_       |

---

## References

- REP-103: Standard Units of Measure and Coordinate Conventions
- REP-105: Coordinate Frames for Mobile Platforms
- LDROBOT D500-STL-19P datasheet §5.5 (cable exit + mechanical origin)
- `docker/lidar/launch/lidar.launch.py` (edit target)
- `config/robot.yaml` (wheel geometry)
