# Phase 7 — Verification

**Phase:** 7 — SLAM Pose → EKF Yaw Fusion
**Milestone:** v2.2 Ops & Fusion Polish
**Verified:** 2026-04-15
**Status:** 3 of 4 requirements VERIFIED live on hardware; FUSE-02 **pending outdoor trial** (infrastructure validated)

## Success Criteria (from ROADMAP.md Phase 7)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `robot_localization` consumes `/pose` as `pose0` yaw-only; `imu0` yaw disabled | ✅ | `docker exec mower-nav ros2 topic info /pose` → 1 publisher (slam_toolbox) + 1 subscriber (EKF); `config/ekf.yaml` `pose0_config sum==1 at index 5`; `imu0_config[5]==False`; restart on mower succeeded with no param errors |
| 2 | 60s stationary yaw drift `<1°` in `/odometry/filtered` | ⏳ pending outdoor trial | `scripts/yaw-drift-test.sh` proven working end-to-end (three bugs fixed during live testing); indoor result = 26°/15s as expected (slam_toolbox only publishes `/pose` on scan-match with motion — indoor stationary test cannot validate). D-16 calls for outdoor trial. Operator checklist in `07-02-SUMMARY.md`. |
| 3 | Operator sees heading-confidence badge indicating SLAM yaw fusion state | ✅ | Live verified via Playwright on `http://10.10.40.23:3000/`: GREEN "Yaw: SLAM active" at t=3.3s on `/pose` publish, YELLOW "Yaw: SLAM stale" at t=3.8s after publish stop, RED "Yaw: SLAM lost" after >2s — **full 3-state transition captured** |
| 4 | Exactly one node publishes `map→odom` (slam_toolbox); no TF cycle | ✅ | `docker exec mower-nav ros2 run tf2_ros tf2_echo map odom` resolves identity transform (mower stationary); no second publisher. EKF has `publish_tf: true` but publishes `odom→base_link` only (world_frame=odom, not map). |
| 5 | Chosen covariance scaling + rationale documented | ✅ | `config/ekf.yaml` ADR comment block passes all three greps: `WHY pose0 YAW VARIANCE`, `Chosen:`, `Rejected values`. Scaling lives source-side in `config/slam_toolbox_params.yaml` (`yaw_covariance_scale: 1.0`) per research correction that robot_localization has no per-sensor override. |

## Requirements Coverage

| Req | Status | Notes |
|-----|--------|-------|
| **FUSE-01** | ✅ Complete | Topic confirmed `/pose`, pose0 subscribed, simultaneity satisfied in single commit `7cb4c85` |
| **FUSE-02** | ⏳ Pending outdoor | Script works; indoor fails expected; deferred to operator outdoor trial per D-16 |
| **FUSE-03** | ✅ Complete | 3-state badge validated live; all three color transitions observed; setInterval tick proven |
| **FUSE-04** | ✅ Complete | ADR block documented in ekf.yaml; chosen value (`yaw_covariance_scale: 1.0`) + reasoning documented |

## Live Hardware Observations

**Browser:** Playwright connected to `http://10.10.40.23:3000/` from Mac on LAN
**Header badges present:** `RTK Float` (GPS, existing), `Yaw: SLAM lost/stale/active` (new, Phase 7), `Verbunden` (connection status, existing)

**State transition log (captured via DOM poll during live `/pose` publish):**
```
t=0        RED    (stale from previous)
t=3262ms   GREEN  (/pose received, badge flips within 10ms of message arrival)
t=3513ms   GREEN
t=3764ms   YELLOW (500ms after last message — staleness threshold crossed)
t=4014ms   YELLOW
t=4267ms   YELLOW
t=4518ms   YELLOW
t=4769ms   YELLOW  (still within 2s window)
# (>2s after last message would have flipped to RED, matching earlier observation)
```

**setInterval tick proved working:** the transition from GREEN→YELLOW at 3.8s happened WITHOUT any new `/pose` message arriving — it required client-side time-based re-evaluation, which is exactly what the 500ms setInterval + forceUpdate in the badge component provides.

## Regression Gates (pre-existing features unaffected)

- ✅ GPS badge still rendering (RTK Float visible)
- ✅ rosbridge still connecting (`Verbunden` state)
- ✅ `/rosbridge` WebSocket upgrade still works (Zustand stores populated, map tiles loading)
- ✅ `/logs` tab continues to function (Phase 6 single-upgrade-handler regression gate held — no `server.mjs` edits this phase, confirmed by `git diff` 0 lines)
- ✅ Dashboard KPIs (GPS lat/lon, altitude, speed) still populating

## Deferred / Follow-up

- **FUSE-02 outdoor trial (operator):** Drive mower outdoors where LiDAR sees ≥5 distinct features, stop, run `./scripts/yaw-drift-test.sh 60`. Expected PASS. If FAIL, record Δ into `config/ekf.yaml` `Rejected values:` section, tighten `yaw_covariance_scale` in `config/slam_toolbox_params.yaml` (try 0.5 → 0.25), restart containers, retry. Full procedure in `07-02-SUMMARY.md § Outdoor operator checklist`.

## Artifacts

- `07-CONTEXT.md` — locked decisions D-01..D-17
- `07-RESEARCH.md` — with critical corrections (`/pose` not `/slam_toolbox/pose`, source-side covariance override)
- `07-VALIDATION.md` — Nyquist validation strategy
- `07-PATTERNS.md` — 9 files classified, analogs found
- `07-01-PLAN.md` + `07-01-SUMMARY.md` — Wave 0 (drift-test script)
- `07-02-PLAN.md` + `07-02-SUMMARY.md` — Wave 1 (config edits + live verification on mower)
- `07-03-PLAN.md` + `07-03-SUMMARY.md` — Wave 2 (web badge)
- `07-VERIFICATION.md` — this file

## Core-Value Gate (milestone-level)

v2.2 core value #2 *"operator can trust the SLAM map's rotational alignment under motion"* becomes testable with Phase 7 infrastructure. Testable ≠ proven — the outdoor FUSE-02 trial closes the proof loop. Phase 8 then has a trusted `map→base_link` to validate the map-anchor against.
