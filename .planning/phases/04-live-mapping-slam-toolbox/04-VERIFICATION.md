---
phase: 04-live-mapping-slam-toolbox
verified: 2026-04-14T00:00:00Z
status: human_needed
score: 5/5 must-haves verified (code); 1 documentation-by-construction + 1 v0 compromise flagged
overrides_applied: 0
human_verification:
  - test: "Open /lidar in a browser pointed at the live mower (http://10.10.40.23:3000/lidar); confirm within 5 s that a greyscale OccupancyGrid bitmap renders UNDER the polar /scan points and that after /scan goes stale the bitmap persists (robot 'remembers what it saw')"
    expected: "Bitmap visible within 5 s; persists when scan stream is cut"
    why_human: "Visual rendering + 5 s latency + persistence-after-stream-drop is exactly the kind of UX timing grep cannot observe — requires browsing live mower"
  - test: "On /lidar, press the bottom-right Eraser button; confirm bitmap clears within ~250 ms and refills from the next /map publish within ~3.5 s; confirm 0 console errors"
    expected: "Clear within 250 ms, refill within ~3.5 s, no console errors"
    why_human: "Timed UX behavior + console observation"
  - test: "On /lidar, press ⌂ (Home); confirm zoom/pan resets but bitmap is preserved. Then press Eraser; confirm bitmap clears but zoom/pan is preserved (two-way non-interference)"
    expected: "Each button touches only its own concern"
    why_human: "Cross-widget interaction behavior that the regression sentinel only spot-checks"
  - test: "Open /map (Leaflet); confirm it still renders exactly as before (2 canvases + tiles + ScanOverlay) and no MapBitmap appears there"
    expected: "No visual regression on /map"
    why_human: "Visual diff vs prior milestone; Playwright sentinel covers structural but not pixel-level"
  - test: "Eraser v0 honest limitation — after pressing Eraser, observe that new /map messages continue to arrive and re-populate the bitmap (confirming the slam_toolbox SLAM graph was NOT actually reset server-side); document this behavior in operator notes"
    expected: "Server-side graph still accumulating; only the client view was cleared"
    why_human: "Confirms the documented v0 compromise is what the operator actually experiences, so expectations match reality"
---

# Phase 4: Live Mapping with slam_toolbox — Verification Report

**Phase Goal:** A new `slam` Docker service runs `slam_toolbox`'s `online_async_slam_toolbox_node` consuming `/scan` + `/odometry/filtered`, publishes a live `nav_msgs/OccupancyGrid` on `/map` with a correct `map → odom` TF, and the web `/lidar` page renders the occupancy grid as a bitmap underneath the scan overlay — operator sees "everything the robot has seen so far, stitched together" without needing RViz or Foxglove.

**Verified:** 2026-04-14
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
|---|------------|--------|----------|
| 1 | `docker compose up slam` brings up slam_toolbox async; `ros2 topic hz /map` ≥ 0.5 Hz; `topic echo /map --once` returns populated `nav_msgs/OccupancyGrid` | ✓ VERIFIED | `docker-compose.yml:146-161` defines `slam:` service inheriting `*ros-common`, pinned `ghcr.io/danyial/mowbot/slam:humble-2.6.10`. `04-01-DEPLOY.log` records sustained `average rate: 0.500` Hz for 60 s and `width: 138 height: 74 resolution: 0.05` populated grid. `config/slam_toolbox_params.yaml` sets `map_update_interval: 2.0` → 0.5 Hz. |
| 2 | TF tree `map → odom → base_link → laser_frame`; `map → odom` published by slam_toolbox, not static | ✓ VERIFIED | `04-01-SUMMARY.md` Probe Results: `odom ← map (10.2 Hz, slam_toolbox — NOT static)`, `base_link ← odom (30.2 Hz, EKF)`, `laser_frame ← base_link (static)`. `04-01-tf-frames.pdf` + `.gv` committed as artifact. `slam_toolbox_params.yaml` `base_frame: base_link` override. |
| 3 | Operator opens `/lidar` → occupancy bitmap drawn under scan overlay within 5 s; persists after /scan stops; clears on Reset | ⚠️ PARTIAL (code + Playwright evidence; needs human confirm) | `web/app/lidar/page.tsx:49` mounts `<MapBitmap>` as `ScanCanvas` `underlay` prop. `04-02-REGRESSION.log`: /lidar has 3 canvases (MapBitmap + ScanCanvas + legend), Eraser button present, 0 console errors. SUMMARY reports 127k non-transparent pixels, 1797 non-grey cells. Eraser clears 15561→0 px in 250 ms, refills 0→15561 in 3.5 s. **v0 compromise** on "clears via `/slam_toolbox/reset`": service does NOT exist in Humble async — see Risks below. |
| 4 | Stationary 60 s → map does NOT drift; ±5 cm / ±1 cell reference wall | ✓ VERIFIED | `04-01-DEPLOY.log` + SUMMARY: `stationary 60 s diff = 0 lines`. Plan-B (EKF publish_tf:false fallback) not needed; approved at Task 6 checkpoint. |
| 5 | When ESP32 `/odom` publisher ships later, zero web-side changes required | 📄 DOCUMENTED-BY-CONSTRUCTION | MapBitmap subscribes to `/map`, which is downstream of slam_toolbox, which is downstream of `/odom`. The subscription chain (`ros-store.ts:80` → `useMapStore.updateMap` → `MapBitmap`) does not depend on `/odom` shape or presence. Documented in `04-02-SUMMARY.md` "Forward Hook". **Not empirically tested** (HW-04 firmware work deferred); treating as doc claim per user instruction. |

**Score:** 5/5 truths verified in code, with SC#3 requiring human confirmation of live timing/visuals and SC#5 accepted as documentation-by-construction.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docker/slam/Dockerfile` | ros:humble-ros-base + slam_toolbox + cyclonedds-cpp, CMD launches online_async with params + use_sim_time:=false | ✓ VERIFIED | 22 lines, installs `ros-humble-slam-toolbox` + `ros-humble-rmw-cyclonedds-cpp`, CMD asserts `use_sim_time:=false` + `slam_params_file:=/config/slam_toolbox_params.yaml`. Documented CYCLONEDDS_URI omission (Rule 1 deviation). |
| `config/slam_toolbox_params.yaml` | Project-local overrides (base_link, do_loop_closing:false, transform_timeout:1.0, map_update_interval:2.0, max_laser_range:12.0, min travel 0.1, use_map_saver:false) | ✓ VERIFIED | 79 lines; all overrides present per SUMMARY Probe results. `base_frame: base_link` override applied. |
| `docker-compose.yml` slam service | Inherits `*ros-common`, pinned image, depends_on lidar+nav+micro-ros-agent, command with params file + use_sim_time:=false | ✓ VERIFIED | Lines 146-161: service present, container_name `mower-slam`, pinned `humble-2.6.10`, depends_on correct, command correct. 9 services total. |
| `.planning/REQUIREMENTS.md` MAP-01..MAP-05 | 5 bullets + 5 traceability rows | ✓ VERIFIED | Lines 36-40 (bullets), 106-110 (traceability) — all five MAP-IDs present. |
| `web/lib/types/ros-messages.ts` | OccupancyGrid + MapMetaData interfaces | ✓ VERIFIED | Lines 160+ declare `MapMetaData` and `OccupancyGrid` types (Phase 4 MAP-04 comments). |
| `web/lib/ros/topics.ts` | TOPICS.MAP with compression:cbor, throttle_rate:1000, queue_length:1 | ✓ VERIFIED | Lines 58-62: `MAP: { compression: "cbor", throttle_rate: 1000, ... }`. |
| `web/lib/store/map-store.ts` | useMapStore Zustand mirroring scan-store | ✓ VERIFIED | 31 lines: `{ latest, lastMessageAt, isStale, updateMap, setStale, clear }` shape per spec. |
| `web/lib/ros/services.ts` | callSlamReset service wrapper | ✓ VERIFIED (with documented behavior change) | 52 lines: client-side clear + best-effort `/slam_toolbox/clear_changes` (NOT `/slam_toolbox/reset`). Doc comment explains why. |
| `web/components/lidar/map-bitmap.tsx` | Canvas 2D bitmap via offscreen putImageData + drawImage | ✓ VERIFIED | 152 lines: offscreen backing canvas, greyscale colormap (unknown/free/occ), composite via drawImage with shared transform. |
| `web/components/lidar/scan-canvas.tsx` | Adds underlay render-prop slot + Reset button; anchored branch untouched | ✓ VERIFIED | Lines 131, 162, 541-592 add `underlay?: (t) => ReactNode` slot wrapped in standalone-only branch (`underlay && currentTransform`). Reset button at lines 600-612. |
| `web/app/lidar/page.tsx` | Renders ScanCanvas with MapBitmap in underlay slot | ✓ VERIFIED | 52 lines: `<ScanCanvas underlay={(t) => <MapBitmap transform={t} />} />`. Dynamic imports both. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| docker-compose slam service | slam_toolbox_params.yaml | `slam_params_file:=/config/slam_toolbox_params.yaml` (inherited `/config` mount) | ✓ WIRED | `docker-compose.yml:161` passes the arg; `*ros-common` provides the volume mount. |
| slam_toolbox | EKF odom→base_link TF | TF lookup with `transform_timeout: 1.0` | ✓ WIRED | Runtime-verified: `odom ← map @ 10.2 Hz` + `base_link ← odom @ 30.2 Hz` tf2_echo in SUMMARY. |
| slam_toolbox | LD19 /scan | Default scan subscriber (sensor_data QoS) | ✓ WIRED | `/map` published @ 0.5 Hz proves scan subscription working. |
| ros-store.ts `subscribe<OccupancyGrid>("MAP", ...)` | useMapStore.updateMap | Subscriber scrubber typed-array exemption | ✓ WIRED | `ros-store.ts:80-82` has the subscription; MAP topic defined in `topics.ts:58`. |
| ScanCanvas standalone branch | MapBitmap child | render-prop underlay={(t) => <MapBitmap transform={t} />} | ✓ WIRED | `scan-canvas.tsx:582` renders `underlay(currentTransform)` only when prop present; `/lidar/page.tsx:49` passes it; `/map` never passes it. |
| Reset button | slam_toolbox container | `callSlamReset()` (client clear + best-effort `/slam_toolbox/clear_changes`) | ⚠️ PARTIAL by design | `scan-canvas.tsx:600-612` wires onClick → `useMapStore.clear()` + `callSlamReset()`. The server call targets `clear_changes` not `reset` because `/slam_toolbox/reset` does not exist in Humble async — honest v0 compromise, documented in `services.ts:10-24`. |
| ⌂ Home button | viewRef only (does NOT touch useMapStore) | existing `resetView()` | ✓ WIRED (non-interference) | Playwright Blocker #2 probe verified: ⌂ preserves map, Eraser preserves view. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| MapBitmap | `latest` from useMapStore | `subscribe<OccupancyGrid>("MAP")` → `useMapStore.getState().updateMap(msg)` in ros-store.ts; upstream slam_toolbox publishes real `nav_msgs/OccupancyGrid` (MAP-02 verified @ 0.5 Hz with populated 138×74 grid) | Yes | ✓ FLOWING — Playwright observed 127k non-transparent pixels, 1797 non-grey cells rendered |
| ScanCanvas underlay slot | `currentTransform` (pxPerMeter, panX, panY, canvasWidth, canvasHeight) | Derived each render tick in ScanCanvas from its existing viewRef (standalone branch) | Yes | ✓ FLOWING — transform handed to MapBitmap every redraw; SUMMARY confirms shared-transform composition |
| Reset button → server | `/slam_toolbox/clear_changes` roundtrip | rosbridge service call | Partial by design | ⚠️ HONEST COMPROMISE — server call is a harmless no-op; client-side clear is the real UX effect (documented) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `/map` publishing rate ≥ 0.5 Hz on live Pi | `docker compose exec nav ros2 topic hz /map` | `average rate: 0.500` sustained ×11 samples over 60 s (from `04-01-DEPLOY.log`) | ✓ PASS |
| `/map` contains populated OccupancyGrid | `docker compose exec nav ros2 topic echo /map --once` | `width: 138 height: 74 resolution: 0.05` | ✓ PASS |
| TF chain complete, map→odom non-static | `tf2_echo map odom` (+ chain) | All 3 succeed; `map→odom @ 10.2 Hz` from slam_toolbox | ✓ PASS |
| Stationary 60 s drift | `diff /tmp/map_t0 /tmp/map_t60` | 0 lines | ✓ PASS |
| 9-service regression gate | `docker compose ps` | micro-ros-agent, gnss, imu, ntrip, nav, rosbridge, web, lidar, slam all Up | ✓ PASS |
| /map (Leaflet) route regression sentinel | `_playwright_env/map-regression.mjs` | 2 canvases + tiles + ScanOverlay, 0 console errors | ✓ PASS |
| /lidar canvas count | Playwright probe in `04-02-REGRESSION.log` | 3 canvases (MapBitmap + ScanCanvas + legend) | ✓ PASS |
| Eraser button present on /lidar | Playwright | PASS (A6) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MAP-01 | 04-01 | slam service up via docker compose, pinned image, inherits *ros-common | ✓ SATISFIED | Compose lines 146-161; deploy log records clean bring-up |
| MAP-02 | 04-01 | /map ≥ 0.5 Hz + populated OccupancyGrid | ✓ SATISFIED | 0.500 Hz sustained, 138×74 populated grid |
| MAP-03 | 04-01 | TF tree correct, map→odom non-static | ✓ SATISFIED | `map→odom @ 10.2 Hz` from slam_toolbox; full chain verified |
| MAP-04 | 04-02 | /lidar renders bitmap under scan within 5 s; persists after scan stops; Reset clears via `/slam_toolbox/reset` | ⚠️ SATISFIED WITH COMPROMISE | Bitmap + persistence + client-side clear all Playwright-verified. Server-side reset is `/slam_toolbox/clear_changes` (best-effort), not `/slam_toolbox/reset` — service doesn't exist in Humble async. Accepted as honest v0 behavior; operator-facing UX meets spec; true graph reset deferred to v1 (container restart). |
| MAP-05 | 04-01 | Stationary 60 s no-drift | ✓ SATISFIED | 0-line diff |

**Orphan check:** No MAP-IDs assigned to Phase 4 outside of plans 04-01 and 04-02.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `web/lib/ros/services.ts` | 10-24 | Documented behavioral deviation: `callSlamReset` does NOT call `/slam_toolbox/reset` — calls `/slam_toolbox/clear_changes` (no-op in async) after a client-side clear | ℹ️ Info / documented honest limitation | MAP-04 spec mentions `/slam_toolbox/reset`; runtime reality is that service doesn't exist in Humble async. Code + SUMMARY document this transparently. Operator UX still meets "button clears map" requirement. |
| `web/lib/ros/services.ts` | 43-47 | `() => resolve()` swallows service errors silently | ℹ️ Info | Intentional — the client clear already happened; server is best-effort. Swallow is explicit and commented. |
| `web/components/lidar/map-bitmap.tsx` | 26-33 | v0 anchor limitation — map rendered at `info.origin.position` assuming robot near map origin | ⚠️ Warning / documented | Once mower moves, scan (base_link) and bitmap (map frame) drift apart until a tracking overlay lands (v1 follow-up). Invisible under SC#4 (stationary). |

No blocker anti-patterns. No TODO/FIXME/placeholder hits in the 8 modified files. No empty-array or stub returns in new code paths.

### Risks / Honest Limitations (operator-visible)

1. **Eraser is NOT a true SLAM reset.** The slam_toolbox graph continues accumulating server-side; only the browser bitmap is wiped. Next `/map` publish (~2 s later) repopulates the bitmap from the (still-accumulating) graph. This is a v0 compromise born of Humble async slam_toolbox not exposing `/slam_toolbox/reset`. A true reset requires `docker compose restart slam`. Documented in `04-02-SUMMARY.md` "Honest Limitations" and in the inline comment of `services.ts`. **If an operator expects "erase and start fresh" semantics this is misleading** — should be called out in operator docs, and ideally the button tooltip should change from "Reset map" to "Clear view" in a v0.1 polish pass.
2. **v0 anchor assumption.** MapBitmap anchors at `info.origin.position` and assumes the robot is near the map-frame origin. Fine while stationary (SC#4) but the scan/bitmap alignment degrades once the mower moves. A proper TF-driven robot-in-map tracking overlay is deferred.
3. **CycloneDDS URI deviation** (Rule 1 deviation, documented). The slam Dockerfile intentionally does NOT set `CYCLONEDDS_URI` because the repo's `cyclonedds.xml` requests a 10 MB socket recv buffer that exceeds the Pi's kernel rmem ceiling. All other services in this stack follow the same convention. No functional impact; good to revisit kernel tuning separately.
4. **SC#5 is documented, not tested.** "Zero web-side changes when firmware `/odom` lands" is a construction argument (subscription chain doesn't depend on `/odom`), not an empirical test. Will only be proven when HW-04 firmware work lands.

### Human Verification Required

See `human_verification:` block in frontmatter. The automated/structural evidence is strong (Playwright-verified canvas counts, button presence, clear/refill timings; SSH-verified rates and TF chain), but live operator experience of timing, visual layering, and the honest Eraser compromise is best confirmed with a human loading the page.

### Gaps Summary

No blocking gaps. Phase 4 achieves its goal — the LD19 → slam_toolbox → OccupancyGrid → rosbridge → MapBitmap pipeline flows real data end-to-end; the operator can see a stitched occupancy picture on `/lidar` with zoom/pan preserved. Two honest caveats named above: (a) Eraser is a client-side clear, not a true graph reset (v0 compromise — the only reset path in Humble async is a container restart); (b) SC#5 is documented-by-construction, not empirically tested, pending HW-04 firmware `/odom` delivery.

---

*Verified: 2026-04-14*
*Verifier: Claude (gsd-verifier)*
