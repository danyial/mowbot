---
title: Outstanding UAT / Verification Items — Cross-Phase Audit
generated: 2026-04-15
milestone: v2.1 (LD19 LiDAR Integration)
phases_audited: 0, 1, 2, 3, 4
status_summary: 0 + 1 + 2 passed; 3 + 4 human_needed
---

# UAT Audit — MowerBot v2.1

All five phases are code-complete and committed to `origin/main`. Phases 0 / 1 / 2 closed cleanly. Phases 3 and 4 are `human_needed` — automated and structural verification is strong, but a handful of items need a human at the mower or at the desk before milestone close.

## Verdict at a glance

| Phase | Status | Open items |
|---|---|---|
| 0 — GSD Brownfield Adoption | ✅ passed | 0 |
| 1 — Hardware & UART Routing | ✅ closed | 0 (HW-04 + HW-05 deferred to dedicated todo) |
| 2 — LiDAR Driver & /scan | ✅ closed | 0 |
| 3 — Web Viz /scan (Core Value) | ⚠️ human_needed | **4 items** |
| 4 — Live Mapping (slam_toolbox) | ⚠️ human_needed | **5 items** |
| **Total** | | **9 open UAT items** |

## Prioritized human test plan

Items grouped by testability — execute top-down to clear the milestone for `/gsd-complete-milestone v2.1`.

### Group A — At the desk, indoor, mower stationary (5–10 min total)

These can be done sitting at the laptop with the mower powered on but not moving. Knock all out in one sitting.

| # | Phase | Test | Expected | Time |
|---|---|---|---|---|
| A1 | 4 | Open `http://10.10.40.23:3000/lidar` in fresh Chrome tab | MapBitmap (greyscale OccupancyGrid) renders UNDER polar /scan points within 5 s; robot marker (blue circle) at canvas center; scale bar bottom-center showing physical metric (e.g., "1 m") | 1 min |
| A2 | 4 | While `/lidar` open, SSH `pi@10.10.40.23` and `docker stop mower-lidar` for ~10 s, then start it again | Bitmap persists (does NOT clear when scan stops); scan badge flips "LIDAR: stale" within 1.5 s and back to "live" within 1.5 s of restart | 1 min |
| A3 | 4 | Press the Eraser (top-left, trash icon) on `/lidar` | Bitmap clears within ~250 ms, refills from next `/map` publish within ~3.5 s, 0 console errors | 30 s |
| A4 | 4 | Zoom in (mouse wheel or `+` button) to ~10×, pan with drag, then press ⌂ (Home) | View resets to default 3.0× and pan zero, but MapBitmap pixels remain (two-way non-interference: ⌂ touches only view, Eraser touches only map) | 1 min |
| A5 | 4 | Open `/map` (Leaflet) immediately after `/lidar` | No visual regression: Leaflet tiles + scan overlay only; no MapBitmap layer; no LIDAR badge or viridis legend overlapping GPS / zone controls | 1 min |
| A6 | 3 | On `/map` open two concurrent Chrome tabs and leave 5 min; DevTools → Network → WS → `/rosbridge` → frame sizes + bufferedAmount | bufferedAmount stays in low-kilobyte range, no monotonic growth; scan binary frames continue ~10 Hz | 5 min wait |
| A7 | 3 | With `/map` badge green, SSH `pi@10.10.40.23` → `docker stop mower-lidar`; then `docker start mower-lidar` | Badge flips red within 1.5 s of stop; back to green within 1.5 s of post-restart first scan | 1 min |
| A8 | 4 | After A3 Eraser press, watch for 30 s — does new `/map` data continue arriving and re-populating? | YES — server-side SLAM graph keeps accumulating (Eraser is client-side only). Confirms documented v0 compromise matches reality. | 30 s |

**A subtotal:** ~10 min, no special equipment.

### Group B — Desktop tool, no mower required (5 min)

| # | Phase | Test | Expected | Time |
|---|---|---|---|---|
| B1 | 3 | Install Foxglove Studio v2.x. File → Import layout → `web/foxglove/mowerbot.foxglove-layout.json`. Open connection → "Rosbridge (ROS 1 & 2)" → `ws://10.10.40.23:9090` → Open | 3D panel: /scan sweep around base_link. Raw Messages: /fix lat/lng/status. Plot: /odometry/filtered linear.x + angular.z traces, all live-updating | 5 min |

**B subtotal:** ~5 min, requires Foxglove Studio install.

### Group C — Outdoors with the mower, requires GPS fix (15–20 min)

The single Core-Value-blocking item. Cannot be discharged indoors per design D-05.

| # | Phase | Test | Expected | Time |
|---|---|---|---|---|
| C1 | 3 | Roll the mower outdoors, power on, wait for `useGpsStore.getState().fixStatus !== "no_fix"`. Open `http://10.10.40.23:3000/map` in fresh tab | Live polar scan overlay surrounding robot marker; viridis points dark-violet near → yellow far; legend readable; overlay stays centered on robot as mower moves; 0 console errors; badge "LIDAR: live" | 15 min (GPS fix wait dominates) |

**C subtotal:** ~15 min, requires sky view + outdoor accessible mower.

## Items NOT testable now (acknowledged limitations)

| Phase | Item | Why deferred |
|---|---|---|
| 4 SC#5 | "When firmware `/odom` ships, zero web-side changes required" | Documented-by-construction; only testable when HW-04 firmware lands. Captured in todo `5v-rail-transient-measurement.md`. Not a milestone-close blocker — accept as doc-claim. |
| 4 (drift) | Map↔scan alignment when mower moves | Stationary-only v0 anchor (Flag G). Captured in todo `lidar-live-mapping.md`. Honest limitation, not a milestone gap. |
| 4 (eraser) | True SLAM-graph reset (server-side) | Humble async slam_toolbox has no `/reset` service. Eraser is client-side + best-effort `clear_changes`. Documented v0 compromise. v1 fix = container-restart endpoint; not in v2.1 scope. |

## Stale-doc check

Spot-grepped `.planning/` for references to removed/renamed items:
- ✅ No references to obsolete `/dev/ttyESP32` (cleanup quick `260415-fqf` shipped)
- ✅ No references to "ScanOverlay on /map" outside Phase 3 historical record (Phase 4 fix `39b6707` hid LIDAR overlays on /map)
- ✅ No references to non-existent `/slam_toolbox/reset` (services.ts:10–24 documents the workaround)

## Recommendation

**Do Group A first** (10 min at the desk). If all 8 items pass:
- Phase 4 can be marked `passed`
- Phase 3 still has C1 + B1 outstanding

**Then do C1 next time the mower is outdoors.** That's the only blocker for Phase 3 = passed = milestone v2.1 close = `/gsd-complete-milestone v2.1`.

B1 (Foxglove) is nice-to-have for Phase 3 but is an optional "can the operator use the layout file" check, not a Core-Value gate.

If outdoor C1 cannot happen this session, milestone close can still proceed by accepting C1 as "design-deferred to first outdoor session" with an open carry-forward todo.
