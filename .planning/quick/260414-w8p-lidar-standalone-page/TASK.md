# Quick 260414-w8p: Standalone /lidar page

## Goal

Add a dedicated **LiDAR** page to the web dashboard that renders the polar `/scan`
sweep on a fixed-center canvas with NO GPS dependency, so we can verify scan data
indoors (where there is no fix).

## What's built

1. **`web/components/lidar/scan-canvas.tsx`** — new reusable `<ScanCanvas />`
   - Props: `{ projector?, pxPerMeter?, mountTarget?, className? }`
   - Standalone mode (no `projector`): renders its own full-size `<canvas>` +
     badge + legend, centered polar sweep with `pxPerMeter` derived from canvas
     size and `range_max`.
   - Anchored mode (`projector` + `mountTarget`): imperatively mounts canvas/badge/
     legend into `mountTarget` (the Leaflet map container) and projects via the
     caller-supplied closure. Reproduces the previous `ScanOverlay` behavior.
   - Owns its RAF loop, memoized polar→cartesian Float32Array (preserves NaN
     sentinel filtering), stale poller, viridis color-bar legend, LIDAR live/stale
     badge.

2. **`web/components/map/scan-overlay.tsx`** — refactored into a thin wrapper
   that calls `useMap()`, builds the anchor projector from the current GPS fix +
   yaw, and renders `<ScanCanvas projector={...} mountTarget={map.getContainer()} />`.
   Behavior unchanged for the existing /map route.

3. **`web/app/lidar/page.tsx`** — new full-viewport route that renders
   `<ScanCanvas className="h-full w-full bg-black" />` (standalone mode).
   Works without GPS fix.

4. **Sidebar + mobile nav** — new "LiDAR" entry directly under "Karte", using
   the lucide `Radar` icon, routing to `/lidar`.

## Acceptance

- `npm run build` green in `web/`.
- `/map` still renders the scan overlay anchored to the robot and updates with
  GPS/yaw (no regression).
- `/lidar` renders the polar scan centered on a fixed origin with a near-black
  background, LIDAR live/stale badge top-right, 0 m → range_max legend
  bottom-right, and works with no GPS fix.
- Sidebar shows "LiDAR" under "Karte" with a Radar icon.

## Verification plan

1. Local `npm run build` in `web/`.
2. scp changed files to `pi@10.10.40.23:~/mowbot/web/...`.
3. `docker compose … build web && docker compose up -d web` on the Pi.
4. Orchestrator Playwright-verifies `/lidar` shows the scan (indoors, no fix)
   and `/map` overlay still works.

## Constraints followed

- German UI: sidebar label is **"LiDAR"** (exact case).
- No `any` introduced.
- `@/` imports, PascalCase components, camelCase utilities.
- Preserves Float32Array NaN semantics (per-beam `isFinite()` filter retained in
  the shared memo).
