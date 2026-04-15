# Quick 260415-9ww — /lidar deeper zoom, fit-to-15 m, viridis floor, smoother wheel, zoom readout

## Problem

After yesterday's `/lidar` standalone page ship (Quick 260414-w8p), user feedback:

1. The default view uses the driver's reported `range_max` (25 m for LD19) to fit
   the sweep, so the physically meaningful area (≤12 m) occupies under half the
   canvas before the user zooms.
2. Wheel zoom was clamped to `[0.25, 8]` — not enough headroom to inspect
   sub-meter detail or individual point clusters.
3. Wheel step used `1.0015^deltaY` — jumpy on mice (deltaY≈100) vs. crawling on
   trackpads (deltaY≈3).
4. No live indication of current zoom level, which makes "how zoomed am I?"
   unclear when inspecting a cluster.
5. At high zoom the original 3 px dot size turns close-by points into blobs.

## Scope

One file: `web/components/lidar/scan-canvas.tsx`. The anchored (`/map`) path
is explicitly untouched by guarding every change behind the `standalone` flag
or the standalone-only wheel handler closure.

## Changes

1. **Effective range constant**: `EFFECTIVE_RANGE_M = 15.0`. Used by the
   standalone wheel handler, standalone draw projector, and standalone legend
   label. Anchored mode still honors the driver's `range_max`. (Bumped from
   12 m after visual test — LD19 sometimes returns slightly past 12 m and
   those points were clamping to the LUT's max color; 15 m keeps them on
   the gradient.)
2. **Zoom clamp**: `ZOOM_MAX` 8 → 64. `ZOOM_MIN` unchanged at 0.25.
3. **Wheel curve**: `zoom *= Math.exp(-e.deltaY * 0.0015)` instead of
   `Math.pow(1.0015, -e.deltaY)`. Cursor-anchored pan math preserved.
4. **Legend "hi" label**: clamps to `min(EFFECTIVE_RANGE_M, driver_rmax)` in
   standalone mode only. Anchored mode keeps the driver value.
5. **Zoom readout**: new `<div>` in the bottom-left control stack, monospace,
   `zoom.toFixed(1) + '×'`, same dim-bg/border styling as the `+/-/⌂` buttons.
   Re-renders via `viewTick` bump (already fires on every wheel/drag/button).
6. **Point size**: standalone-only scales `pointSize = clamp(zoom * 0.15, 1, 3)`.
   Anchored mode keeps the fixed `3 px` (preserves `/map` rendering).
7. **Viridis floor remap (standalone only)**: `VIRIDIS_FLOOR_STANDALONE = 0.18`.
   Near-range points were rendering as RGB(68, 1, 84) — near-invisible on the
   page's black bg. The standalone draw loop and the standalone legend gradient
   both remap `t ∈ [0, 1]` → `0.18 + t * 0.82` before `sampleViridis`, lifting
   the low end into a clearly-visible violet/blue. `viridis.ts` is not modified
   (shared with `/map`, whose light OSM tiles render dark violet fine).

## Non-goals

- No new dependencies.
- No changes to `ScanOverlay`, `scan-store`, or `/map/page.tsx`.
- No changes to the anchored projector contract.

## Verify

- `npm run build` in `web/` succeeds.
- Deploy `scan-canvas.tsx` to Pi, rebuild `web` container, `docker compose up -d web`.
- `/lidar`: default view visibly fills the canvas (~90%) with a 15 m fit. Wheel
  zoom reaches much tighter detail than before. Zoom readout updates live.
  Near-range points render as visible violet/blue on black (no longer near-invisible).
  Legend bar shows `0 m` → `15 m` with the same remapped gradient as the draw.
- `/map`: still renders the GPS-anchored scan overlay identically (2 canvases:
  Leaflet's tile canvas + our scan canvas).

## Commit

`feat(web/quick-260415-9ww): deeper /lidar zoom, fit-to-12m, smoother wheel, zoom readout`

(Commit message kept as-is on the original commit; the 15 m bump + viridis floor
remap were amended onto it after visual-test feedback.)
