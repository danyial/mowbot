---
phase: 07-slam-pose-ekf-yaw-fusion
plan: 03
subsystem: web-ui
tags: [phase-7, wave-2, fuse-03, web, zustand, header-badge]
requires:
  - "Plan 07-02 (ekf.yaml pose0:/pose wired; /pose publishing on hardware)"
provides:
  - "3-state heading-confidence badge in dashboard header (FUSE-03)"
  - "useSlamPoseStore Zustand hook (SLAM pose + yawCovariance + freshness)"
  - "POSE topic registration for the generic rosbridge subscriber"
affects:
  - "Phase 7 closeout (awaits operator human-verify on live mower)"
  - "Phase 8 map-anchor work (badge is its operator-trust signal for yaw)"
tech-stack:
  added: []
  patterns:
    - "Zustand store with lastUpdate: Date.now() freshness sentinel (gps-store.ts pattern)"
    - "Inline header Badge with variant map + label map + store hook (gps-badge pattern)"
    - "setInterval re-render tick for time-derived UI state (RESEARCH gap closure)"
key-files:
  created:
    - "web/lib/store/slam-pose-store.ts"
  modified:
    - "web/lib/types/ros-messages.ts — added PoseWithCovarianceStamped"
    - "web/lib/ros/topics.ts — added POSE entry"
    - "web/lib/store/ros-store.ts — subscribe<PoseWithCovarianceStamped>(\"POSE\") wired"
    - "web/components/layout/header.tsx — 3-state yaw badge + setInterval tick"
decisions:
  - "YAW_COV_DEGRADED_THRESHOLD = 0.10 rad² — 2× the D-05 target 0.05 rad²; Wave 1 shipped yaw_covariance_scale=1.0 so the EKF sees native slam_toolbox covariance unscaled. If Wave 1 outdoor FUSE-02 re-tune changes the scale, the threshold constant must be re-tuned proportionally (documented inline in the store)."
  - "Badge uses INLINE pattern next to GPS badge, not a separate SlamYawBadge.tsx component — matches the existing GPS-badge convention in header.tsx (PATTERNS note)."
  - "500ms setInterval tick lives in the component, not the store — re-render pressure should not re-run updatePose, and the store stays pure."
  - "Covariance-degraded branch is gated on `yawCovariance > 0` so the -1 sentinel (missing/invalid covariance) does NOT flip the badge to stale on a fresh message. Only a positive covariance that exceeds threshold trips the branch."
metrics:
  duration: "~10 minutes"
  completed: "2026-04-15"
  tasks_completed: "2/3 (Task 3 is human-verify checkpoint, awaiting operator)"
  commits: 2
---

# Phase 07 Plan 03: Web-UI FUSE-03 Heading-Confidence Badge — Summary

Wave 2 ships the 3-state heading-confidence badge in the dashboard header by subscribing the web client to `/pose` via the existing rosbridge + NaN-scrub pipeline, feeding a new `useSlamPoseStore` Zustand store, and rendering the badge inline next to the existing GPS badge. A 500ms `setInterval` tick in the badge component closes the RESEARCH-identified staleness-detection gap so a silent SLAM death flips the badge to red within a bounded 2s. `web/server.mjs` was deliberately not modified — v2.1 single-upgrade-handler regression gate held.

## What Was Built

### Task 1 — commit `8032609`

- **`web/lib/types/ros-messages.ts`** — added `PoseWithCovarianceStamped` interface (header + pose{pose{position,orientation}, covariance[36]}). Placed next to the existing `Odometry` type since their `pose` fields are shape-siblings.
- **`web/lib/ros/topics.ts`** — added `POSE` entry between `ODOMETRY` and `BATTERY` (preserves sensor-grouping order):
  ```typescript
  POSE: {
    name: "/pose",
    messageType: "geometry_msgs/PoseWithCovarianceStamped",
    compression: "cbor",
    throttleMs: 100, // 10 Hz
  }
  ```
  Name `/pose` is the value confirmed live by Plan 07-02 preflight (1 publisher + 1 subscriber post-restart); CONTEXT.md's `/slam_toolbox/pose` was a documentation error.
- **`web/lib/store/slam-pose-store.ts`** (new, 72 lines) — clone of `gps-store.ts` shape:
  - State: `x`, `y`, `yaw` (degrees, `quaternionToEuler` returns degrees), `yawCovariance` (rad², -1 sentinel), `lastUpdate` (Date.now() sentinel, 0 initial).
  - `updatePose(msg)` extracts `covariance[35]` (yaw-yaw variance) with the defensive `cov != null && isFinite(cov) && cov > 0` check mirroring `gps-store.accuracy`.
  - Exports `YAW_COV_DEGRADED_THRESHOLD = 0.10` with a large calibration comment documenting the 2×-target derivation, Wave 0/1 handoff references, and the re-tune trigger.

### Task 2 — commit `b64eb7d`

- **`web/lib/store/ros-store.ts`** — added `useSlamPoseStore` import + `PoseWithCovarianceStamped` to the type import block + one new `subscribe<PoseWithCovarianceStamped>("POSE", ...)` entry in `setupSubscriptions()`'s `subs` array. `cleanupSubscriptions()` untouched — the generic subs array auto-cleans.
- **`web/components/layout/header.tsx`** — added:
  1. `slamBadgeVariant` and `slamLabels` maps (active/stale/lost → success/warning/error) next to the existing `fixBadgeVariant`/`fixLabels`.
  2. Store hooks for `lastUpdate` and `yawCovariance`.
  3. `setInterval(() => setTick((n) => n + 1), 500)` in a `useEffect` — forces re-render every 500ms so `Date.now() - lastUpdate` re-evaluates when `/pose` stops arriving.
  4. `slamState` IIFE: `lastUpdate === 0 || age > 2000 → lost`; `age > 500 → stale`; `yawCovariance > 0 && > YAW_COV_DEGRADED_THRESHOLD → stale`; else `active`.
  5. New `<Badge>` rendered immediately after the GPS badge inside the existing `flex items-center gap-3 ml-auto` container.

### `web/server.mjs` — deliberately unchanged

`git diff web/server.mjs` is 0 lines. The v2.1 single-upgrade-handler pattern is preserved — FUSE-03 only ADDS a topic subscription through the existing `/rosbridge` proxy, no server-side code changes required.

## Commits

| Hash      | Scope      | Message                                                                     |
| --------- | ---------- | --------------------------------------------------------------------------- |
| `8032609` | Task 1     | feat(07-03): add POSE topic + PoseWithCovarianceStamped type + slam-pose-store |
| `b64eb7d` | Task 2     | feat(07-03): wire /pose subscription + render 3-state yaw badge in header   |

## Tests Run

| Check                                                         | Result              |
| ------------------------------------------------------------- | ------------------- |
| `npx tsc --noEmit` in `web/` (post-Task-1)                    | ✅ clean            |
| `npx tsc --noEmit` in `web/` (post-Task-2)                    | ✅ clean            |
| `grep subscribe<PoseWithCovarianceStamped>("POSE"` ros-store  | ✅ found            |
| `grep useSlamPoseStore` header.tsx                            | ✅ found            |
| `grep setInterval` header.tsx                                 | ✅ found            |
| `grep YAW_COV_DEGRADED_THRESHOLD` header.tsx                  | ✅ found            |
| `git diff web/server.mjs` empty                               | ✅ 0 lines (regression gate held) |
| `npm --prefix web run lint`                                   | ⚠ skipped — pre-existing repo-wide lint tooling issue (ESLint 9.39 + `@eslint/eslintrc` circular-JSON bug in `next lint` invocation); unrelated to this plan. TypeScript strict-typecheck is clean, which is the load-bearing safety net. |

## Deviations from Plan

### [Rule 3 — blocking issue, bounded] Lint tool pre-existing failure

- **Found during:** Task 2 verification
- **Issue:** `npm --prefix web run lint` and `npx next lint` both error with "Invalid project directory provided, no such directory: .../web/lint" (next lint is misinterpreting the `lint` script arg). Direct `npx eslint` throws a circular-JSON error from `@eslint/eslintrc` config validation — a known upstream tooling break on ESLint 9 + older eslintrc-bridge.
- **Scope boundary:** Pre-existing failure unrelated to this plan's file changes. The ESLint errors reproduce on untouched files.
- **Resolution:** Documented here; TypeScript strict-compile is clean (the load-bearing correctness check). Fixing the lint tooling belongs in a separate chore plan.
- **Commit:** N/A

### No other deviations

All Task 1 and Task 2 acceptance criteria met as specified.

## Known Stubs

None. The badge ships fully wired with all three state branches live.

## Threat Flags

None. This plan adds only a read-only display path and a new subscription through the existing trust-boundary (rosbridge → browser), which is already covered by the v2.1 NaN scrubber. No new surface.

## Human-Verify Handoff (Task 3 — operator action required)

Task 3 is a `checkpoint:human-verify` that cannot be executed from this session — it requires a live browser on the mower network + SSH to run `docker stop/start mower-slam`. The artifacts are ready to deploy:

```bash
ssh pi@10.10.40.23 'cd ~/MowerBot && git pull && docker compose up -d --build web'
```

Once web is healthy (~15-30s), operator runs the three-state verification per the plan's `<how-to-verify>` block:

1. **Green "SLAM active"** — load `/` in browser, badge green within ~3s (requires /pose to be publishing; slam_toolbox only publishes after scan-matches, so the mower may need small motion if it's been stationary).
2. **Stop → Yellow → Red** — `ssh pi@10.10.40.23 'docker stop mower-slam'`; badge yellow within 500ms–1s, red within 2s. Proves the `setInterval` tick re-evaluates staleness without new messages.
3. **Start → Green** — `ssh pi@10.10.40.23 'docker start mower-slam'`; badge returns to green within ~3s once slam_toolbox re-initializes and publishes.
4. **Regression gate** — GPS badge, IMU, odom telemetry, map page, /logs tab all still work (confirms v2.1 single-upgrade-handler was not broken).

If all four pass, operator replies "approved" and Phase 7 closeout (07-VERIFICATION.md) becomes unblocked.

## Follow-Ups

1. **Operator human-verify** (Task 3) on live hardware — see handoff block above.
2. **Phase 7 VERIFICATION.md** — generate via `/gsd-verify-work` after Task 3 approval.
3. **Lint tooling fix** (chore) — `next lint` is broken in this repo's ESLint 9 config; unrelated to Phase 7 but worth a follow-up plan.
4. **Re-tune `YAW_COV_DEGRADED_THRESHOLD`** — if Wave 1 outdoor FUSE-02 re-tune changes `yaw_covariance_scale` away from 1.0, update the constant to 2× the new effective target variance.

## Self-Check: PASSED

- FOUND: `web/lib/store/slam-pose-store.ts` (72 lines, new file)
- FOUND: `PoseWithCovarianceStamped` in `web/lib/types/ros-messages.ts`
- FOUND: `POSE:` entry in `web/lib/ros/topics.ts`
- FOUND: `subscribe<PoseWithCovarianceStamped>("POSE"` in `web/lib/store/ros-store.ts`
- FOUND: `useSlamPoseStore` + `YAW_COV_DEGRADED_THRESHOLD` + `setInterval` in `web/components/layout/header.tsx`
- FOUND: commit `8032609` (Task 1)
- FOUND: commit `b64eb7d` (Task 2)
- VERIFIED: `git diff web/server.mjs` returns 0 lines (regression gate held)
- VERIFIED: `npx tsc --noEmit` in `web/` clean
- DEFERRED (checkpoint): Task 3 human-verify on live hardware

---

*Plan: 07-03-PLAN.md*
*Completed (implementation): 2026-04-15*
*Awaiting: operator human-verify on mower.local to close Phase 7*
