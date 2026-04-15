# Phase 7: SLAM Pose → EKF Yaw Fusion — CONTEXT

**Phase:** 7 — SLAM Pose → EKF Yaw Fusion
**Milestone:** v2.2 Ops & Fusion Polish
**Requirements:** FUSE-01, FUSE-02, FUSE-03, FUSE-04
**Gathered:** 2026-04-15
**Status:** Ready for research & planning

<domain>
## Phase Boundary

Make the robot's fused yaw (`/odometry/filtered`) trustworthy at rest and under motion. The EKF (`robot_localization`) consumes `/slam_toolbox/pose` as a **yaw-only** `pose0` input, simultaneously flipping `imu0`'s yaw-position index to `false` to avoid two correlated sources of absolute yaw. A web UI badge tells the operator whether SLAM-backed yaw fusion is live and healthy.

Map-anchor, persistence, and Eraser reset are Phase 8 — explicitly out of scope here.

</domain>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before researching or planning.**

- `.planning/PROJECT.md` — v2.2 milestone statement, stack constraints (ROS2 Humble, CycloneDDS, Next.js 16), trusted-LAN operating assumption
- `.planning/REQUIREMENTS.md` — FUSE-01..04 (acceptance criteria) + explicit Out-of-Scope (SLAM x/y → EKF would create TF cycle)
- `.planning/ROADMAP.md` §Phase 7 — five observable success criteria, hard dep relationship with Phase 8
- `.planning/STATE.md` §Key Decisions — locked choices from v2.1 retrospective: single-EKF yaw-only `pose0`, simultaneous `imu0` yaw flip, slam_toolbox sole owner of `map→odom`
- `config/ekf.yaml` — current EKF config; this phase **edits it in place** and documents chosen covariance + disabled-IMU rationale inline (satisfies FUSE-04)
- `config/mower_nav_launch.py` — launches ekf_filter_node + navsat_transform_node; no launch-file change expected this phase
- `.planning/phases/06-webui-container-logs-view/06-CONTEXT.md` — reference pattern for single-upgrade-handler in `web/server.mjs`; not directly edited but `/logs` will be used during bring-up debugging
- `web/components/GpsStatus.tsx` (existing GPS-fix badge) — canonical pattern for the 3-state dashboard header badge

`robot_localization` upstream docs ([wiki.ros.org/robot_localization](http://wiki.ros.org/robot_localization)) — the research agent should consult these directly for `pose0_config` semantics, covariance-override behavior, and `_differential` flag meaning.

No project-level ADRs exist; PROJECT.md + REQUIREMENTS.md + STATE.md are authoritative.

</canonical_refs>

<scope>
## In / Out of Scope

**In scope:**
- `config/ekf.yaml` edit: add `pose0: /slam_toolbox/pose`, set `pose0_config` with only the yaw index true, set `pose0_differential: false`, choose initial covariance scaling, document rationale inline
- `config/ekf.yaml` edit: flip `imu0_config` yaw-position index to `false` in the **same commit** as the `pose0` addition (FUSE-01 requires simultaneity)
- Keep `imu0` angular-velocity indices (`roll_vel`, `pitch_vel`, `yaw_vel`) at `true` — see decisions below
- New ROS subscription in web: `/slam_toolbox/pose` (message freshness + covariance trace drive badge)
- Web UI: 3-state heading-confidence badge in the dashboard header (visible on every page, same pattern as existing GPS-fix badge)
- Script: `scripts/yaw-drift-test.sh` — echoes `/odometry/filtered` for 60s, reports delta; result captured in VERIFICATION.md
- Verify exactly one node publishes `map→odom` (slam_toolbox); `ros2 run tf2_ros tf2_echo map odom` and `ros2 topic info /tf` sanity checks in VERIFICATION

**Out of scope (do NOT implement this phase):**
- SLAM x/y fusion into EKF — would create TF cycle (slam_toolbox publishes `map→odom`, EKF publishes `odom→base_link`)
- Dual-EKF refactor (separate odom-frame + map-frame filters) — only revisit if single-EKF yaw-only shows edge-case divergence in the field
- Supervisor/watchdog node to auto-re-enable `imu0` yaw when SLAM goes stale — deferred to future safety milestone
- Map-anchor rendering, localStorage persistence, Eraser reset — **Phase 8**
- Nav2 autonomous waypoint navigation — post-v2.2

</scope>

<decisions>
## Implementation Decisions

### Locked from prior context (carried forward, not re-litigated)

- **D-01:** Single odom-frame EKF. No dual-EKF refactor. (STATE.md)
- **D-02:** Yaw-only fusion of `/slam_toolbox/pose` — `pose0_config` has exactly one `true` (the yaw-position index); all other 15 indices are `false`. (FUSE-01, STATE.md)
- **D-03:** `imu0_config` yaw-position index is flipped from `true` to `false` in the **same commit** as adding `pose0`. No staged rollout. (FUSE-01, STATE.md)
- **D-04:** `slam_toolbox` remains the sole publisher of `map→odom`. EKF must not publish into the map frame. (ROADMAP Phase 7 success criterion 4, STATE.md)

### pose0 covariance & trust posture

- **D-05:** **Conservative start, then tune.** Hardcode `pose0` yaw variance at the loose end (starting point: ~0.05 rad² ≈ 13° std dev) via EKF's covariance-override mechanism. Do NOT trust whatever `/slam_toolbox/pose` publishes in its `Covariance` field unexamined — research agent must confirm what slam_toolbox actually publishes and whether it's meaningful; if it's near-zero (overconfident), the hardcoded override is load-bearing.
- **D-06:** **Tuning loop:** run the stationary test (D-13) once with the conservative value. If drift is already `<1°` with margin → ship as-is. If drift is `>1°` → tighten `pose0` yaw variance (smaller value = more trust in SLAM) and re-test. If drift is `<<1°` but yaw feels sluggish under motion → loosen IMU `yaw_vel` process noise or tighten `pose0`. Document the final value, the rejected values, and the reasoning in `config/ekf.yaml` comments — that documentation is what satisfies **FUSE-04**.
- **D-07:** Do NOT use aggressive initial variance (~0.001 rad²). If SLAM yaw has any bias during bring-up, the EKF will lock onto it and stationary-drift becomes misleading.

### IMU angular-velocity retention

- **D-08:** **Keep `imu0_config` yaw_vel = true** (as well as roll_vel, pitch_vel). The correlation concern that drove FUSE-01 is specifically about **two sources of absolute yaw position** (IMU integrated yaw vs SLAM pose yaw) — it does NOT apply to angular velocity, which is a direct gyro measurement orthogonal to pose-based yaw.
- **D-09:** Disabling `yaw_vel` would force yaw-rate estimation to come from finite-differencing `/slam_toolbox/pose` at ~10–20 Hz, which is noisier and slower. Not worth the purity.
- **D-10:** `config/ekf.yaml` comment block must state this rationale explicitly so a future reader doesn't "fix" it back to false in a misguided simplification pass. Part of FUSE-04 documentation.

### Heading-confidence badge — shape & location

- **D-11:** **3-state badge in the dashboard header.** Follows the existing GPS-fix badge pattern (`web/components/GpsStatus.tsx`). Label: "Yaw" with a colored dot + short status string.
  - **Green — "SLAM active":** `/slam_toolbox/pose` message received within the last **500 ms** AND pose covariance trace below a to-be-determined threshold (research agent determines what slam_toolbox publishes; if covariance is garbage, green just = fresh).
  - **Yellow — "SLAM stale":** last message 500 ms – 2 s ago OR covariance degraded (if meaningful).
  - **Red — "SLAM lost":** last message >2 s ago, OR topic never seen since page load.
- **D-12:** **Location: dashboard header** — visible on every page (dashboard, map, teleop, missions, settings, lidar, logs). Critical operator signal; should never require a page switch to check. Implemented once, consumed everywhere via a Zustand store (new `slam-pose-store.ts`, same pattern as `gps-store.ts` / `battery-store.ts`).

### Stale-SLAM fallback behavior

- **D-13:** **Badge red, no runtime config change.** Phase 7 ships zero runtime logic beyond the EKF param change + the web badge. If `/slam_toolbox/pose` stops publishing, the EKF coasts on `yaw_vel` (IMU gyro) and the badge turns red — operator sees it, acts accordingly (mower is dev-loop / teleop, not yet autonomous).
- **D-14:** No supervisor node, no dynamic param toggling, no auto-fallback to `imu0` yaw. That complexity belongs in the future safety-watchdog milestone, which is already tracked under `REQUIREMENTS.md § Future`. Note it in `<deferred>` below so it's not lost.

### Validation methodology (FUSE-02)

- **D-15:** **`scripts/yaw-drift-test.sh`** — small bash script that:
  1. Confirms `/odometry/filtered` is publishing (fail fast if not)
  2. `ros2 topic echo --once` at t=0 to capture starting yaw (parse quaternion → yaw via python one-liner or `ros2 topic echo --field ...`)
  3. Sleeps 60s
  4. Captures ending yaw
  5. Prints `Δyaw = X.XX° over 60s — PASS/FAIL (<1°)`
- **D-16:** **Single outdoor trial** with mower stationary on the ground, motors off, LiDAR actively seeing walls/features, SLAM running. That's representative of real operating conditions (unlike on-stand indoors where SLAM is often feature-starved). If the first trial shows `Δyaw < 0.5°` it's shipped; if it's between 0.5° and 1.0° planner should decide whether to re-run once for confidence.
- **D-17:** Script output pasted into `07-VERIFICATION.md`. The script itself is committed at `scripts/yaw-drift-test.sh` and becomes reusable for Phase 8 and any future regression.

### Claude's Discretion (planner may decide without re-asking)

- Exact initial numerical value of `pose0` yaw variance within the 0.02–0.1 rad² band
- Whether the badge covariance-trace threshold ships "wired up" or as a TODO (depends on what slam_toolbox actually publishes — research determines)
- Zustand store shape for `/slam_toolbox/pose` subscription (`slam-pose-store.ts` — freshness timestamp, last-pose, connection state)
- How the badge is rendered visually (icon choice from `lucide-react`, exact color tokens) — match the existing GPS badge aesthetic
- Whether the bash script uses `ros2 topic echo --field` or a python snippet for quaternion → yaw
- Structure of the FUSE-04 comment block in `ekf.yaml` (single heredoc vs inline per-line comments) — whichever is more readable

</decisions>

<specifics>
## Specific Ideas

- **Badge model:** existing `GpsStatus.tsx` — same color palette, same "dot + label" footprint, same header slot. Operator mental model: "yaw is the new fix."
- **FUSE-04 rationale style:** the `config/ekf.yaml` comment for disabled-IMU-yaw and chosen `pose0` covariance should read like an ADR — what was tried, what was rejected, why. A future contributor who doesn't know the v2.2 history should be able to read that comment and understand the decision.
- **Simultaneity non-negotiable:** the commit that adds `pose0` MUST also flip `imu0` yaw index. No intermediate "both enabled" state — that's the correlated-input divergence trap the FUSE requirements exist to prevent.
- **Phase 8 gate:** rotational correctness of the map-anchor in Phase 8 can only be validated against a trusted `map→base_link`. That means this phase's quality bar isn't "technically passes FUSE-02" — it's "yaw is actually trustworthy under motion." Plan accordingly.

</specifics>

<success_criteria>
## Success Criteria (from ROADMAP — all five must be observable)

1. `robot_localization` consumes `/slam_toolbox/pose` as `pose0` with yaw index only; `imu0` yaw-position index is `false`
2. 60s stationary test on real hardware → `<1°` yaw drift in `/odometry/filtered`
3. Dashboard header badge reports SLAM-backed yaw fusion state (3-state: active / stale / lost)
4. Exactly one node publishes `map→odom` (slam_toolbox) — no TF cycle, no duplicate publisher (`ros2 topic info /tf` sanity check, `ros2 run tf2_ros tf2_echo map odom` shows slam_toolbox as source)
5. `config/ekf.yaml` comments document chosen `pose0` covariance + rejected values + disabled-IMU rationale (FUSE-04)

Plus research-driven checks:
- `scripts/yaw-drift-test.sh` exists, runs, produces a single-line PASS/FAIL summary
- Badge thresholds (500 ms / 2 s) match decisions D-11, not arbitrarily picked

</success_criteria>

<deferred>
## Deferred Ideas

Ideas that surfaced during discussion but belong in future phases / milestones:

- **Supervisor node for auto-fallback** — watchdog that re-enables `imu0` yaw when `/slam_toolbox/pose` goes stale. Belongs to the future safety-auto-stop milestone that gates `/cmd_vel` on sensor health more broadly. Tracked under REQUIREMENTS.md §Future ("Safety auto-stop watchdog").
- **Dual-EKF refactor** (odom-frame + map-frame) — only if single-EKF yaw-only shows edge-case divergence in prolonged field use. Tracked under REQUIREMENTS.md §Future.
- **Numeric drift-rate readout (°/min)** in the UI — considered as a badge alternative, rejected in favor of 3-state. Could be added later as a diagnostic on a "Health" page.
- **Client-side yaw-drift plot over time** — nice for tuning, but out of scope; `scripts/yaw-drift-test.sh` + logs + `/logs` viewer are enough for bring-up.
- **Consume slam_toolbox's pose covariance as-is** — rejected at D-05 in favor of hardcoded conservative override. Revisit only if slam_toolbox covariance turns out to be meaningful AND tracks reality better than hand-tuned values.

</deferred>

---

*Phase: 07-slam-pose-ekf-yaw-fusion*
*Context gathered: 2026-04-15*
*Downstream consumers: gsd-phase-researcher, gsd-planner*
