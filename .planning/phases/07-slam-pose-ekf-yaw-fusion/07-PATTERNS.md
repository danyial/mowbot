# Phase 7: SLAM Pose → EKF Yaw Fusion — Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 9 (2 new, 7 modified)
**Analogs found:** 9 / 9 (every file has a strong in-repo analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `config/ekf.yaml` (modify) | config (ROS2 params) | sensor-fusion | `config/ekf.yaml` (itself — `imu0` block as the in-file template for the new `pose0` block) | exact |
| `config/slam_toolbox_params.yaml` (modify) | config (ROS2 params) | request-response | `config/slam_toolbox_params.yaml` (itself — existing `# OVERRIDE: ...` comment style) | exact |
| `scripts/yaw-drift-test.sh` (create) | utility (operator CLI) | batch / one-shot | `scripts/build-and-push.sh` (only existing bash script — header style + arg handling) | role-match |
| `web/lib/store/slam-pose-store.ts` (create) | store (Zustand) | event-driven (topic → state) | `web/lib/store/gps-store.ts` (3-state derived status from topic + lastUpdate timestamp + covariance-derived metric) | exact |
| `web/lib/ros/topics.ts` (modify) | config (frontend topic registry) | event-driven | existing `ODOMETRY` entry — same msg shape (`PoseWithCovarianceStamped` ≈ Odometry's `pose` field) | exact |
| `web/lib/ros/subscribers.ts` (modify) | utility (generic subscriber factory) | event-driven | **No modification needed** — generic `subscribe<T>()` already handles new topic via TOPICS lookup | n/a |
| `web/lib/store/ros-store.ts` (modify) | store (orchestrator) | event-driven | existing `subscribe<NavSatFix>("FIX", ...)` line in `setupSubscriptions()` | exact |
| `web/components/layout/header.tsx` (modify) | component (layout) | request-response (reactive) | existing inline GPS Fix Badge (lines 36-39) — same header, same `Badge` primitive | exact |
| `web/components/SlamYawBadge.tsx` (create, optional) | component (presentational) | reactive | inline GPS badge in `header.tsx` lines 9-23 + 36-39 — extract pattern into a sibling component | exact |

> **Note:** CONTEXT.md mentioned `web/components/GpsStatus.tsx` as the canonical badge analog, but **no such file exists**. The GPS badge is implemented **inline inside `web/components/layout/header.tsx`** (variant map at lines 9-15, label map 17-23, render at 36-39, store hook at 27). The yaw badge should follow the same inline pattern OR be extracted into a small `SlamYawBadge.tsx` component for symmetry — planner's call. Pattern excerpts below cover both options.

## Pattern Assignments

### `config/ekf.yaml` (config, sensor-fusion)

**Analog:** Itself — the existing `imu0` block (lines 16-26) is the in-file template for the new `pose0` block. Same indentation, same comment style (German top-level + English inline), same selection-vector layout.

**Existing `imu0_config` selection-vector pattern (lines 17-26):**
```yaml
# IMU (MPU-6050, Topic: /imu)
imu0: /imu
imu0_config: [false, false, false,    # x, y, z Position — nicht von IMU
              false, false, false,     # roll, pitch, yaw — nicht direkt    ← FUSE-01: this row's 3rd entry was true, must flip to false (it already is false in current file)
              false, false, false,     # vx, vy, vz — nicht von IMU
              true,  true,  true,      # roll_vel, pitch_vel, yaw_vel       ← D-08: keep all three true (FUSE-04 must document why)
              false, false, false]     # ax, ay, az — deaktiviert (Drift ohne Encoder)
imu0_differential: false
imu0_relative: false
imu0_remove_gravitational_acceleration: true
imu0_queue_size: 10
```

**Note for planner:** Inspecting current file shows `imu0` yaw-position is **already `false`** (line 19, position 6 of the second row). So FUSE-01's "flip imu0 yaw-position to false" is a no-op for the YAML itself — the work is to ADD a comment block explaining *why* it stays false (FUSE-04), and add the `pose0` block alongside.

**`pose0` block to add (mirrors `imu0` shape — RESEARCH §Code Examples, lines 196-204):**
```yaml
# SLAM Pose (slam_toolbox, Topic: /pose) — yaw-only fusion (FUSE-01..04)
# See FUSE-04 comment block below for covariance + IMU-yaw-disabled rationale.
pose0: /pose
pose0_config: [false, false, false,    # x, y, z       — slam publishes them but we DO NOT consume (D-04: would create map→odom TF cycle)
               false, false, true,     # roll, pitch, YAW ← only this (D-02)
               false, false, false,    # vx, vy, vz
               false, false, false,    # vroll, vpitch, vyaw — gyro handles this (D-08)
               false, false, false]    # ax, ay, az
pose0_differential: false
pose0_relative: false
pose0_queue_size: 10
pose0_rejection_threshold: 3.0          # Mahalanobis — drop wild scan-match outliers (RESEARCH §Pitfalls)
```

**FUSE-04 documentation block pattern (D-06, D-10):**
The existing file uses a leading German comment header (line 1-2) and inline German-with-English-tail comments (lines 18-22, 30-31). For FUSE-04, write a single heredoc-style YAML comment block immediately above the `pose0:` line, following the existing decorative pattern. Read like an ADR: what was tried, what was rejected, why. Reference STATE.md decisions D-02, D-05, D-06, D-08.

**Critical preservation:** `world_frame: odom` (line 14) MUST stay `odom`. EKF must not publish into `map` frame (D-04, ROADMAP success criterion 4).

---

### `config/slam_toolbox_params.yaml` (config, request-response)

**Analog:** Itself — file already has a clean OVERRIDE-comment convention.

**Existing OVERRIDE comment pattern (line 31-37):**
```yaml
transform_publish_period: 0.05    # OVERRIDE: 20 Hz map->odom (cheaper than upstream 0.02/50 Hz)
map_update_interval: 2.0          # OVERRIDE: 0.5 Hz publish — satisfies SC#1
resolution: 0.025            # OVERRIDE: 2.5 cm/cell — matches LD19 ~1–3 cm noise floor; 4× cell count vs 0.05 m
min_laser_range: 0.05             # OVERRIDE: LD19 minimum
max_laser_range: 12.0             # OVERRIDE: LD19 datasheet practical max
```

**Pattern for new `yaw_covariance_scale` line (RESEARCH §Summary — D-05 materializes here, NOT in ekf.yaml):**
```yaml
yaw_covariance_scale: 0.05        # OVERRIDE: Phase 7 FUSE-01..04 — multiplies pose yaw variance so EKF's pose0
                                  # consumption sees ~0.05 rad² (≈13° std dev). Conservative start (D-05);
                                  # see ekf.yaml FUSE-04 block for tuning history.
```

Place near other Scan Matcher / OVERRIDE entries (after line 70). Use same trailing-`OVERRIDE:` comment style — keeps `git blame` story consistent.

---

### `scripts/yaw-drift-test.sh` (utility, batch)

**Analog:** `scripts/build-and-push.sh` (only existing bash script in `scripts/`)

**Header pattern to copy (lines 1-13):**
```bash
#!/bin/bash
# scripts/yaw-drift-test.sh
# 60s stationary yaw-drift measurement for /odometry/filtered (Phase 7 FUSE-02)
#
# Voraussetzung:
#   - ROS2 stack running on Pi (docker compose up)
#   - mower stationary, motors off, LiDAR seeing features (D-16)
#
# Verwendung:
#   ./scripts/yaw-drift-test.sh
#
# Ausgabe (single line, paste into 07-VERIFICATION.md per D-17):
#   Δyaw = X.XX° over 60s — PASS/FAIL (<1°)

set -e
```

**Defensive script structure (mirrors build-and-push.sh §1 'Pruefen ob...' pattern, lines 38-45):**
The existing script fail-fasts with explicit error messages. Apply same style:
1. Check `ros2 topic list | grep -q /odometry/filtered` → fail if missing.
2. Capture starting yaw via `ros2 topic echo --once /odometry/filtered` piped into a `python3 -c` quaternion→yaw one-liner (RESEARCH §Standard Stack `tf_transformations` row recommends python over `jq` for quaternion math).
3. `sleep 60`.
4. Capture ending yaw same way.
5. Print single PASS/FAIL line — same `========================================` decorative banner pattern (lines 28-30, 71-84) is project convention.

**Path discovery pattern (lines 25-26):**
```bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
```
Useful if the script needs to write its raw output to `${PROJECT_DIR}/.planning/phases/07-.../07-VERIFICATION.md` automatically — though D-17 says manual paste is fine.

---

### `web/lib/store/slam-pose-store.ts` (store, event-driven)

**Analog:** `web/lib/store/gps-store.ts` — exact match. Both have:
- A topic with header.stamp, position, covariance
- A `lastUpdate: number` field for freshness
- A derived 3-state status (gps fixStatus / slam slam_state)
- A covariance-derived single metric (gps `accuracy` / slam `yawCovariance`)

**Imports pattern to copy (gps-store.ts lines 1-5):**
```typescript
"use client";

import { create } from "zustand";
import type { NavSatFix, FixStatus } from "@/lib/types/ros-messages";
import { getFixStatus } from "@/lib/types/ros-messages";
```

For the new store, add a new type `PoseWithCovarianceStamped` to `web/lib/types/ros-messages.ts` if missing (the Odometry interface lines 56-65 already defines `pose: { pose: { position, orientation }, covariance: number[] }` — extract that shape).

**State + actions interface pattern (gps-store.ts lines 28-55):**
```typescript
interface GpsState {
  latitude: number | null;
  longitude: number | null;
  // ...
  fixStatus: FixStatus;            // ← derived 3-state (matches D-11 active/stale/lost)
  accuracy: number;                // ← derived from covariance (matches D-11 covariance-trace badge condition)
  lastUpdate: number;              // ← THE freshness field that drives D-11 thresholds (500ms / 2s)

  updateFix: (msg: NavSatFix) => void;
  // ...
}
```

For `slam-pose-store.ts`, the analogous shape is:
```typescript
interface SlamPoseState {
  x: number | null;
  y: number | null;
  yaw: number | null;
  yawCovariance: number;           // analog of `accuracy` — drives covariance-trace badge condition
  lastUpdate: number;              // analog of gps lastUpdate — drives 500ms/2s thresholds
  // (Status derivation lives in the consumer/badge — see header.tsx pattern below;
  //  gps-store.ts derives `fixStatus` from msg, but for SLAM the status depends on
  //  CURRENT TIME minus lastUpdate, so it must be computed in the component, not the store.)

  updatePose: (msg: PoseWithCovarianceStamped) => void;
}
```

**Store body pattern (gps-store.ts lines 57-130):**
```typescript
export const useGpsStore = create<GpsState>((set, get) => ({
  latitude: null,
  // ... initial state ...
  lastUpdate: 0,

  updateFix: (msg: NavSatFix) => {
    // ... derive fields from msg ...
    const accuracy =
      msg.position_covariance_type > 0 &&
      covLat != null && covLon != null &&
      isFinite(covLat) && isFinite(covLon) &&
      covLat > 0 && covLon > 0
        ? Math.sqrt((covLat + covLon) / 2)
        : -1;

    set({
      latitude: msg.latitude,
      // ...
      accuracy,
      lastUpdate: Date.now(),    // ← always Date.now() at end of updateFix
    });
  },
}));
```

For SLAM yaw, copy the defensive `isFinite() && > 0` covariance check verbatim — covariance[35] is the yaw-yaw entry (6×6 row-major, index 5*6+5=35). Quaternion → yaw conversion: `web/lib/utils/quaternion.ts` already exports `quaternionToEuler` (used by imu-store.ts line 84 — `const euler = quaternionToEuler(msg.orientation); rawYaw = euler.yaw`).

---

### `web/lib/ros/topics.ts` (config, event-driven)

**Analog:** Existing `ODOMETRY` entry (lines 17-22). Pose has same wire characteristics as Odometry (~10 Hz, similar message size).

**Pattern excerpt:**
```typescript
ODOMETRY: {
  name: "/odometry/filtered",
  messageType: "nav_msgs/Odometry",
  compression: "cbor",
  throttleMs: 100, // 10 Hz
},
```

**New POSE entry to add (RESEARCH §Summary — note actual topic is `/pose` NOT `/slam_toolbox/pose`):**
```typescript
POSE: {
  name: "/pose",                                            // RESEARCH-confirmed: slam_toolbox publishes on `/pose`, NOT `/slam_toolbox/pose`
  messageType: "geometry_msgs/PoseWithCovarianceStamped",
  compression: "cbor",
  throttleMs: 100, // 10 Hz — matches scan rate; sufficient for D-11 500ms freshness threshold
},
```

Place between `ODOMETRY` and `BATTERY` to preserve sensor-grouping order.

---

### `web/lib/ros/subscribers.ts` (utility)

**No modification needed.** The generic `subscribe<T>()` factory (lines 92-140) reads from `TOPICS[topicKey]` and handles compression, throttling, and NaN scrubbing automatically. Adding a new topic is purely a `topics.ts` + `ros-store.ts` change.

---

### `web/lib/store/ros-store.ts` (store, orchestrator)

**Analog:** Existing `subscribe<NavSatFix>("FIX", ...)` line in `setupSubscriptions()` (lines 65-67).

**Imports pattern (lines 7-12) — add slam-pose-store import:**
```typescript
import { useGpsStore } from "@/lib/store/gps-store";
import { useImuStore } from "@/lib/store/imu-store";
import { useBatteryStore } from "@/lib/store/battery-store";
import { useOdometryStore } from "@/lib/store/odometry-store";
// ADD: import { useSlamPoseStore } from "@/lib/store/slam-pose-store";
```

**Type imports pattern (lines 13-22) — add PoseWithCovarianceStamped:**
```typescript
import type {
  NavSatFix,
  ImuMessage,
  // ...
  OccupancyGrid,
  // ADD: PoseWithCovarianceStamped,
} from "@/lib/types/ros-messages";
```

**Subscription pattern to copy (lines 65-67):**
```typescript
subscribe<NavSatFix>("FIX", (msg) => {
  useGpsStore.getState().updateFix(msg);
}),
```

**New subscription line for slam-pose (drop into `subs` array at line 64-101):**
```typescript
subscribe<PoseWithCovarianceStamped>("POSE", (msg) => {
  useSlamPoseStore.getState().updatePose(msg);
}),
```

**Cleanup pattern: nothing to add.** `cleanupSubscriptions()` at line 55-59 iterates the generic subs array — new sub auto-cleans.

---

### `web/components/layout/header.tsx` (component, layout)

**Analog:** The inline GPS Fix Badge already in this file (lines 9-15 variant map, 17-23 label map, 27 store hook, 36-39 render). This IS the pattern; the new yaw badge sits next to it.

**Variant map pattern (lines 9-15):**
```typescript
const fixBadgeVariant: Record<string, "success" | "warning" | "error" | "info" | "secondary"> = {
  no_fix: "error",
  autonomous: "warning",
  dgps: "warning",
  rtk_float: "info",
  rtk_fixed: "success",
};
```

**Label map pattern (lines 17-23):**
```typescript
const fixLabels: Record<string, string> = {
  no_fix: "No Fix",
  autonomous: "Autonomous",
  // ...
};
```

**Store consumption + render pattern (lines 27, 36-39):**
```typescript
const fixStatus = useGpsStore((s) => s.fixStatus);
// ...
{/* GPS Fix Badge */}
<Badge variant={fixBadgeVariant[fixStatus] || "secondary"}>
  {fixLabels[fixStatus] || "Unknown"}
</Badge>
```

**For the yaw badge — derive 3-state from `lastUpdate` at render time** (D-11 thresholds 500ms / 2s):
```typescript
const lastUpdate = useSlamPoseStore((s) => s.lastUpdate);
const yawCov = useSlamPoseStore((s) => s.yawCovariance);
const slamState: "active" | "stale" | "lost" = (() => {
  const age = Date.now() - lastUpdate;
  if (lastUpdate === 0 || age > 2000) return "lost";
  if (age > 500) return "stale";
  // covariance threshold per D-11 (TBD in planner — RESEARCH says SHIP WIRED UP)
  if (yawCov > YAW_COV_DEGRADED_THRESHOLD) return "stale";
  return "active";
})();
```
Add corresponding `slamBadgeVariant` and `slamLabels` maps next to the GPS ones. Render the new `<Badge>` immediately to the LEFT or RIGHT of the GPS badge inside the existing `<div className="flex items-center gap-3 ml-auto">` (line 35).

**⚠ Re-render note:** The 3-state derivation depends on `Date.now()`, which won't re-render automatically when no message arrives (e.g., SLAM dies → store stops updating → badge stays "active" forever). Planner must add a `setInterval(() => forceUpdate(), 500)` (e.g., via a small `useTick` hook) inside the badge to force a re-evaluation while waiting for staleness to manifest. This is a known gap in the GPS badge pattern that doesn't apply because GPS staleness is encoded in `fixStatus` directly from the message.

---

### `web/components/SlamYawBadge.tsx` (component, presentational — OPTIONAL)

**Analog:** The inline GPS badge in `header.tsx`. If the planner chooses to extract for symmetry, the component is ~30 LOC: variant map + label map + store hook + tick hook + `<Badge>`. Same `"use client"` directive, same `Badge` import from `@/components/ui/badge`. Pattern is identical to GPS badge — see header.tsx excerpts above.

Recommended only if there's appetite to also extract `GpsStatusBadge` from `header.tsx` for symmetry — otherwise inline both for consistency.

---

## Shared Patterns

### Defensive covariance reading
**Source:** `web/lib/store/gps-store.ts` lines 109-117
**Apply to:** `slam-pose-store.ts` (yaw covariance), any future covariance consumer
```typescript
const cov = msg.pose.covariance[35];  // yaw-yaw entry, 6×6 row-major
const yawCovariance =
  cov != null && isFinite(cov) && cov > 0
    ? cov
    : -1;
```
Always check `isFinite() && > 0` — uninitialized covariance fields appear as `0`, `-1`, or NaN depending on publisher. `scrubNaN` in subscribers.ts converts NaN → null, hence the `cov != null` guard.

### `lastUpdate: Date.now()` freshness sentinel
**Source:** `web/lib/store/gps-store.ts` line 126, `web/lib/store/imu-store.ts` line 141
**Apply to:** `slam-pose-store.ts`, every store that needs staleness detection
```typescript
set({
  // ... fields ...
  lastUpdate: Date.now(),
});
```
Initial value is `0` (gps-store.ts line 65, imu-store.ts line 66) so consumers can detect "never received" with `lastUpdate === 0`.

### Subscription registration in `setupSubscriptions()`
**Source:** `web/lib/store/ros-store.ts` lines 61-104
**Apply to:** Every new ROS topic
The function pushes new entries onto the `subs` array literal; window-pinned tracking auto-cleans via `cleanupSubscriptions()`. No extra wiring needed.

### Inline OVERRIDE comments in YAML configs
**Source:** `config/slam_toolbox_params.yaml` lines 17-37
**Apply to:** Both YAML edits this phase
```yaml
key: value                        # OVERRIDE: <one-line rationale, refer to RESEARCH/STATE doc for depth>
```
Project convention is German top-of-file headers, English/German mixed inline. FUSE-04 documentation should follow this — readable as an inline ADR.

### NaN sanitization is automatic
**Source:** `web/lib/ros/subscribers.ts` lines 36-76 (`scrubNaN`)
**Apply to:** Every subscriber — no action needed; the generic `subscribe<T>()` already runs scrub on every message before invoking the callback. New `slam-pose-store.updatePose` will receive NaN-scrubbed messages automatically. Typed arrays (Float32Array etc.) are skipped — not relevant for PoseWithCovarianceStamped.

## No Analog Found

None — every file has a strong in-repo analog.

## Metadata

**Analog search scope:** `config/`, `scripts/`, `web/lib/store/`, `web/lib/ros/`, `web/components/`, `web/components/layout/`, `web/components/ui/`
**Files scanned:** ~15 (config YAMLs, all Zustand stores, ros-client/topics/subscribers, header.tsx, build-and-push.sh)
**Pattern extraction date:** 2026-04-15
**Key correction from CONTEXT.md:** `web/components/GpsStatus.tsx` does NOT exist — the GPS badge is inline in `web/components/layout/header.tsx`. All "follow GpsStatus.tsx" references should resolve to the inline pattern in header.tsx (lines 9-15, 17-23, 27, 36-39).
**Key correction from CONTEXT.md:** D-05's "hardcode pose0 yaw variance via EKF's covariance-override mechanism" cannot literally be done in `ekf.yaml` — robot_localization has no per-sensor variance override. Per RESEARCH §Summary, materialize via `yaw_covariance_scale` in `slam_toolbox_params.yaml` instead.
