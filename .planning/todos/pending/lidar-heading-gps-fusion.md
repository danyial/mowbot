---
title: Use LiDAR-derived heading to improve GPS pose fusion
area: ros2 + localization
created: 2026-04-15
source: post-phase-4 user feedback
priority: medium
related: Phase 4 (slam_toolbox), HW-04 (firmware /odom), EKF config
---

# LiDAR heading → GPS pose fusion

User observation: "Durch den LiDAR Sensor weiß der Roboter ja zu jeder Zeit, wo vorne ist. Das soll auf jeden Fall berücksichtigt werden, wenn es um die GPS Position geht."

Right now the mower's heading comes entirely from IMU (MPU6050, yaw drifts badly at rest — EKF covariance 2.6e10 within minutes of standing still). GPS gives position but no orientation on a stationary vehicle. LiDAR + SLAM, once stable, delivers a continuous and consistent world-frame heading via scan-matching — this is a much better heading source than the IMU for pose fusion.

## What's already there

- `ldlidar_stl_ros2` publishes `/scan` at 10 Hz (Phase 2)
- `slam_toolbox` publishes `map → odom` TF and an internal pose estimate (Phase 4)
- `robot_localization` EKF publishes `/odometry/filtered` consuming IMU + (eventually) wheel odom
- UM980 RTK-GNSS publishes `/fix` + `/navsat_transform_node` converts to odom

## What's missing

- slam_toolbox's pose is NOT fed into the EKF as a yaw source. Today's EKF config in `config/ekf.yaml` takes IMU orientation (which drifts) and whatever wheel odom is available. No SLAM input.
- `/navsat_transform_node` uses IMU heading to compute the world-frame offset between the GPS fix and the robot's forward direction. If the IMU is drifted, the GPS position on the map is rotated wrong relative to the robot's true facing.

## Proposed work

1. **Short term (once Phase 4 stabilizes):**
   - slam_toolbox can publish its pose estimate as `nav_msgs/Odometry` on `/slam_toolbox/pose` or similar (check config options `publish_pose`, `odom_topic`). Feed this into `robot_localization` EKF as a yaw source with high weight.
   - Result: EKF's yaw becomes stable (scan-matched) instead of IMU-drift-dominated. `/navsat_transform` then computes GPS→odom offset with the correct heading.

2. **Medium term:**
   - When firmware `/odom` (HW-04 todo) ships, EKF gets a real velocity signal too. Full sensor fusion: wheel odom (velocity) + IMU (short-term rotation) + SLAM (long-term heading correction) + GPS (absolute position). This is the textbook Nav2-ready stack.

3. **Long term:**
   - Use SLAM pose as primary input to `/navsat_transform`'s heading argument. GPS then "anchors" the SLAM map to real-world coordinates (Nav2 GPS-aided navigation tutorial).

## Preconditions

- Phase 4 slam_toolbox must be producing stable pose estimates — currently not the case indoors while stationary (thresholds not triggered, EKF drift propagates).
- Fix 4's `mapToBaseLinkYaw` wildness (seen in scan-rotation bug) needs to be resolved first — either via firmware `/odom` landing (so EKF has velocity and doesn't drift) OR via slam_toolbox feeding its pose back into EKF (this todo).

## References

- `config/ekf.yaml` — EKF sensor input config
- `config/nav2_params.yaml` — nav stack
- `docker/nav/` — nav container launch
- `.planning/phases/04-live-mapping-slam-toolbox/04-02-SUMMARY.md` — current SLAM state
- `.planning/todos/pending/5v-rail-transient-measurement.md` Part A — firmware `/odom` gate
- ROS2 robot_localization cookbook — multi-source EKF examples
- Nav2 GPS-aided navigation tutorial

## Known risks

- Loop opens: SLAM informs EKF informs slam_toolbox's TF prior. Need careful weight tuning to avoid feedback oscillation. Start with low-weight SLAM input, bump up after stability confirmed.
- Indoor vs outdoor: LD19 max ~12 m range — outdoors on an open lawn with no walls, scan-matching has nothing to lock onto. SLAM-derived heading fails outdoors unless GPS dominates. Scope likely "indoor mapping + heading correction" for v1, outdoor stays IMU + RTK-GNSS.
