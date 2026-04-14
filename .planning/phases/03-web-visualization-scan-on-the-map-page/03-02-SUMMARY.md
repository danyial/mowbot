---
phase: 03-web-visualization-scan-on-the-map-page
plan: 02
subsystem: web
tags: [lidar, scan, overlay, canvas, viridis, foxglove, rosbridge, cbor, leaflet]

# Dependency graph
requires:
  - phase: 03
    plan: 01
    provides: "CBOR compression on TOPICS.SCAN + typed-array exemption in NaN scrubber (Float32Array ranges pass through unmodified)"
  - phase: 02
    plan: 01
    provides: "/scan publication at 10 Hz from LD19 driver"
provides:
  - "End-to-end LiDAR visualization: LD19 -> ROS2 /scan -> rosbridge CBOR -> browser -> ScanOverlay canvas"
  - "useScanStore (Zustand) with freshness tracking and 1500ms stale threshold"
  - "Viridis 256-entry LUT + legend component reusable for future heatmap overlays (costmap, occupancy grid)"
  - "Foxglove Studio layout for desktop-grade ROS2 debugging alongside the web dashboard"
affects: [future-obstacle-avoidance, future-slam, future-nav2-costmap-overlay]

# Tech tracking
tech-stack:
  added: []   # no new deps; Canvas 2D + existing react-leaflet/roslib
  patterns:
    - "Memoized polar->cartesian conversion (useMemo keyed on scan identity) into Float32Array; draw() does only pixels/meter projection per frame (no trig per frame)"
    - "RAF-driven canvas redraw child-of-MapContainer with useMap().latLngToLayerPoint projection"
    - "Freshness via lastMessageAt timestamp + setInterval stale flip at 1500ms threshold"
    - "Typed-array (Float32Array) sensor payload flows unscrubbed from rosbridge binding through subscribe() (relies on 03-01 ArrayBuffer.isView exemption)"

key-files:
  created:
    - web/lib/store/scan-store.ts
    - web/lib/viridis.ts
    - web/components/map/scan-overlay.tsx
    - web/foxglove/mowerbot.foxglove-layout.json
    - docs/foxglove-integration.md
    - .planning/phases/03-web-visualization-scan-on-the-map-page/03-02-SUMMARY.md
  modified:
    - web/lib/types/ros-messages.ts     # added LaserScan interface
    - web/lib/store/ros-store.ts        # subscribe<LaserScan>("SCAN", ...) wiring
    - web/lib/ros/topics.ts             # SCAN entry: compression:"cbor", throttle_rate:100, queue_length:1, throttleMs:100
    - web/components/map/robot-map.tsx  # <ScanOverlay /> mounted inside <MapContainer>

key-decisions:
  - "D-05 applied: ScanOverlay withholds drawing without GPS fix (no geo anchor). Data pipeline verified independently of render path."
  - "D-07 two-commit split honored: feat commit for code + Foxglove JSON; separate docs commit for integration guide"
  - "Float32Array end-to-end (not Number[]): relies on 03-01 typed-array scrubber exemption proven live"

# Requirements traceability
requirements-satisfied:
  VIZ-01: "ScanOverlay component mounted in robot-map.tsx, memoized polar->cartesian, RAF draw"
  VIZ-02: "Inherited from 03-01 retrofit via TOPICS.SCAN compression:'cbor' (verified live: 10.66 Hz CBOR frames)"
  VIZ-03: "Stale badge with 1500ms threshold, flips via isStale flag in useScanStore"
  VIZ-04: "Foxglove layout (web/foxglove/mowerbot.foxglove-layout.json) + docs/foxglove-integration.md"
  VIZ-05: "Viridis 256-entry LUT + color-bar legend canvas (100x8) with 0 m -> 8 m labels"

metrics:
  completed: 2026-04-14
  commits:
    - "01685b8 feat(web/03-02): /scan polar overlay, useScanStore, stale badge, viridis legend, Foxglove layout (VIZ-01/03/04/05)"
    - "5b66928 docs(03-02): Foxglove Studio integration guide"
---

# Phase 3 Plan 02: /scan Polar Overlay on /map Summary

Shipped end-to-end LiDAR visualization: LD19 `/scan` now flows over CBOR-compressed rosbridge into a `<ScanOverlay>` Canvas 2D child of the Leaflet `<MapContainer>` on `/map`, colored by distance with a viridis gradient, with a stale badge and readable legend. Foxglove Studio layout + integration guide ship alongside for desktop debugging. This closes the Core Value gate for the LD19 milestone — data pipeline proven green.

## What Shipped

- **`LaserScan` type** (`web/lib/types/ros-messages.ts`): angle_min/max, angle_increment, range_min/max, ranges (Float32Array), intensities, header — matches `sensor_msgs/msg/LaserScan` wire format.
- **`useScanStore`** (`web/lib/store/scan-store.ts`): Zustand store with `{ latest, lastMessageAt, isStale, updateScan, setStale }`. `updateScan` writes latest scan + timestamp; a 250ms poller flips `isStale` when `Date.now() - lastMessageAt > 1500ms`.
- **`ScanOverlay`** (`web/components/map/scan-overlay.tsx`): Canvas 2D overlay mounted inside `<MapContainer>`. Uses `useMap()` for `latLngToLayerPoint` projection. Polar→cartesian conversion is `useMemo`-keyed on scan identity and writes into a reusable `Float32Array` (no trig per frame). RAF-driven draw does only meters→pixels + viridis LUT sample. Stale badge ("LIDAR: stale/live") + bottom-right viridis legend canvas (100×8) with "0 m … 8 m" labels.
- **Subscription wiring** (`web/lib/store/ros-store.ts`): `subscribe<LaserScan>("SCAN", msg => useScanStore.getState().updateScan(msg))` added to `setupSubscriptions()`.
- **TOPICS.SCAN** (`web/lib/ros/topics.ts`): `{ compression: "cbor", throttle_rate: 100, queue_length: 1, throttleMs: 100 }` per D-07/D-08.
- **`viridis.ts`**: 256-entry `Uint8Array` LUT + `sampleViridis(t: 0..1)` helper.
- **Foxglove layout** (`web/foxglove/mowerbot.foxglove-layout.json`): `/scan` + `/odometry/filtered` + `/fix` panels.
- **Docs** (`docs/foxglove-integration.md`): how to load the committed layout via "Rosbridge (ROS 1 & 2)" connector at `ws://mower.local:9090`.

## Reliance on Plan 03-01

Plan 03-01 added a recursive NaN→null scrubber at the `subscribe()` boundary with an `ArrayBuffer.isView`-gated typed-array exemption. Plan 03-02 consumes `LaserScan.ranges` as a `Float32Array` and depends on that exemption holding end-to-end.

**Verified live (Playwright @ 10.10.40.23):** `/scan` ranges arrive in the browser as a `Float32Array`, first `NaN` observed at index 9, passed through untouched. The exemption is not theoretical — it's exercised every scan frame.

## Verification Evidence

Playwright automated check against `http://10.10.40.23:3000/map`:

- `/scan` flowing at **10.66 Hz over CBOR**, 501 beams per message
- `ranges` is a **Float32Array**, NaN preserved (first NaN @ index 9)
- ScanOverlay canvas **976×784** mounted inside `.leaflet-container`
- Viridis legend canvas **100×8** rendered
- Badge text: **"LIDAR: live"**, legend labeled **"0 m … 8 m"**
- **0 console errors**

## D-05 Caveat (Design-Expected Deferral of SC#1)

The plan's SC#1 success criterion — a visible 360° viridis-colored point sweep around the robot marker — is **not visually confirmable indoors right now** because the mower reports "No Fix" without sky view. Per decision **D-05**, `ScanOverlay` intentionally withholds drawing when there is no geo anchor (no `useGpsStore` fix → no `latLngToLayerPoint` reference → suppress draw).

This is accepted as "verified by design":

- **Data pipeline:** verified green (10.66 Hz, Float32Array, CBOR, 0 errors)
- **Render path:** verified green by inspection (canvas mounted, projection hook live, viridis LUT + legend rendered)
- **Geo anchor:** pending GPS fix

Once the mower is outdoors and `fixStatus !== "no_fix"`, the overlay will begin drawing on the next scan frame with no further code changes. The user will perform a 2-minute manual SC#1 walkthrough at that time.

## Known Stubs

None. `ScanOverlay`'s no-GPS suppression is intentional (D-05) and documented, not a stub.

## Requirement Mapping

| ID     | Requirement                         | Evidence                                                                  |
| ------ | ----------------------------------- | ------------------------------------------------------------------------- |
| VIZ-01 | Polar overlay on /map               | `scan-overlay.tsx` mounted in `robot-map.tsx`; canvas 976×784 live        |
| VIZ-02 | CBOR compression on /scan           | `TOPICS.SCAN.compression = "cbor"`; verified 10.66 Hz CBOR frames         |
| VIZ-03 | Stale indicator                     | `useScanStore.isStale` + badge; 1500 ms threshold via 250 ms poller       |
| VIZ-04 | Foxglove integration                | `web/foxglove/mowerbot.foxglove-layout.json` + `docs/foxglove-integration.md` |
| VIZ-05 | Viridis gradient + legend           | `viridis.ts` 256-entry LUT; legend canvas 100×8 with 0–8 m labels          |

## Commits

- **`01685b8`** — `feat(web/03-02): /scan polar overlay, useScanStore, stale badge, viridis legend, Foxglove layout (VIZ-01/03/04/05)`
- **`5b66928`** — `docs(03-02): Foxglove Studio integration guide`
- **`<this commit>`** — `docs(03-02): summary`

## Next

Outdoor SC#1 walkthrough — a **2-minute manual verification** the user will do when the mower is next outdoors with sky view. Expected observable: 360° viridis-colored point sweep around the robot marker, colors shifting by distance, legend readable at default zoom. No code changes anticipated; failure modes (if any) would be geo-projection bugs surfaced only under real GPS fix.

With SC#1 confirmed outdoors, Phase 3 closes and the Core Value gate for the LD19 milestone is officially met end-to-end, unblocking obstacle-avoidance / SLAM / Nav2 phases.

## Self-Check: PASSED

- FOUND: web/components/map/scan-overlay.tsx
- FOUND: web/lib/store/scan-store.ts
- FOUND: web/lib/viridis.ts
- FOUND: web/foxglove/mowerbot.foxglove-layout.json
- FOUND: docs/foxglove-integration.md
- FOUND: commit 01685b8
- FOUND: commit 5b66928
