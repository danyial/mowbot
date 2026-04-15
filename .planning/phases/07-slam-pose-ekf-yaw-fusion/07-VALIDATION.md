---
phase: 7
slug: slam-pose-ekf-yaw-fusion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Sourced from `07-RESEARCH.md §Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None existing (per `.planning/codebase/TESTING.md`) — validation is hardware-in-the-loop via bash script + runtime ROS topic inspection |
| **Config file** | None — direct shell commands |
| **Quick run command** | `./scripts/yaw-drift-test.sh 10` (10-s smoke — fast sanity after task commits) |
| **Full suite command** | `./scripts/yaw-drift-test.sh 60` (full 60-s FUSE-02 criterion, exit 0 = PASS) |
| **Estimated runtime** | ~10 s quick, ~60 s full, plus ~15 s browser badge check |

---

## Sampling Rate

- **After every task commit:** `./scripts/yaw-drift-test.sh 10` — confirms EKF still publishes sane yaw after each edit
- **After every plan wave:** `./scripts/yaw-drift-test.sh 60` + browser badge check (load `/`, observe green) + `ros2 run tf2_ros tf2_echo map odom` (confirm slam_toolbox is sole publisher)
- **Before `/gsd-verify-work`:** Full 60-s test passes with margin (target <0.5° preferred, hard <1.0°); all three badge states observed (stop/start `mower-slam` container); FUSE-04 grep confirms comment block present
- **Max feedback latency:** 10 s (quick), 60 s (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | FUSE-02 | — | N/A | smoke | `test -x scripts/yaw-drift-test.sh && ./scripts/yaw-drift-test.sh 5` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 0 | FUSE-01 | — | N/A | runtime | `ros2 topic list \| grep -E '^/pose$'` (confirm topic name before ekf.yaml edit) | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 0 | FUSE-04 | — | N/A | runtime | `ros2 topic echo /pose --field pose.covariance --once` (capture native covariance to set yaw_covariance_scale) | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 1 | FUSE-01 | — | N/A | static | `grep -E '^\s*pose0:\s*/pose' config/ekf.yaml` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 1 | FUSE-01 | — | N/A | static | `python3 -c "import yaml; c=yaml.safe_load(open('config/ekf.yaml')); p=c['ekf_filter_node']['ros__parameters']['pose0_config']; assert sum(p)==1 and p[5]==True, p" ` | ❌ W0 | ⬜ pending |
| 07-02-03 | 02 | 1 | FUSE-01 | — | N/A | static | `python3 -c "import yaml; c=yaml.safe_load(open('config/ekf.yaml')); i=c['ekf_filter_node']['ros__parameters']['imu0_config']; assert i[5]==False, 'imu0 yaw-position must be false'"` | ❌ W0 | ⬜ pending |
| 07-02-04 | 02 | 1 | FUSE-04 | — | comment rationale readable | static | `grep -q "WHY pose0 YAW VARIANCE" config/ekf.yaml && grep -q "Chosen:" config/ekf.yaml` | ❌ W0 | ⬜ pending |
| 07-02-05 | 02 | 1 | FUSE-01 | — | one map→odom publisher | integration | `docker compose restart nav && sleep 5 && docker exec mower-nav ros2 run tf2_ros tf2_echo map odom 2>&1 \| head -5` — source = slam_toolbox | ❌ W0 | ⬜ pending |
| 07-02-06 | 02 | 1 | FUSE-02 | — | drift <1° / 60s | smoke | `./scripts/yaw-drift-test.sh 60` — exit 0 = PASS | ❌ W0 | ⬜ pending |
| 07-03-01 | 03 | 2 | FUSE-03 | V5 | malformed /pose handled | unit | `grep -q "slam-pose-store" web/lib/store/` + tsc typecheck via `npm --prefix web run lint` | ❌ W0 | ⬜ pending |
| 07-03-02 | 03 | 2 | FUSE-03 | — | badge state transitions | manual | Load `/` → expect green; `docker stop mower-slam` → red within 2 s; `docker start mower-slam` → green within ~3 s | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/yaw-drift-test.sh` — implements FUSE-02 scripted validator (does not exist today). Parameterized by duration, extracts yaw from `/odometry/filtered`, prints `Δyaw = X.XX° over Ns — PASS/FAIL (<1°)`, exit 0/1 accordingly
- [ ] Runtime-check: `ros2 topic list | grep -E '^/pose$'` — confirm topic name before `pose0:` value lands in `ekf.yaml` (CONTEXT.md used `/slam_toolbox/pose`; research corrected to `/pose`)
- [ ] Runtime-check: `ros2 topic echo /pose --field pose.covariance --once` — record native covariance magnitude in VERIFICATION.md; determines starting `yaw_covariance_scale` value in `config/slam_toolbox_params.yaml`

*No test framework to install (project has none); smoke validation is scripted shell + runtime ROS introspection.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 3-state badge visual transitions | FUSE-03 | Browser UX cannot be automated without adding a Playwright suite (out of scope) | 1. Load `http://mower.local:3000/` → badge green within 3 s<br>2. `docker stop mower-slam` → badge yellow within 1 s, red within 2 s<br>3. `docker start mower-slam` → badge green within ~3 s of slam publishing `/pose` again |
| Outdoor stationary drift test | FUSE-02 | Requires physical mower on ground outdoors with LiDAR seeing walls | Mower powered on, motors off, LiDAR + slam_toolbox active; `ssh pi@mower.local './scripts/yaw-drift-test.sh 60'`; paste output into `07-VERIFICATION.md` |
| Covariance-trace threshold tuning | FUSE-03 | Threshold for badge yellow must be tuned against live data | After Wave 0 runtime check records native covariance, pick threshold = 2× native median; document in `slam-pose-store.ts` comment |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (drift script, topic-name check, native cov capture)
- [ ] No watch-mode flags (bash script is one-shot)
- [ ] Feedback latency < 60s (quick: 10s; full: 60s)
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 commits land

**Approval:** pending
