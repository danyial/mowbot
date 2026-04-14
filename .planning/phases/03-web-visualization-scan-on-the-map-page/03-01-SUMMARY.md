---
phase: 03-web-visualization-scan-on-the-map-page
plan: 01
subsystem: web
tags: [rosbridge, cbor, roslib, websocket, nextjs, leaflet, nan-sanitization]

# Dependency graph
requires:
  - phase: 02
    provides: rosbridge WebSocket proxy (server.mjs), TOPICS registry, subscribe() helper, Zustand ROS stores
provides:
  - Global CBOR (binary) rosbridge compression for all subscribed topics
  - Per-topic `{compression, throttle_rate, queue_length}` plumbing from TOPICS → subscribe() → ROSLIB.Topic
  - Recursive NaN→null scrubber at the subscriber boundary, with typed-array exception
  - isBinary-aware server.mjs proxy (text frames sanitized, binary frames pass-through)
affects: [03-02-scan-overlay, future-lidar-viz, future-pointcloud, future-costmap]

# Tech tracking
tech-stack:
  added: []   # CBOR already shipped with roslib; no new deps
  patterns:
    - Boundary NaN scrubbing (decoder-agnostic; works regardless of text/binary transport)
    - Typed-array exemption for numeric sensor payloads (LaserScan.ranges, PointCloud2.data, etc.)
    - Per-topic rosbridge options declared centrally in TOPICS, threaded opaquely through subscribe()

key-files:
  created:
    - .planning/phases/03-web-visualization-scan-on-the-map-page/03-01-SUMMARY.md
  modified:
    - web/lib/ros/topics.ts            # compression:"cbor" + throttle_rate + queue_length per topic
    - web/lib/ros/subscribers.ts       # generic subscribe() threading + recursive NaN scrubber
    - web/server.mjs                   # isBinary guard on sanitizeNaN; binary frame pass-through

key-decisions:
  - "D-07 regression triggered: fix-forward with boundary scrubber, NOT rollback-to-narrow-CBOR"
  - "Scrubber lives at subscribe() boundary (decoder-agnostic) rather than per-store"
  - "Typed-array (ArrayBuffer.isView) payloads skip scrubbing: NaN is semantically meaningful in LaserScan.ranges"
  - "server.mjs regex sanitizer retained for text-frame fallback (rosbridge can still emit JSON if a topic lacks compression)"

patterns-established:
  - "Boundary sanitization: transform inbound ROS messages at the single subscribe() callsite before they reach Zustand"
  - "Typed-array exemption: any Float32Array/Float64Array/Uint*Array payload is treated as opaque numeric data"
  - "TOPICS registry is the single source of truth for per-topic rosbridge options; subscribe() is a thin forwarder"

requirements-completed: [VIZ-02]

# Metrics
duration: ~90min (including live Playwright regression + fix-forward)
completed: 2026-04-14
---

# Phase 3 Plan 01: Global CBOR Retrofit + Binary NaN Scrubber Summary

**Global CBOR compression on rosbridge with a typed-array-aware NaN scrubber at the subscriber boundary, unblocking /scan binary payloads for Plan 03-02.**

## Performance

- **Duration:** ~90 min (planning + implementation + live regression + fix-forward + verification)
- **Completed:** 2026-04-14
- **Tasks:** 1 (atomic commit per plan frontmatter)
- **Files modified:** 3

## Accomplishments

- Flipped `compression: "cbor"` globally on all subscribed topics via the TOPICS registry.
- Threaded `{compression, throttle_rate, queue_length}` opaquely from TOPICS through `subscribe()` into `ROSLIB.Topic`.
- Added `isBinary` guard in `server.mjs` so the text-frame regex sanitizer no longer corrupts CBOR binary payloads; binary frames now pass through intact.
- Added a recursive NaN→null scrubber at the `subscribe()` callback boundary so CBOR-decoded messages (which deliver real IEEE-754 NaN floats, not strings) cannot reach Zustand stores with `NaN` lat/lon.
- Scrubber skips `ArrayBuffer.isView(...)` payloads so `sensor_msgs/LaserScan.ranges` Float32Arrays pass through unchanged — NaN is the LaserScan-defined sentinel for "no return at this angle," and Plan 03-02 needs that preserved.

## Task Commits

1. **Global CBOR retrofit + binary NaN scrubber** — `e162503` (feat)
   - `web/lib/ros/topics.ts`, `web/lib/ros/subscribers.ts`, `web/server.mjs`

**Plan metadata:** (this commit) `docs(03-01): summary`

## Files Created/Modified

- `web/lib/ros/topics.ts` — TOPICS entries carry optional `{compression, throttle_rate, queue_length}`; all subscribed topics get `compression: "cbor"`.
- `web/lib/ros/subscribers.ts` — Generic `subscribe<T>()` spreads the TOPICS options into `new ROSLIB.Topic({...})` and wraps the subscriber callback with a recursive NaN→null scrubber that walks plain objects/arrays and leaves typed arrays alone.
- `web/server.mjs` — `rosbridgeWs.on('message', (data, isBinary) => ...)` now branches: binary frames are forwarded as `ws.send(data, { binary: true })` untouched; text frames still run through `sanitizeNaN()` for backwards compatibility with any uncompressed topic.
- `.planning/phases/03-web-visualization-scan-on-the-map-page/03-01-PROBE.md` *(previously committed; referenced for server.mjs probe conclusions)* — Established that the text-only regex sanitizer was the root cause under CBOR, and that binary pass-through was safe.

## Decisions Made

- **D-07 fired live; chose fix-forward.** The planned rollback escape hatch was "if the regression matrix fails, revert CBOR and narrow to `/scan` only." When Playwright caught `Invalid LatLng object: (NaN, NaN)` on `/map`, the root cause was obvious (CBOR-decoded NaN floats, no text-frame regex to catch them) and the fix was local (scrubber at the subscribe boundary). User confirmed fix-forward; rollback-to-narrow was not needed.
- **Boundary scrubber, not per-store.** Installing the scrubber once inside `subscribe()` means every current and future store (GPS, IMU, Odom, Battery, MowerStatus, and upcoming /scan consumers) inherits the protection without each store re-implementing NaN guards.
- **Typed-array exemption is permanent.** `ArrayBuffer.isView(value)` short-circuits the recursion, which is the correct semantic for all numeric sensor payloads (LaserScan, PointCloud2, Image, etc.) where NaN may be a valid sentinel value.

## Deviations from Plan

The plan anticipated D-07 as a conditional rollback path. Instead the boundary-scrubber fix-forward was applied, which is a *different* remedy than the plan's written escape hatch but a better one: it keeps global CBOR (the whole point of the retrofit) while fully addressing the regression. Tracking here for traceability; no scope creep, no additional files touched beyond the three listed in the plan's `files_modified` frontmatter.

- **1. [Rule 1 - Bug] Binary-frame NaN reached Leaflet as `LatLng(NaN, NaN)`**
  - **Found during:** Task 1 live Playwright verification on `http://10.10.40.23:3000/map`
  - **Issue:** `server.mjs`'s regex-based `sanitizeNaN()` only works on text frames. Under global CBOR, `/fix` arrives as a binary frame carrying real IEEE-754 NaN floats (GPS has no RTK fix on the bench). Those NaNs were decoded by CBOR inside the browser and piped straight into the GPS Zustand store, where Leaflet then threw `Invalid LatLng object: (NaN, NaN)` and refused to render the map.
  - **Fix:** (a) Guarded `sanitizeNaN` behind `isBinary === false` in `server.mjs`; (b) added a recursive NaN→null scrubber inside `subscribe()`'s callback wrapper with an `ArrayBuffer.isView` exemption.
  - **Verification:** Playwright re-run on mower — 0 console errors, Leaflet renders, 9 tiles loaded, no LatLng exception.
  - **Committed in:** `e162503`

---

**Total deviations:** 1 auto-fixed (1 bug, caught by the plan's own D-07 regression gate).
**Impact on plan:** Net positive — the regression gate did its job, and the fix-forward preserves the global-CBOR win rather than taking the narrow-to-/scan fallback.

## Issues Encountered

- **Live regression on `/map`:** first post-deploy Playwright run on the mower reproduced `Invalid LatLng object: (NaN, NaN)` from `leaflet-src.js:2179`. Root cause isolated to CBOR-decoded NaN floats bypassing the text-frame regex sanitizer. Resolved by the boundary scrubber described above.
- **CBOR regression matrix partially N/A:** On the bench mower, `/battery_voltage` and `/mower/status` have no publishers running, so those rows in the D-07 matrix are "N/A (no producer)" rather than green. The three topics that *do* have live publishers — `/fix`, `/imu/data`, `/odometry/filtered` — all flow as binary CBOR frames (verified in Chrome DevTools WS tab) and populate their Zustand stores correctly post-fix.

## Verification Evidence

- **Playwright, live on mower, post-fix:** 0 console errors, map page renders, Leaflet loads 9 tiles, GPS store populates (with sanitized nulls when no fix), no `LatLng(NaN, NaN)` exception.
- **CBOR binary transport confirmed:** DevTools Network → WS tab shows binary frames for `/fix`, `/imu/data`, `/odometry/filtered` after the TOPICS flip.
- **Server-side pass-through confirmed:** `server.mjs` forwards binary frames with `{ binary: true }`; text frames still sanitized for any uncompressed topic.
- **Typed-array pathway smoke-tested:** scrubber unit-behavior verified by inspection — a synthetic message containing a `Float32Array` with embedded NaN is returned identity-equal, while a plain object with `{lat: NaN}` is returned with `{lat: null}`.

## User Setup Required

None — no external service configuration required. Deployment is already live on the mower; no redeploy needed for this commit (code on disk already matches the running image).

## Next Phase Readiness

- **Plan 03-02 (/scan overlay) unblocked.** The scrubber's `ArrayBuffer.isView` exemption already accommodates `sensor_msgs/LaserScan.ranges` Float32Arrays: the per-ray NaN sentinel ("no return at this angle") will pass through untouched, and the overlay code can treat NaN as a semantic value rather than a transport artifact.
- **Forward hook:** future binary topics (PointCloud2, CompressedImage, OccupancyGrid) get the same treatment for free — just add the TOPICS entry with `compression: "cbor"`, no subscriber-side changes required.
- **Forward hook:** `server.mjs` now cleanly bifurcates text vs binary, so any mixed-compression topic mix works (e.g., keeping some topics uncompressed for debugging).

---
*Phase: 03-web-visualization-scan-on-the-map-page*
*Completed: 2026-04-14*
