# Phase 3: Web Visualization — `/scan` on the Map Page - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Take the live `/scan` topic from Phase 2 and render it as a 2D polar overlay on the existing `/map` page, so an operator opening the dashboard in a browser sees a live 360° scan around the robot. This phase is the **Core Value gate** for the LD19 milestone — the end-to-end pipeline (hardware → driver → web) proven.

**Out of bounds for Phase 3:**
- Safety watchdog / `/cmd_vel` gating — explicitly deferred (PROJECT.md Out of Scope).
- Nav2 / SLAM integration — next milestone.
- Server-side changes beyond rosbridge config surface — no Docker/compose edits.
- Physical LD19 mount + TF measurement — still deferred until motors+chassis install (separate todo).
- Firmware `/odom` publisher — separate deferred todo.
- Changes to the Leaflet base map, tile source, or non-map pages.

</domain>

<decisions>
## Implementation Decisions

### Rendering Strategy
- **D-01:** Render the scan as a **Canvas 2D overlay pinned to the robot's Leaflet pixel position**, implemented as a custom React component that consumes `useMap()` from `react-leaflet` and draws onto a `<canvas>` absolutely positioned over the `MapContainer`. The overlay rotates with robot heading (from `useOdometryStore` or `/imu` yaw — planner picks the lower-jitter source). ros3djs / ros2djs / Leaflet-marker-per-point are explicitly rejected (REQUIREMENTS Out of Scope + performance).
- **D-02:** The overlay component lives at `web/components/map/scan-overlay.tsx`. It subscribes to `useScanStore` and re-draws on every store update. Drawing uses `requestAnimationFrame` to coalesce rapid updates.
- **D-03:** The overlay mounts inside `robot-map.tsx` as a child of `<MapContainer>`, layered above the robot marker but below the map controls.

### Scale Behavior
- **D-04:** The overlay scales with Leaflet zoom — meters in world stay meters on map. Implementation: on each redraw, query `map.getZoom()` and use Leaflet's pixel-per-meter conversion at the robot's current lat/lng (`map.latLngToLayerPoint` for two points 1 m apart, compute delta) to derive the pixels/meter factor. Canvas re-sizes on zoom/pan events.
- **D-05:** If lat/lng is not yet available (GPS fix pending), the overlay does NOT render — it waits for `useGpsStore` to provide a valid fix. No fallback to fixed-radius fake scale.

### CBOR + rosbridge Retrofit (SCOPE EXPANSION)
- **D-06:** `roslibjs` `compression: "cbor"` becomes the **global default** across all topic subscriptions — not just `/scan`. Rationale: CBOR is strictly smaller than JSON for float arrays and numeric fields, has no client-side parsing cost worth measuring, and is already supported by the current `rosbridge_server` version. The existing client-side `throttleMs` stays in place as a rendering-rate limiter.
- **D-07:** Because this touches every subscription, Phase 3 splits into two commits (mirrors Phase 2's two-commit pattern):
  - **Commit A:** Retrofit `subscribers.ts` to pass `{compression, throttle_rate, queue_length}` to `ROSLIB.Topic`. Extend `TOPICS` registry with per-topic defaults (all existing topics gain `compression: "cbor"`; `/scan` also gets `throttle_rate: 100`, `queue_length: 1`). Regression-gate all 6 existing subscriptions (`/fix`, `/imu`, `/odometry/filtered`, `/battery_voltage`, `/diagnostics`, `/mower/status`) — each store must still populate correctly in the browser under CBOR.
  - **Commit B:** Add `/scan` to `TOPICS`, create `useScanStore`, `<ScanOverlay>` component, mount in `robot-map.tsx`, stale-indicator badge, Foxglove layout file.
  - If Commit A's regression fails for any topic → revert retrofit commit, narrow CBOR to `/scan` only, document the deviation.
- **D-08:** `/scan` specifically uses: `compression: "cbor"`, `throttle_rate: 100` (ms — rosbridge decimates before send), `queue_length: 1` (no buffering), AND client-side `throttleMs: 100` (render-rate cap). Both layers needed per research pitfall #5.

### Stale-Scan Indicator + UX
- **D-09:** A dedicated stale-indicator badge lives **on the scan overlay**, not in the top-bar connection widget. Component: a small colored dot + text ("LIDAR: live" green / "LIDAR: stale" red) placed at the overlay's top-right corner. Threshold: red when no `/scan` message has arrived for >1.5 s, green otherwise. Implementation: `useScanStore` tracks `lastMessageAt: number | null`; a separate `useEffect` with `setInterval(200ms)` flips an `isStale` flag; the badge reads `isStale`.
- **D-10:** Color scheme for scan points is **viridis gradient** (perceptually uniform, colorblind-friendly, near = violet, far = yellow). Rationale: no conflation with "alarm red." Implementation: pre-computed 256-entry LUT, sample by normalized range `(r - rmin) / (rmax - rmin)`. Rmin/rmax per-scan from `LaserScan.range_min/range_max` (or fixed 0..8 m if those are unset).
- **D-11:** A small **legend** (compact color-bar `0 m → 8 m`) sits at the overlay's bottom-right corner. No separate "range rings" overlay this phase — keep it minimal. ROADMAP SC#5 "legend or range-ring annotation makes gradient readable" is satisfied by the color-bar legend.

### State Management
- **D-12:** New Zustand store `useScanStore` in `web/lib/store/scan-store.ts`. State shape:
  ```ts
  { latest: LaserScan | null, lastMessageAt: number | null, isStale: boolean }
  ```
  Mirrors the existing per-domain store pattern (`gps-store.ts`, `odometry-store.ts`). No persistence.
- **D-13:** `ScanOverlay` reads `latest` via `useScanStore` selector and stores converted Float32Array cartesian points in a `useMemo` keyed on the scan object identity, to avoid re-projection per frame.

### Foxglove Layout
- **D-14:** Commit `web/foxglove/mowerbot.foxglove-layout.json` with three panels minimum: `/scan` (LaserScan visualization), `/odometry/filtered` (Odometry / 3D tracking), `/fix` (NavSatFix / status). Optional fourth: `/imu` raw. Layout points at the existing rosbridge endpoint (default `ws://mower.local:9090` or env-configurable).
- **D-15:** `docs/foxglove-integration.md` documents how to load the layout in Foxglove Studio (File → Layout → Load from file) and points at the committed JSON.

### Claude's Discretion
- Exact math for `map.latLngToLayerPoint` pixels/meter conversion — standard Leaflet idiom, planner chooses concrete implementation.
- Animation frame management (single global RAF loop vs per-component RAF) — planner picks based on existing codebase patterns (check if any component already uses RAF).
- Viridis LUT source — hardcode a 256-entry array (small) or import a tiny npm package (e.g., `d3-scale-chromatic`). Planner picks based on dependency budget.
- Exact Foxglove panel configs (colors, thresholds) — planner/user refines after first open.
- Whether the stale-indicator badge is a shadcn `<Badge>` or a custom small div — match existing UI conventions (check `web/components/ui/` for `<Badge>` usage).
- Whether to expose `throttle_rate` as a per-topic optional field in the `TOPICS` registry or hardcode for `/scan` — planner picks; former is more flexible, latter is YAGNI.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` §"Phase 3: Web Visualization" — goal + 5 success criteria (SC#1 Core Value gate is the anchor).
- `.planning/REQUIREMENTS.md` §"Web Visualization" — VIZ-01 through VIZ-05.

### Phase 2 output (mandatory input)
- `.planning/phases/02-lidar-driver-scan-publication/02-01-SUMMARY.md` — confirms `/scan` live @ 9.9 Hz, BEST_EFFORT + KEEP_LAST(5), frame_id `laser_frame`, `base_link → laser_frame` identity placeholder TF.
- `docker/lidar/launch/lidar.launch.py` — the live publisher's config.

### Existing web patterns to mirror
- `web/components/map/robot-map.tsx` — Leaflet integration, MapContainer usage.
- `web/components/map/robot-marker.tsx` — how existing overlays pin to robot position.
- `web/lib/ros/subscribers.ts` + `topics.ts` + `ros-client.ts` — subscription infrastructure (Commit A touches all three).
- `web/lib/store/gps-store.ts`, `odometry-store.ts` — store shape reference for `useScanStore`.
- `web/components/ui/` — shadcn primitives for stale-indicator badge styling.

### Research
- `.planning/research/SUMMARY.md` §"Phase 3" — stack rationale, pitfalls 5/14/18 (bandwidth, rosbridge whitelist, canvas Y-axis flip).
- `.planning/research/PITFALLS.md` — full treatments.

### rosbridge + roslibjs reference
- `docker/rosbridge/Dockerfile` — existing rosbridge config (Phase 3 may need to verify CBOR is enabled server-side — usually default but confirm).
- roslibjs docs for `compression`, `throttle_rate`, `queue_length` — linked in RESEARCH phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`TOPICS` registry in `web/lib/ros/topics.ts`** — single source of truth for topic name/type/throttle. `/scan` gets a new entry.
- **`subscribe<T>()` helper in `subscribers.ts`** — currently forwards `name` + `messageType` only. Extended in Commit A to pass `compression`, `throttle_rate`, `queue_length` through to `ROSLIB.Topic`.
- **Zustand store pattern** — `create((set, get) => ({ ...state, update: (...) => set(...) }))`. `useScanStore` follows verbatim.
- **`robot-map.tsx`** — `<MapContainer>` already hosts `<TileLayer>`, robot marker, zone layer. `<ScanOverlay>` becomes a sibling.
- **`web/components/ui/` shadcn primitives** — use `<Badge>` for the LIDAR status indicator if it exists in the tree; otherwise custom div matching its visual language.

### Established Patterns
- All map children use `"use client"` and `react-leaflet` hooks (`useMap`, `useMapEvents`).
- Stores live in `web/lib/store/<name>-store.ts`, named `use<Name>Store`.
- Topic subscriptions initialized centrally; each store has its own `init()` that calls `subscribe()`.
- `commit_docs: true`, branching `none` — Phase 3 lands on `main`, two commits.

### Integration Points
- `web/app/map/page.tsx` dynamically imports `robot-map` — the new overlay piggybacks on this same client-side load path. No route changes.
- rosbridge on port `:9090` (via `web/server.mjs` `/rosbridge` proxy with NaN sanitization) — already load-bearing. Phase 3 does NOT touch `server.mjs`.
- `ROS_DOMAIN_ID=0` — `/scan` is already discoverable thanks to Phase 2's ipc/pid retrofit.

### Out of Scope for This Phase
- `firmware/`, `docker/`, `hardware/` — untouched.
- `web/app/` non-map pages — untouched (dashboard, teleop, missions, settings).
- `web/server.mjs` — untouched (NaN sanitizer already handles edge cases).

</code_context>

<specifics>
## Specific Ideas

- User emphasized **global CBOR retrofit** over per-topic opt-in, explicitly accepting the Phase-2-style two-commit pattern with regression-gate on all existing topics. Not a scope reduction — a scope expansion the user chose after seeing Phase 2's retrofit work cleanly.
- Viridis over warm/cool — user explicitly avoided the "red = alarm" trap. Perceptually uniform matters more than intuitive-at-first-glance for this use case (user will look at the overlay for long sessions).
- Stale-indicator lives ON the overlay, not in the top-bar connection widget. Visual affordance: "the thing that shows the LIDAR works is also the thing that tells me it stopped."
- Leaflet-coupled scale — scan scales with map zoom. Means the overlay is a true geo-overlay, not a standalone radar scope. Accepts the extra Leaflet math.

</specifics>

<deferred>
## Deferred Ideas

- **Range-ring overlay (2m/5m/10m concentric circles)** — not added this phase; color-bar legend is sufficient. Revisit if user feedback says distance reading is hard.
- **Scan history / motion trails** — `useScanStore` is latest-only. No ring buffer.
- **Point-click drill-down** (hover to see range/angle) — v2 / polish phase.
- **Foxglove auto-discovery of rosbridge endpoint** — layout file hardcodes `ws://mower.local:9090` or similar; user can edit after import. Auto-discovery is an enhancement.
- **SLAM map overlay on top of the GPS tiles** — explicitly deferred per PROJECT.md Out of Scope.
- **Mobile (phone) optimization for the overlay** — desktop-first. Mobile works because existing map page is responsive; overlay inherits.

</deferred>

---

*Phase: 03-web-visualization-scan-on-the-map-page*
*Context gathered: 2026-04-14*
