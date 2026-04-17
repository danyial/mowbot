# Phase 8: `/lidar` Map-Anchor + Persistence + Honest Reset — CONTEXT

**Phase:** 8 — `/lidar` Map-Anchor + Persistence + Honest Reset
**Milestone:** v2.2 Ops & Fusion Polish
**Requirements:** MAP-01, MAP-02, MAP-03, MAP-04
**Gathered:** 2026-04-17
**Status:** Ready for research & planning

<domain>
## Phase Boundary

Operator can trust what they see on `/lidar`:
- The occupancy grid is **anchored in the map frame** (world-fixed) while the robot moves *across* it, not *with* it.
- A **robot cursor** marks the current `base_link` pose in map frame, updating live.
- The grid **survives F5** via `localStorage`, rehydrates instantly, and is superseded by the next live `/map` if epochs match.
- The **Eraser button** is honest: it calls `/api/map/reset`, the server invokes the slam_toolbox reset service, the map epoch is bumped, the client clears `localStorage`, and a subsequent F5 shows a fresh empty grid (no stale resurrection).

Phase 7's trustworthy `map→base_link` is the precondition that makes rotational correctness testable.

</domain>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before researching or planning.**

- `.planning/PROJECT.md` — v2.2 milestone statement, stack constraints (Next.js 16 App Router, Canvas 2D rendering, no ros3djs), trusted-LAN
- `.planning/REQUIREMENTS.md` — MAP-01..04 verbatim spec, plus explicit Out-of-Scope (IndexedDB, browser-only reset, ros3djs, dual-EKF)
- `.planning/ROADMAP.md` §Phase 8 — five observable success criteria, hard dep on Phase 7
- `.planning/STATE.md` §Key Decisions — epoch-keyed localStorage persistence, `/api/map/reset` bumps epoch
- `.planning/phases/07-slam-pose-ekf-yaw-fusion/07-CONTEXT.md` — slam-pose-store pattern, /pose freshness conventions, badge thresholds
- `.planning/phases/07-slam-pose-ekf-yaw-fusion/07-VERIFICATION.md` — current trust state of map→base_link
- `web/components/lidar/map-bitmap.tsx` (183 lines) — current renderer with the explicit TODO ("following base_link via /tf or /odometry/filtered is a v1 follow-up") that this phase closes
- `web/components/lidar/scan-canvas.tsx` lines 628–667 — current Eraser onClick that calls slam_toolbox reset directly client-side; this phase replaces it with `/api/map/reset`
- `web/lib/store/map-store.ts` — `useMapStore` with `clear()` for optimistic UI; gets extended for epoch
- `web/lib/store/slam-pose-store.ts` — `slamPoseStore` from Phase 7; provides last-known map-frame pose
- `web/lib/store/odometry-store.ts` — `useOdometryStore` from existing /odometry/filtered subscription; provides odom-frame deltas for interpolation
- `web/server.mjs` — single-upgrade-handler pattern (Phase 6 regression gate); the new `/api/map/reset` is a Next.js API route, NOT a `server.mjs` upgrade — no server.mjs edits needed
- slam_toolbox documentation: ROS2 service `slam_toolbox/reset` (or `/slam_toolbox/reset` depending on namespace) — std_srvs/Empty

No external ADRs exist; PROJECT.md + REQUIREMENTS.md + STATE.md are authoritative.

</canonical_refs>

<scope>
## In / Out of Scope

**In scope:**
- `MapBitmap` consumes a continuous `map→base_link` source (slam-pose-store as anchor + odometry-store for inter-update interpolation) and offsets the grid draw so the grid stays world-fixed under the moving robot
- New robot-cursor overlay: filled circle + heading line (12 px) drawn at current `base_link` pose in map frame, constant pixel size, orange (`#f97316`) with 1 px white outline, updates at EKF rate (~30 Hz)
- `useMapStore` extended with `epoch: number | null` and a `setEpoch(n)` action
- `localStorage` persistence: write OccupancyGrid as JSON under key `mowerbot.map.epoch.<N>` whenever `updateMap()` fires; on page mount, read latest epoch from server, look up matching key, rehydrate; on epoch mismatch, drop all `mowerbot.map.*` keys
- Server-side epoch state in `.planning/state/map-epoch.json` (atomic write via temp + rename)
- New API routes:
  - `GET /api/map/epoch` → `{ epoch: number, resetAt: string }`
  - `POST /api/map/reset` → optimistic-clear ack from server; honest-await for first new `/map` publish before signalling success
- Eraser onClick replaced: optimistic `useMapStore.clear()` + `POST /api/map/reset` + branched UI (success toast vs inline error banner with retry)
- Quota handling: `try/catch` on `setItem`, on `QuotaExceededError` disable persistence for that session + show inline banner

**Out of scope (explicitly deferred — already locked in REQUIREMENTS.md):**
- IndexedDB storage (5 MB localStorage quota measured sufficient for current yard)
- Browser-only reset (slam_toolbox would re-publish, misleading)
- `ros3djs` / `ros2djs` (Canvas 2D stays primitive)
- Map serialization across reboots (slam_toolbox serialize/deserialize) — future post-v2.2
- Multi-tab reset coordination (one operator per session is the operating assumption)
- `/tf` subscription with full tf2 tree composition

</scope>

<decisions>
## Implementation Decisions

### map→base_link source (D-01..D-03)

- **D-01:** **Composite source.** `slam-pose-store` provides the map-frame anchor (last `/pose`); `useOdometryStore` provides inter-update odom deltas (~30 Hz). MapBitmap and the cursor consume `mapFramePose = lastSlamPose ⊕ (currentOdom − odomAtSlamPoseTime)`.
- **D-02:** Cache `odomAtSlamPoseTime` whenever `slam-pose-store.updatePose()` fires — store the matching odom snapshot at that moment as the "anchor odom". Inter-update positions then derive cleanly.
- **D-03:** If `/pose` has been silent >2 s (slam-pose-store badge state would already be yellow/red), render the cursor with the same color desaturation the badge uses — operator sees "yaw is uncertain, position is dead-reckoned from EKF". Don't hide the cursor; degrading visual is more useful than vanishing it.

### Robot cursor visual (D-04..D-06)

- **D-04:** **Filled circle + heading line.** `r = 6 px` filled circle (orange `#f97316`), 1 px white outline (`#ffffff`), 12 px heading line out of center pointing in yaw direction (also orange, 1.5 px stroke). Constant pixel size regardless of zoom.
- **D-05:** Heading derived from quaternion in `/pose.pose.orientation` via the same `atan2(2(wz+xy), 1-2(y²+z²))` we already use in `scripts/yaw-drift-test.sh`.
- **D-06:** No covariance ellipse this phase. Operator already sees Phase 7's yaw-quality badge and the GPS-quality % — adding a third uncertainty visual would be noise. Tracked in deferred ideas.

### Epoch + persistence format (D-07..D-12)

- **D-07:** **Server-side counter** in `data/map-epoch.json` of shape `{ "epoch": <int>, "resetAt": "<ISO8601>" }`. Initial value: `{ epoch: 0, resetAt: <createdAt> }` written on first GET if file missing.
  - Path **corrected from `.planning/state/...` to `data/...`** post-research: `.planning/` is not mounted into `mower-web`; `data/` is the existing volume used by `data/zones.json`, `data/config.json`, `data/missions.json`. Same lazy-init pattern as `readConfig()` in `web/app/api/config/route.ts`.
- **D-08:** Atomic write: write to `<path>.tmp` then `fs.rename` — POSIX atomic on ext4. Avoids torn reads.
- **D-09:** **GET `/api/map/epoch`** returns the JSON verbatim. No-cache headers. Called by client on mount and on every reconnect of the rosbridge socket (cheap).
- **D-10:** **localStorage key:** `mowerbot.map.epoch.<N>` where `<N>` is the integer epoch. Value: `JSON.stringify(occupancyGrid)` — unaltered roslib message including header, info, and the data Int8Array (which serializes as a regular number array; Int8Array reconstruction happens in MapBitmap).
- **D-11:** **Rehydration sequence on mount:**
  1. `GET /api/map/epoch` → `serverEpoch`
  2. Read `mowerbot.map.epoch.<serverEpoch>` from localStorage
  3. If hit → set `useMapStore.latest` immediately, mark `isStale: true` (so MapBitmap shows it dimmed) until next `/map` arrives
  4. Drop all `mowerbot.map.*` keys whose suffix `< serverEpoch` (cleanup of old epochs)
  5. Wait for next `/map`; on receipt, replace
- **D-12:** **Quota:** wrap every `setItem` in `try/catch`. On `QuotaExceededError`: set a `persistenceDisabled` flag in `useMapStore`, show a one-time inline banner under the map "Persistierung deaktiviert (Speicher voll). Karte erscheint nach F5 leer." Operator can clear browser storage manually if they care.

### Reset mechanism (D-13a — added post-research)

- **D-13a:** **slam_toolbox 2.6.10 has no `/reset` service.** Reset is implemented via `serialize_map` once (Wave 0 generates `config/empty.posegraph` + `config/empty.data` from a freshly-restarted slam container) + `deserialize_map` on every reset (slam_toolbox loads the empty state and reverts internal pose graph). Preserves the Phase 6 `docker.sock:ro` security boundary (vs. the alternative Option A which would have required `:rw` + dockerode `container.restart`). Reset is fast (single ROS service call, no container restart wait).
  - Reject Option A (docker container restart): would regress Phase 6's `:ro` security boundary
  - Reject Option C (slam_toolbox version upgrade): out of milestone scope

### Reset endpoint contract + failure UX (D-13..D-18)

- **D-13:** **POST `/api/map/reset`** body: empty (no confirmation token — trusted-LAN, deliberate Eraser click is the gate). Returns one of:
  ```json
  // success
  { "ok": true, "epoch": 7, "mapReceived": true, "elapsedMs": 1842 }
  // service unreachable
  { "ok": false, "stage": "service", "error": "slam_toolbox/reset call failed: <reason>" }
  // service ok, but no /map within 3 s
  { "ok": false, "stage": "mapTimeout", "epoch": 7, "error": "Reset acknowledged but no fresh /map within 3000ms" }
  ```
- **D-14:** **Server flow:**
  1. Call `slam_toolbox/reset` (std_srvs/Empty) via rosbridge — same path as the current client-side Eraser; refactor into a shared helper
  2. On service success → atomically bump epoch in `.planning/state/map-epoch.json` (`epoch += 1`, `resetAt = now()`)
  3. Subscribe `/map` once with a 3 s timeout; resolve `mapReceived: true` on receipt, else fall through to `mapTimeout`
  4. Return JSON
- **D-15:** **Atomic concern:** if service succeeds but file write fails (disk full, permission), the slam_toolbox is reset but the epoch isn't bumped — client thinks nothing happened. Mitigation: file write happens BEFORE service call; if write fails, return early without resetting slam. Operator sees error, retries, idempotent.
- **D-16:** **UI flow on Eraser click:**
  1. `useMapStore.clear()` immediately (optimistic, current behavior)
  2. `useMapStore.setItem(...)` for new empty entry once the new epoch arrives
  3. POST `/api/map/reset`
  4. On `{ok:true}` → small success toast "Karte zurückgesetzt" (3 s auto-dismiss); update store epoch
  5. On `{ok:false, stage:"service"}` → inline red banner under Eraser button with concrete error + Retry button; do NOT auto-recover (operator needs to investigate slam container)
  6. On `{ok:false, stage:"mapTimeout"}` → inline yellow banner "Reset durchgeführt, aber slam_toolbox publisht keine neue Karte. Container check: `docker logs mower-slam`." Epoch IS already bumped in this case, so client must update its epoch too — no resurrection.
- **D-17:** **No false-success path.** The optimistic-clear in step 1 is reverted ONLY if step 5 fires (service stage failure). For mapTimeout, the operator already saw the wipe; the banner explains the half-state.
- **D-18:** **Reset honesty regression:** add an integration check in `/api/map/reset` that confirms it actually invoked the slam service (not just the Next.js handler). Logged as `[map-reset] epoch N→N+1 service:ok mapReceived:true 1842ms` for the operator to grep in `/logs`.

### Claude's Discretion (planner may decide without re-asking)

- Exact quaternion → yaw helper location (probably `web/lib/utils/quaternion.ts` since it'll be shared by drift script analog + cursor)
- Toast component pick (existing `radix-ui` + sonner already wired? or use an inline `<div>` matching the connection-state badge aesthetic)
- File-locking strategy for `.planning/state/map-epoch.json` if concurrent resets become a concern (probably not — single operator, single Eraser, sequential clicks). Default: trust POSIX rename atomicity.
- Whether the rehydrated localStorage map shows a "rehydrated, awaiting fresh data" badge or just renders dimmed via existing `isStale` flag
- Cleanup of `mowerbot.map.epoch.*` keys: drop all `< current` on every mount, or also on every reset response

</decisions>

<specifics>
## Specific Ideas

- **Cursor color matches `#f97316` (lucide orange)** — same family as Phase 7 yaw badge yellow/orange path; visually obvious it's the live robot, not a static marker.
- **localStorage key namespace `mowerbot.map.*`** — easy to grep + clear from devtools, doesn't pollute generic keys.
- **3 s `mapTimeout` budget** in `/api/map/reset` matches `slam_toolbox` `map_update_interval: 2.0` plus a 1 s slack — well-tuned to slam_toolbox cadence per `config/slam_toolbox_params.yaml`.
- **No multi-tab coordination.** Operator workflow is one tab on one device; if two tabs are open and one resets, the other's next mount will detect the epoch bump and rehydrate cleanly.
- **MapBitmap subtraction math** lives in MapBitmap, not in the store. Store stays a passive cache; rendering decides where pixels go.

</specifics>

<success_criteria>
## Success Criteria (from ROADMAP — all five must be observable)

1. On `/lidar`, driving the robot makes the occupancy grid scroll under a world-fixed reference while the grid stays geometrically aligned to real walls (map-frame anchor, not odom-frame)
2. A robot-cursor (filled circle + heading line) is rendered on `/lidar` at the current `base_link` pose in the map frame, updating live as TF/odom updates
3. Operator reloads `/lidar` (F5) and the previously-rendered occupancy grid rehydrates instantly from localStorage; replaced by the next live `/map` if its epoch matches the server's
4. Operator clicks Eraser → `/api/map/reset` invokes the slam_toolbox reset service, bumps the map epoch, and the client clears localStorage; a subsequent F5 shows a fresh empty grid (no stale resurrection)
5. If the reset endpoint cannot verify slam is alive and reset succeeded, it returns a structured failure and the UI surfaces it (no false-success toast)

Plus design-driven verification:
- `mowerbot.map.epoch.<N>` keys present after first `/map` arrives and after reset
- `.planning/state/map-epoch.json` exists, shape `{ epoch: int, resetAt: ISO }`, written atomically (no half-files visible during write)
- `web/server.mjs` is unchanged in this phase (regression gate from Phase 6)

</success_criteria>

<deferred_ideas>
## Deferred Ideas

Ideas that came up during discussion but belong to other phases / future milestones:

- **Covariance ellipse around cursor** — diagnostic-quality uncertainty visualization. Useful when SLAM divergence becomes a concern; until then, the Phase 7 badge already signals it.
- **Full /tf subscription with tf2 in JS** — complete TF tree, would let us drop the slam-pose + odom-delta composite. Considered; rejected as v1 overkill. Revisit if more frames need consuming on the web side.
- **IndexedDB migration** — already in REQUIREMENTS.md §Future; only triggered if measured grid sizes blow past 5 MB.
- **slam_toolbox map serialization across reboots** — already in REQUIREMENTS.md §Future; lets the mower keep its map across container restarts, not just F5.
- **Multi-tab reset coordination** — broadcast channel or shared worker. Not needed for v2.2; revisit if multiple operators ever supervise simultaneously.
- **Confirmation token on /api/map/reset** — trusted-LAN posture makes it unnecessary. Add if the dashboard ever leaves the LAN.
- **Reset undo** — restore the last grid pre-reset. Requires keeping the prior map under a "shadow" key. Cool but expensive.

</deferred_ideas>

---

*Phase: 08-lidar-map-anchor-persistence-honest-reset*
*Context gathered: 2026-04-17*
*Downstream consumers: gsd-phase-researcher, gsd-planner*
