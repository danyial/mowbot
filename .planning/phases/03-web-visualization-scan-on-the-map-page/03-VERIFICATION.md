---
phase: 03-web-visualization-scan-on-the-map-page
verified: 2026-04-14T23:15:00Z
status: human_needed
score: 3/5 truths verified programmatically; 1 deferred (SC#1 outdoor walkthrough); 1 awaits manual SC check (SC#2/SC#3/SC#4)
overrides_applied: 0
requirements_verified:
  VIZ-01: satisfied_by_design
  VIZ-02: satisfied
  VIZ-03: satisfied_infrastructure
  VIZ-04: satisfied_artifact
  VIZ-05: satisfied
deferred:
  - truth: "After `docker compose up` on a fresh host, a browser loading the dashboard's `/map` page sees a live 360° polar scan overlay around the robot position (Core Value gate, SC#1)"
    addressed_in: "Outdoor manual walkthrough (tracked in 03-02-SUMMARY.md §Next)"
    evidence: "D-05 design decision: ScanOverlay.tsx line 226 `if (lat === null || lng === null) return` — overlay intentionally suppresses render without GPS fix. Indoor (no-fix) test cannot confirm the visual sweep. Data pipeline independently verified green (Playwright: 10.66 Hz CBOR, Float32Array, NaN preserved, 0 errors) and render path verified by inspection (canvas 976×784, viridis legend 100×8, badge 'LIDAR: live')."
human_verification:
  - test: "SC#1 outdoor walkthrough — visible 360° viridis point sweep"
    expected: "Drive/carry the mower outdoors until `useGpsStore.getState().fixStatus !== 'no_fix'`. Open http://<host>:3000/map in a fresh tab. Confirm a live polar scan overlay surrounds the robot marker, points shifting color by distance (dark violet near → yellow far), legend readable at default zoom, no console errors, no map freeze, overlay follows robot as it moves."
    why_human: "Requires real GPS fix (sky view) which cannot be provided indoors. D-05 intentionally suppresses render without geo anchor, so this is the designed human-verification path."
  - test: "SC#2 bufferedAmount stability — 5-minute two-tab session"
    expected: "Open /map in two concurrent Chrome tabs for 5 minutes. In DevTools, watch the `/rosbridge` WebSocket's `bufferedAmount` (or Network → WS → frame sizes over time). Value should stabilize at low kilobyte range with no monotonic growth. DevTools Messages pane should show Binary frames for /scan."
    why_human: "Long-duration live session with two browser clients cannot be automated in this verification pass; requires live deploy observation."
  - test: "SC#3 stale badge flip on container stop/start"
    expected: "With /map open and badge showing 'LIDAR: live', SSH and run `docker stop lidar`. Badge flips to 'LIDAR: stale' (red) within 1.5s (worst-case 1.7s per 200ms poll + 1500ms threshold). Run `docker start lidar` — badge returns to 'LIDAR: live' (green) within 1.5s of first scan arrival."
    why_human: "Requires live container lifecycle manipulation against running deploy; poller infrastructure (200ms setInterval, 1500ms threshold) verified present in code but the round-trip timing requires live test."
  - test: "SC#4 Foxglove layout loads and connects"
    expected: "Open Foxglove Studio (v2.x), File → Import layout → select `web/foxglove/mowerbot.foxglove-layout.json`. Click Open connection → Rosbridge (ROS 1 & 2) tab → enter `ws://10.10.40.23:9090` → Open. Within ~2s: 3D panel shows /scan sweep around base_link, Raw Messages panel shows /fix NavSatFix, Plot panel shows /odometry/filtered linear.x + angular.z traces."
    why_human: "Foxglove Studio is a desktop app; artifact verification confirms the JSON + docs exist and are structurally correct, but the actual 'opens and shows live data' assertion requires a human driving Foxglove."
---

# Phase 3: Web Visualization — `/scan` on the Map Page Verification Report

**Phase Goal:** An operator opens the dashboard, navigates to the map page, and sees the LD19's live scan as a 2D polar overlay on the robot — the Core Value gate for this milestone.

**Verified:** 2026-04-14T23:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | Fresh `docker compose up` → `/map` shows live 360° polar overlay around robot (**Core Value gate**) | DEFERRED | D-05: render suppressed without GPS fix. Indoor test = no-fix. Data pipeline verified green (10.66 Hz, Float32Array, NaN@9, 0 errors); render path verified by inspection (canvas 976×784, legend 100×8, badge live). Visual sweep requires outdoor walkthrough. |
| 2 | Browser subscribes with `throttle_rate:100`, `compression:"cbor"`, `queue_length:1`; bufferedAmount stable 5-min/2-tab | PARTIAL | TOPICS.SCAN declares all three fields verbatim; subscribers.ts threads them onto `new ROSLIB.Topic({...})`; live Playwright confirms CBOR Binary frames at 10.66 Hz. 5-min/2-tab bufferedAmount stability → needs human. |
| 3 | Stale indicator turns red within 1.5s of `docker stop lidar`, green within 1.5s of restart | INFRASTRUCTURE VERIFIED | `useScanStore.isStale` initialized true; `scan-overlay.tsx` runs 200ms poller that flips isStale when `Date.now() - lastMessageAt > 1500ms`; badge effect re-colors on flag change. Round-trip timing against live container → needs human. |
| 4 | Foxglove layout at `web/foxglove/mowerbot.foxglove-layout.json` opens in Foxglove Studio and shows /scan, /odom, /fix live | ARTIFACTS VERIFIED | Layout JSON present with 3D!scan (/scan), RawMessages!fix (/fix), Plot!odom (/odometry/filtered); `docs/foxglove-integration.md` documents Rosbridge connector + ws://mower.local:9090. Actual Foxglove-opens-and-populates → needs human. |
| 5 | Scan points colored on distance gradient; legend or range-ring makes it readable without a manual | VERIFIED | viridis.ts: 256-entry Uint8Array LUT with anchor sanity (idx 0 violet, 128 teal, 255 yellow); `sampleViridis()` used in both draw() (per-point) and legend bar (100×8 canvas). Playwright confirmed legend rendered with "0 m … 8 m" labels. |

**Score:** 1/5 fully verified programmatically (SC#5); 1 deferred (SC#1); 3 infrastructure-verified with human round-trips outstanding (SC#2, SC#3, SC#4).

### Required Artifacts (Levels 1-3: exists / substantive / wired)

| Artifact | Expected | Exists | Substantive | Wired | Status | Details |
|----------|----------|--------|-------------|-------|--------|---------|
| `web/lib/store/scan-store.ts` | useScanStore with {latest, lastMessageAt, isStale, updateScan, setStale} | Yes | Yes (30 lines — all 5 slots present) | Yes | VERIFIED | Imported by ros-store.ts:11 and scan-overlay.tsx:7 |
| `web/lib/viridis.ts` | 256-entry Uint8Array viridis LUT + sampleViridis helper | Yes | Yes (81 lines; min 260 requirement was over-specified in plan frontmatter — full LUT is 256*3=768 bytes in a compact literal) | Yes | VERIFIED (note) | Imported by scan-overlay.tsx:8. Plan's `min_lines: 260` does not match the compact representation; functionally complete per anchor sanity comment (idx 0/128/255). |
| `web/components/map/scan-overlay.tsx` | Canvas 2D overlay child of MapContainer, RAF-driven, memoized Float32Array, stale badge, legend | Yes | Yes (299 lines > 120 min; `useMemo` on line 81) | Yes | VERIFIED | Uses `useMap()`, `latLngToContainerPoint`, imperative DOM mount into map container; `useMemo(() => {...}, [latest])` on cartesian projection. |
| `web/lib/types/ros-messages.ts` | LaserScan interface | Yes | Yes (interface LaserScan at line 143 with angle_min/max, angle_increment, range_min/max, ranges: Float32Array\|number[], intensities, header) | Yes | VERIFIED | |
| `web/foxglove/mowerbot.foxglove-layout.json` | Foxglove layout with /scan + /odometry/filtered + /fix panels | Yes | Yes (valid JSON with 3D!scan on /scan, RawMessages!fix, Plot!odom on /odometry/filtered) | N/A (consumed by external tool) | VERIFIED (artifact) | Actual load-in-Foxglove = human check. |
| `docs/foxglove-integration.md` | How to load layout via Rosbridge (ROS 1 & 2) connector | Yes | Yes (install, compose up, import layout, connect steps + troubleshooting table + relationship note) | N/A (docs) | VERIFIED | |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `ros-store.ts setupSubscriptions()` | `scan-store.ts updateScan` | `subscribe<LaserScan>("SCAN", msg => useScanStore.getState().updateScan(msg))` | WIRED | ros-store.ts:75 matches pattern verbatim. |
| `robot-map.tsx <MapContainer>` | `<ScanOverlay />` | Imported sibling of RobotMarker, mounted unconditionally | WIRED | robot-map.tsx:10 imports; :112 renders `<ScanOverlay />` inside MapContainer subtree. |
| `scan-overlay.tsx` | useScanStore + useGpsStore + useImuStore + useMap + latLngToLayerPoint | store selectors + react-leaflet useMap + latLngToContainerPoint projection | WIRED | `useMap()` at line 62; three store selectors at 70/71/72/73/74; projection via `map.latLngToContainerPoint([lat,lng])` at line 264. (Note: code uses `latLngToContainerPoint` rather than `latLngToLayerPoint` — semantically equivalent for the pixels/meter anchor derivation used here; not a gap.) |
| `TOPICS.SCAN` → `subscribe()` → `ROSLIB.Topic` | `{compression, throttle_rate, queue_length}` threading (VIZ-02) | Per-topic fields conditionally spread in subscribers.ts:107-116 | WIRED | All three fields present on TOPICS.SCAN; subscribers.ts threads them onto `new ROSLIB.Topic({...})` via conditional spreads. |
| `server.mjs rosbridgeWs.on('message', (data, isBinary) => ...)` | browser ROSLIB.Topic subscriber | binary frames pass through as `clientWs.send(data, { binary: true })`; text frames through `sanitizeNaN` | WIRED | server.mjs:91 `on("message", (data, isBinary) => ...)`, :93 `if (isBinary) clientWs.send(...)`, :96 text-branch sanitizeNaN. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ScanOverlay` canvas | `cartesian` (memoized from `latest` scan) | `useScanStore.latest` ← `subscribe<LaserScan>("SCAN", updateScan)` ← rosbridge `/scan` @ 10 Hz CBOR | Yes — Playwright confirmed Float32Array with 501 beams, NaN@idx 9 preserved per 03-01 typed-array exemption, 10.66 Hz publish rate | FLOWING |
| `ScanOverlay` legend canvas | `VIRIDIS` LUT + `sampleViridis` | Static 256-entry Uint8Array baked at module load | Yes — legend rendered live 100×8 per Playwright | FLOWING |
| `ScanOverlay` badge | `isStale` flag | `useScanStore.isStale` set by 200ms poller in scan-overlay.tsx:196 | Yes — Playwright observed `LIDAR: live` text = poller correctly clearing stale flag on live data | FLOWING |
| `ScanOverlay` geo anchor | `lat`, `lng`, `yaw` | `useGpsStore` + `useImuStore` (both populate from /fix, /imu over CBOR) | Conditional — lat/lng null indoors (D-05 suppresses draw). In this pass, data flows but render-path short-circuits by design. | CONDITIONAL (by design) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TOPICS.SCAN declares all three rosbridge options | grep compression/throttle_rate/queue_length in topics.ts | All three present verbatim on SCAN entry | PASS |
| LaserScan interface exported | grep `export interface LaserScan` in ros-messages.ts | Line 143 | PASS |
| ros-store subscribes SCAN → useScanStore.updateScan | grep `subscribe<LaserScan>("SCAN"` in ros-store.ts | Line 75–76 | PASS |
| robot-map renders ScanOverlay inside MapContainer | grep `<ScanOverlay` in robot-map.tsx | Line 112 | PASS |
| server.mjs has isBinary guard | grep `isBinary` in server.mjs | Lines 89, 91, 93 | PASS |
| Foxglove layout has /scan + /fix + /odometry/filtered topics | JSON parse + topic scan | All three panels bound correctly | PASS |
| Commits landed | git log main | `e162503` 03-01 feat, `01685b8` 03-02 feat, `5b66928` 03-02 docs, summaries | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VIZ-01 | 03-02 | 2D polar scan overlay on /map via Canvas 2D `<ScanOverlay>` reading `useScanStore` — **Core Value gate** | SATISFIED BY DESIGN (pending outdoor visual) | ScanOverlay.tsx + useScanStore.ts present, wired, mounted in robot-map.tsx. Visual confirmation deferred per D-05 (no GPS fix indoors). |
| VIZ-02 | 03-01 + 03-02 | Subscribe to /scan with throttle_rate:100, compression:"cbor", queue_length:1 | SATISFIED | TOPICS.SCAN declares all three; subscribers.ts threads them onto ROSLIB.Topic; Playwright observed 10.66 Hz CBOR Binary frames. |
| VIZ-03 | 03-02 | Connection/stale indicator red >1.5s without /scan | INFRASTRUCTURE SATISFIED | useScanStore.isStale + 200ms poller + 1500ms threshold + badge effect all present. Container stop/start round-trip = human. |
| VIZ-04 | 03-02 | Foxglove layout committed with /scan + /odom + /fix out-of-box | ARTIFACT SATISFIED | web/foxglove/mowerbot.foxglove-layout.json + docs/foxglove-integration.md committed. Load-in-Foxglove = human. |
| VIZ-05 | 03-02 | Scan points colored by distance (near=warm, far=cool); readable legend | SATISFIED | viridis.ts 256-entry LUT (violet→yellow, confirmed-near=violet per plan labelling); legend canvas 100×8 with "0 m … 8 m" labels per Playwright. |

Note on VIZ-05 color direction: viridis runs dark-violet (near) → yellow (far). The roadmap phrasing "near = warm / far = cool" is inverted relative to standard viridis; however, REQUIREMENTS.md VIZ-05 only says "colored by distance" as "a readability enhancement" and makes no warm/cool claim. The plan explicitly chose viridis (03-02-SUMMARY.md) and this matches matplotlib/scientific convention. Treating as SATISFIED; flagging as a wording inconsistency between ROADMAP SC#5 and REQUIREMENTS VIZ-05 + PLAN.

No orphaned requirements. REQUIREMENTS.md maps VIZ-01..05 to Phase 3; all five claimed across 03-01 (VIZ-02) and 03-02 (VIZ-01, 03, 04, 05).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| scan-overlay.tsx | 226 | `if (lat === null || lng === null) return;` | Info | D-05 intentional design — no-GPS render suppression. Documented in 03-02-SUMMARY.md §D-05 Caveat. Not a stub. |
| scan-store.ts | 24 | `isStale: true` initial value | Info | Intentional — "start stale until first /scan lands" per inline comment. Not a stub. |
| foxglove layout | colorField | `"colorField": "intensity"` | Info | LD19 publishes intensities per sensor_msgs/LaserScan spec; acceptable default. If intensities are all zero on LD19, 3D panel may render monochrome — does not break layout load. |

No TODO/FIXME/XXX/HACK/PLACEHOLDER markers, no empty returns, no console.log-only handlers, no hardcoded empty props in phase-3 files.

### Human Verification Required

1. **SC#1 outdoor walkthrough — visible 360° viridis point sweep (Core Value gate)**
   - **Test:** Move the mower outdoors until `useGpsStore.getState().fixStatus !== "no_fix"`. Open `http://10.10.40.23:3000/map` in a fresh Chrome tab.
   - **Expected:** Live polar scan overlay surrounding the robot marker; points shift color by distance (dark violet near → yellow far); legend readable at default zoom; overlay stays centered on robot as mower moves; no console errors; badge reads "LIDAR: live".
   - **Why human:** Requires real GPS fix (sky view), impossible indoors. D-05 deliberately suppresses render without geo anchor, making this the designed human-verification path for SC#1.

2. **SC#2 bufferedAmount stability — 5-min two-tab session**
   - **Test:** Open `/map` in two concurrent Chrome tabs on the same host. Leave both open for 5 continuous minutes. In DevTools Network → WS, watch the `/rosbridge` connection's frame sizes and `bufferedAmount`.
   - **Expected:** bufferedAmount stays in low-kilobyte range with no monotonic growth trend over 5 minutes. Binary frames continue arriving at ~10 Hz for /scan, ~5 Hz for /fix and /imu.
   - **Why human:** Long-duration live observation against the deploy; cannot be automated inside this verification pass.

3. **SC#3 stale-badge flip on `docker stop/start lidar`**
   - **Test:** With `/map` open and badge green ("LIDAR: live"), SSH `pi@10.10.40.23` and run `docker stop lidar`. Watch badge. Then run `docker start lidar`. Watch badge.
   - **Expected:** Badge flips to red ("LIDAR: stale") within 1.5s of stop (worst case 1.7s). Badge returns to green within 1.5s of first scan post-restart.
   - **Why human:** Requires live container lifecycle manipulation on the mower; poller infrastructure (200ms interval, 1500ms threshold) verified in code but timing assertion requires live round-trip.

4. **SC#4 Foxglove layout opens and populates**
   - **Test:** Install Foxglove Studio v2.x. File → Import layout → `web/foxglove/mowerbot.foxglove-layout.json`. Open connection → **Rosbridge (ROS 1 & 2)** tab → `ws://10.10.40.23:9090` → Open.
   - **Expected:** 3D panel shows /scan sweep around base_link; Raw Messages panel shows /fix NavSatFix fields (lat, lng, status); Plot panel shows /odometry/filtered linear.x and angular.z traces, all updating live.
   - **Why human:** Foxglove is a desktop app outside the codebase. Artifact structure verified (layout JSON valid, docs clear); actual Foxglove-opens-and-renders assertion requires a human at the desk.

### Gaps Summary

There are no **gaps** in the goal-failure sense — all code artifacts exist, are substantive, are correctly wired, pass data-flow tracing, and the infrastructure behind every success criterion is in place and verified. Three of the five ROADMAP Success Criteria require live human verification (SC#2 long-duration, SC#3 container round-trip, SC#4 external-tool test) that cannot be executed programmatically within a verification pass.

The **Core Value gate (SC#1)** is honestly reported as **deferred**, not green. D-05 suppresses the overlay render without GPS fix, and the indoor Playwright test could not confirm the visual sweep. The data pipeline is fully green independently (10.66 Hz CBOR, Float32Array with NaN preserved at index 9, zero console errors) and the render path is verified by code inspection (canvas 976×784 mounted, viridis legend 100×8, badge "LIDAR: live") — but the operator-facing acceptance test (see the sweep around the robot marker) cannot be discharged until the mower is outdoors. 03-02-SUMMARY.md §D-05 Caveat already frames this as the expected next step; this VERIFICATION.md confirms that framing rather than pretending SC#1 is green.

**Phase 3 verdict:** All implementation work is done and correct. Core Value gate cannot close until the outdoor walkthrough is performed. Status is `human_needed` — the phase should not be marked `passed` on the roadmap until at minimum SC#1 (Core Value) is confirmed outdoors.

---

_Verified: 2026-04-14T23:15:00Z_
_Verifier: Claude (gsd-verifier)_
