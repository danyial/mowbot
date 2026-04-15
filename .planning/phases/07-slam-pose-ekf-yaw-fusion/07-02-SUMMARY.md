# Plan 07-02 — Execution Summary

**Status:** Configs deployed + EKF subscribed to `/pose`; FUSE-02 outdoor drift PASS **pending operator**.
**Wave:** 1
**Executed:** 2026-04-15

## What was built

### Config edits (committed + deployed)

- `config/ekf.yaml` — added `pose0: /pose` block with yaw-only `pose0_config` (index 5 only, sum=1), `pose0_differential: false`, `pose0_queue_size: 5`. Large inline ADR block at top documents:
  - Why pose0 yaw variance is NOT set in this file (robot_localization has no per-sensor override — source-side scaling)
  - Why `imu0_config[5]` stays false (avoid correlated-input divergence)
  - Why `imu0_config[11]` (yaw_vel) stays true (direct gyro, orthogonal to SLAM pose-based yaw)
  - Chosen value + rejected values section (FUSE-04)

- `config/slam_toolbox_params.yaml` — added `position_covariance_scale: 1.0` and `yaw_covariance_scale: 1.0` (conservative neutral start per CONTEXT.md D-05).

### Script fixes (Wave 0 follow-up)

Three bugs surfaced in `scripts/yaw-drift-test.sh` during live testing on the mower, all fixed:
1. Precondition `ros2 topic list` didn't source `/opt/ros/humble/setup.bash` — fixed (commit `c24af66`)
2. `tf_transformations` module not installed in `mower-nav` — switched to inline `math.atan2` (commit `fce9396`)
3. `ros2 topic echo --once` emits multi-doc YAML — switched to `safe_load_all` (commit `bf9fdf1`)

## Preflight results (live on mower 10.10.40.23)

| Check | Result |
|---|---|
| Topic name | `/pose` (not `/slam_toolbox/pose`) ✅ matches RESEARCH correction |
| Message type | `geometry_msgs/msg/PoseWithCovarianceStamped` ✅ |
| `/pose` native covariance magnitude | **Uncapturable while stationary** — slam_toolbox only publishes `/pose` on successful scan-match after motion delta. Documented in ekf.yaml ADR block. |
| Post-restart EKF health | `/odometry/filtered` @ 30.07 Hz, 31-sample window std 0.00142 s ✅ |
| `/pose` pub/sub count post-restart | 1 publisher (slam_toolbox) + 1 subscriber (EKF) ✅ — confirms `pose0: /pose` accepted |
| EKF parameter-load errors | None ✅ |
| slam_toolbox parameter-load errors | None ✅ (yaw_covariance_scale / position_covariance_scale accepted) |

## Drift test result (indoor stationary — 15 s)

```
Δyaw = 26.46° over 15s — FAIL (<1°)
```

**Why this is expected and not a FUSE-02 failure yet:**

- Mower is indoors, stationary, scan-queue saturation evident in slam logs (TF buffer polluted by navsat `utm` NaN quaternions from GPS init).
- slam_toolbox does NOT publish `/pose` on a timer — it publishes only after a successful scan-match, which requires both (a) motion ≥ `minimum_travel_distance: 0.1` m or `minimum_travel_heading: 0.1` rad, and (b) unsaturated scan queue.
- With `/pose` silent, `pose0` sensor receives zero updates, so EKF coasts on `imu0` `yaw_vel` (gyro only). A cheap MPU-6050 gyro drifts ~1–2 °/s at rest → 26° in 15s is consistent.
- **The plan anticipated this** (CONTEXT.md D-16 explicitly says "outdoor single trial with mower stationary on ground, LiDAR actively seeing walls, SLAM running").

**FUSE-02 acceptance test is deferred to an outdoor run** with the mower powered on the ground, GPS fix acquired cleanly, and slam_toolbox actively scan-matching. The script + infra work; only the environmental precondition is missing.

## Wave 1 requirement coverage

| Req | Status | Evidence |
|-----|--------|----------|
| FUSE-01 | ✅ **COMPLETE** | `pose0: /pose` landed in ekf.yaml with yaw-only config; `imu0_config[5]=False` reaffirmed; 1-pub/1-sub confirmed on live `/pose`; simultaneity satisfied (single commit `7cb4c85`) |
| FUSE-02 | ⏳ **Pending outdoor trial** | Script works end-to-end; indoor test FAILed as expected (26° — gyro drift without /pose updates); infrastructure ready |
| FUSE-04 | ✅ **COMPLETE** | ADR block in ekf.yaml passes all greps: `WHY pose0 YAW VARIANCE`, `Chosen:`, `Rejected values`; rationale documents chosen 1.0 + reason native covariance wasn't capturable |

## Validation assertions (all PASS)

```
python3 -c "import yaml; p=yaml.safe_load(open('config/ekf.yaml'))['ekf_filter_node']['ros__parameters']; \
  assert p['pose0']=='/pose'; assert sum(p['pose0_config'])==1; assert p['pose0_config'][5]==True; \
  assert p['imu0_config'][5]==False; assert p['imu0_config'][11]==True"
# → OK

grep -q 'WHY pose0 YAW VARIANCE' config/ekf.yaml  # PASS
grep -q 'Chosen:' config/ekf.yaml                  # PASS
grep -q 'Rejected values' config/ekf.yaml          # PASS
```

## Commits

- `7cb4c85` — `feat(07-02): FUSE-01/04 — add /pose yaw-only pose0 to EKF + yaw_covariance_scale in slam params`
- `c24af66` — `fix(07-01): source ROS setup in yaw-drift-test.sh precondition check`
- `fce9396` — `fix(07-01): inline atan2 quaternion->yaw — tf_transformations not installed in nav container`
- `bf9fdf1` — `fix(07-01): parse multi-doc YAML from ros2 topic echo --once`

## Outdoor operator checklist (for FUSE-02 sign-off)

1. `ssh pi@mower.local` (or 10.10.40.23)
2. Wheel mower outdoors where LiDAR can see ≥5 walls/tree-trunks/distinct features
3. `cd ~/mowbot && docker compose up -d` (or wait for autostart)
4. Verify GPS RTK fix healthy (browser `/` → GPS badge green; avoids utm NaN polluting TF)
5. Drive the mower ~1 m in a straight line, stop → this triggers slam_toolbox's first `/pose` publish
6. Confirm /pose is now live: `docker exec mower-nav bash -c 'source /opt/ros/humble/setup.bash && ros2 topic hz /pose'` → should see >0 Hz
7. `./scripts/yaw-drift-test.sh 60` — mower stationary for 60s
8. Expected: `Δyaw = X.XX° over 60s — PASS` (<1°)
9. If FAIL: record `Δ` into ekf.yaml's `Rejected values:` section, tighten `yaw_covariance_scale` in slam_toolbox_params.yaml (try 0.5, 0.25), `docker compose restart slam nav`, retry

## Next

Wave 2 (Plan 03) is safe to start — its work (`/pose` subscription, Zustand store, badge) does NOT depend on the outdoor drift PASS. The badge will render correctly as soon as slam_toolbox publishes /pose (which it will whenever the mower moves).
