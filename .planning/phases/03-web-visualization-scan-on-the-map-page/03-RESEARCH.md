# Phase 3: Web Visualization — `/scan` on the Map Page — Research

**Researched:** 2026-04-14
**Domain:** Browser-side 2D LiDAR visualization — react-leaflet 5 + Canvas 2D overlay + roslibjs 2.1.0 + rosbridge CBOR + Zustand, with global retrofit of existing subscription options.
**Confidence:** HIGH for stack/APIs, code patterns, pitfalls; MEDIUM for the `server.mjs` × CBOR interaction (flagged — must be verified at execution).

---

## Summary

Phase 3 is almost entirely frontend. The driver work (Phase 2) already publishes `/scan` as `sensor_msgs/LaserScan` at 9.9 Hz with BEST_EFFORT KEEP_LAST(5) QoS through rosbridge-server on port 9090. The browser needs to (a) subscribe with `compression: "cbor"` + `throttle_rate: 100` + `queue_length: 1`, (b) cache the latest scan in a new Zustand `useScanStore`, (c) render it as a Canvas 2D polar overlay pinned to the robot's Leaflet pixel position and scaled with zoom via `map.latLngToLayerPoint`, (d) show a stale-scan badge, a viridis gradient, and a legend, and (e) commit a Foxglove layout JSON pointing at the existing rosbridge endpoint.

The scope expansion locked in CONTEXT — **global CBOR retrofit across all 6 existing subscriptions** — is the highest-risk part of the phase. It mirrors Phase 2's two-commit + regression-gate pattern. The sharp edge is that **CBOR arrives as WebSocket binary frames**, while the `server.mjs` NaN sanitizer currently runs a text regex on every incoming frame — this must be verified at execution because it could either (a) silently mangle CBOR byte streams if the bytes happen to contain `:NaN` sequences, or (b) work fine because `Buffer.toString("utf-8")` of valid CBOR rarely produces those sequences. This is the single most important thing the planner must ensure is probed during the Commit A regression gate.

**Primary recommendation:** Execute the two-commit pattern exactly. In Commit A, extend `subscribe()` and `TOPICS` to thread `{compression, throttle_rate, queue_length}` into `new ROSLIB.Topic(...)`, flip global CBOR, and run a 6-topic regression matrix including an explicit "NaN-path GPS message still parses in browser under CBOR" check. In Commit B, add `/scan` to `TOPICS`, build `useScanStore`, `<ScanOverlay>` (Canvas 2D inside `<MapContainer>`, `useMap()`, single `requestAnimationFrame` loop, hardcoded 256-entry viridis LUT), and ship the Foxglove layout. Use shadcn `<Badge variant="success|error">` for the stale indicator — it already exists in the tree with the exact color variants needed. Use `setInterval(200ms)` for stale detection (1.5s threshold); browser tab throttling is not a concern because it delays the flip but does not cause false positives in the foreground tab that the operator is looking at.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Rendering Strategy**
- **D-01:** Render the scan as a **Canvas 2D overlay pinned to the robot's Leaflet pixel position**, implemented as a custom React component that consumes `useMap()` from `react-leaflet` and draws onto a `<canvas>` absolutely positioned over the `MapContainer`. The overlay rotates with robot heading (from `useOdometryStore` or `/imu` yaw — planner picks the lower-jitter source). ros3djs / ros2djs / Leaflet-marker-per-point are explicitly rejected.
- **D-02:** The overlay component lives at `web/components/map/scan-overlay.tsx`. It subscribes to `useScanStore` and re-draws on every store update. Drawing uses `requestAnimationFrame` to coalesce rapid updates.
- **D-03:** The overlay mounts inside `robot-map.tsx` as a child of `<MapContainer>`, layered above the robot marker but below the map controls.

**Scale Behavior**
- **D-04:** Overlay scales with Leaflet zoom. Implementation: on each redraw, query `map.getZoom()` and use `map.latLngToLayerPoint` on two points 1 m apart to derive pixels/meter. Canvas re-sizes on zoom/pan events.
- **D-05:** If lat/lng is not yet available (GPS fix pending), the overlay does NOT render — it waits for `useGpsStore` to provide a valid fix. No fallback to fixed-radius fake scale.

**CBOR + rosbridge Retrofit (SCOPE EXPANSION)**
- **D-06:** `roslibjs` `compression: "cbor"` becomes the **global default** across all topic subscriptions — not just `/scan`. Existing client-side `throttleMs` stays as a render-rate limiter.
- **D-07:** Two-commit structure:
  - **Commit A:** Retrofit `subscribers.ts` to pass `{compression, throttle_rate, queue_length}` to `ROSLIB.Topic`. Extend `TOPICS` registry with per-topic defaults (all existing gain `compression: "cbor"`; `/scan` also gets `throttle_rate: 100`, `queue_length: 1`). Regression-gate all 6 existing subscriptions.
  - **Commit B:** Add `/scan` to `TOPICS`, create `useScanStore`, `<ScanOverlay>`, stale badge, Foxglove layout.
  - Rollback rule: if Commit A regression fails for any topic → revert retrofit commit, narrow CBOR to `/scan` only, document the deviation.
- **D-08:** `/scan` uses `compression: "cbor"`, `throttle_rate: 100` (ms), `queue_length: 1`, AND client-side `throttleMs: 100`. Both layers needed per pitfall #5.

**Stale-Scan Indicator + UX**
- **D-09:** Stale-indicator badge lives **on the scan overlay**, not top-bar. Small colored dot + text ("LIDAR: live" green / "LIDAR: stale" red) at overlay's top-right. Threshold: red when no `/scan` for >1.5 s. `useScanStore` tracks `lastMessageAt`; `useEffect` with `setInterval(200ms)` flips `isStale`.
- **D-10:** Color scheme = **viridis gradient** (perceptually uniform, colorblind-friendly, near=violet, far=yellow). Pre-computed 256-entry LUT, sample by `(r - rmin) / (rmax - rmin)`. Rmin/rmax from `LaserScan.range_min/range_max` (fallback 0..8 m).
- **D-11:** Compact color-bar legend `0 m → 8 m` at overlay's bottom-right. No range rings this phase.

**State Management**
- **D-12:** `useScanStore` in `web/lib/store/scan-store.ts`: `{ latest: LaserScan | null, lastMessageAt: number | null, isStale: boolean }`. No persistence.
- **D-13:** `ScanOverlay` stores converted Float32Array cartesian points in `useMemo` keyed on scan object identity.

**Foxglove Layout**
- **D-14:** Commit `web/foxglove/mowerbot.foxglove-layout.json` with `/scan`, `/odometry/filtered`, `/fix` panels (optional `/imu`). Layout points at rosbridge endpoint (default `ws://mower.local:9090` or env-configurable).
- **D-15:** `docs/foxglove-integration.md` explains loading the layout in Foxglove Studio.

### Claude's Discretion

- Exact `map.latLngToLayerPoint` pixels/meter idiom — standard Leaflet pattern, planner picks concrete code.
- RAF management strategy (single global loop vs per-component) — planner picks based on existing codebase patterns.
- Viridis LUT source — hardcode 256-entry array or npm package.
- Whether stale-indicator is shadcn `<Badge>` or custom div.
- Whether `TOPICS` registry exposes `throttle_rate` as per-topic optional field or hardcodes for `/scan`.

### Deferred Ideas (OUT OF SCOPE)

- Range-ring overlay (2m/5m/10m circles).
- Scan history / motion trails (`useScanStore` latest-only, no ring buffer).
- Point-click drill-down (hover to see range/angle).
- Foxglove auto-discovery of rosbridge endpoint.
- SLAM map overlay on GPS tiles.
- Mobile-specific optimizations.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIZ-01 | Canvas 2D polar scan overlay on `web/app/map/page.tsx` fed by Zustand `useScanStore` — Core Value gate | See **Standard Stack** (Canvas 2D + react-leaflet idiom), **Code Examples** §1 (overlay skeleton), **Pitfalls** §P1 (Y-axis flip) |
| VIZ-02 | Rosbridge subscribe with `throttle_rate: 100`, `compression: "cbor"`, `queue_length: 1` | See **Standard Stack** (roslibjs Topic options), **Code Examples** §2 (subscribers.ts retrofit), **Pitfalls** §P2 (CBOR × NaN sanitizer) |
| VIZ-03 | Stale-scan indicator turns red if no `/scan` for >1.5 s, green otherwise | See **Code Examples** §3 (stale detection), **Pitfalls** §P5 (tab throttling) |
| VIZ-04 | Foxglove layout JSON at `web/foxglove/mowerbot.foxglove-layout.json` with `/scan`, `/odom`, `/fix` panels | See **Code Examples** §5 (Foxglove layout schema) |
| VIZ-05 | Scan points colored on distance gradient, legend readable | See **Code Examples** §4 (viridis LUT), **Standard Stack** (hardcoded LUT vs d3) |

---

## Project Constraints (from CLAUDE.md)

- **Next.js 16 / React 19 App Router** — map page dynamically imports `robot-map` with `ssr: false`. All map children MUST use `"use client"`. `<ScanOverlay>` is a map child and follows this rule. [CITED: CLAUDE.md Constraints + web/app/map/page.tsx]
- **Zustand stores** live at `web/lib/store/<name>-store.ts` named `use<Name>Store`. `useScanStore` MUST match. [CITED: CLAUDE.md Conventions]
- **CycloneDDS, rosbridge WebSocket, NaN sanitization layer are load-bearing — preserve.** Phase 3 MUST NOT break any of these. The NaN sanitizer in `server.mjs` is the riskiest intersection with the CBOR retrofit — see Pitfall P2. [CITED: CLAUDE.md Constraints]
- **GSD workflow enforcement:** edits go through planning artifacts. Phase 3 lands on `main` (branching=none per `.planning/config.json`), two commits, `commit_docs: true` for plan/research. [CITED: .planning/config.json]
- **`@/` import alias** resolves to `web/`. Every new file uses it. [CITED: CLAUDE.md Conventions]
- **ESLint rule `@typescript-eslint/no-explicit-any` set to warn.** Avoid `any` in new code. [CITED: CLAUDE.md Conventions]

---

## Standard Stack

### Core (already in the tree — zero new runtime dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react-leaflet` | ^5 | `<MapContainer>`, `useMap()`, TileLayer, custom overlay mount point | Already the only map library in the project [VERIFIED: web/package.json] |
| `leaflet` | ^1.9 | Projection math: `map.latLngToLayerPoint`, `map.getZoom()`, `map.project/unproject` | Underlying lib of react-leaflet [VERIFIED: web/package.json] |
| `roslib` | ^2.1.0 | `ROSLIB.Topic` with `compression`, `throttle_rate`, `queue_length`, `queue_size` options | Already used for every existing subscription [VERIFIED: web/package.json, web/lib/ros/subscribers.ts] |
| `zustand` | ^4.5.7 | `useScanStore` — mirrors `useGpsStore`, `useOdometryStore` exactly | Established per-domain store pattern [VERIFIED: web/lib/store/*.ts] |
| `class-variance-authority` | ^0.7.1 | Already powers `<Badge>` with `success`/`error` variants needed for the stale indicator | Already in tree [VERIFIED: web/components/ui/badge.tsx] |
| Canvas 2D API | browser built-in | `ctx.fillRect`, `ctx.arc`, `ctx.putImageData` (viridis LUT path) for 456 points @ 10 Hz | No library faster/smaller than native canvas for this workload [ASSUMED — standard benchmark knowledge] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn `<Badge>` | local (cva) | Stale-indicator pill with `variant="success"` (green) or `variant="error"` (red) | Use directly — variants already exist at web/components/ui/badge.tsx lines 17–22 [VERIFIED] |

### Alternatives Considered (and rejected)

| Instead of | Could Use | Tradeoff — Why Rejected |
|------------|-----------|--------------------------|
| Hardcoded 256-entry viridis LUT (Float32Array) | `d3-scale-chromatic` (~20 KB) | 256 RGB triplets = 768 bytes inline; adding a package for one LUT is wasteful. **Pick: hardcode.** [ASSUMED — bundle size estimate] |
| `requestAnimationFrame` per-component loop | Single global RAF manager | No other component in the codebase uses RAF [VERIFIED by grep: no hits for `requestAnimationFrame` in `web/`]. Per-component RAF inside `<ScanOverlay>` is simpler and YAGNI for a single overlay. **Pick: per-component RAF, one loop.** |
| shadcn `<Badge>` for stale indicator | Custom `<div>` with Tailwind | `<Badge>` already exists with exact `success`/`error` variants [VERIFIED]. **Pick: reuse `<Badge>`.** |
| `throttle_rate` as per-topic TOPICS field | Hardcode for `/scan` only | Extensible per-topic field costs 2 lines of code and makes future `/scan/viz` variants trivial. **Pick: per-topic optional field.** |
| ros3djs / ros2djs / react-leaflet Circle-per-point | Canvas 2D via `useMap()` | Already rejected in REQUIREMENTS Out of Scope + Pitfall 5; 456 React nodes @ 10 Hz destroys reconciliation. **Pick: Canvas 2D.** [CITED: REQUIREMENTS.md line 72] |

**Installation:** None. Zero new npm packages. [VERIFIED: web/package.json lists roslib, leaflet, react-leaflet, zustand, CVA — all present]

**Version verification:** Not needed — no new packages. Existing versions (`roslib@^2.1.0`, `react-leaflet@^5`, `leaflet@^1.9`, `zustand@^4.5.7`) match what's installed and are sufficient.

### rosbridge / CBOR Compatibility Note

- `rosbridge_server` (Humble, built from `docker/rosbridge/Dockerfile` via apt `ros-humble-rosbridge-server`) supports CBOR **out of the box**. CBOR is **completely opt-in** — the server never emits CBOR binary frames unless a subscriber requests `compression: "cbor"` [CITED: https://github.com/RobotWebTools/rosbridge_suite/issues/367].
- No Dockerfile / compose change needed. Commit A is purely client-side.
- CBOR binary payload arrives on the WebSocket as a **binary frame** (not text) [CITED: ROSBRIDGE_PROTOCOL.md — "When CBOR compression is requested by a subscriber, a binary message will be produced instead of a JSON string"]. This is the crux of Pitfall P2 below.

---

## Architecture Patterns

### Recommended File Structure (Phase 3 additions)

```
web/
├── components/
│   └── map/
│       ├── robot-map.tsx            # modified: mount <ScanOverlay />
│       └── scan-overlay.tsx         # NEW — Canvas 2D + useMap + viridis
├── lib/
│   ├── ros/
│   │   ├── subscribers.ts           # modified: thread {compression, throttle_rate, queue_length}
│   │   └── topics.ts                # modified: per-topic compression; add SCAN entry
│   ├── store/
│   │   └── scan-store.ts            # NEW — useScanStore
│   ├── types/
│   │   └── ros-messages.ts          # modified: add LaserScan type
│   └── viridis.ts                   # NEW — 256-entry Uint8Array LUT
└── foxglove/
    └── mowerbot.foxglove-layout.json  # NEW

docs/
└── foxglove-integration.md          # NEW

web/lib/store/ros-store.ts           # modified: add subscribe<LaserScan>("SCAN", ...) to setupSubscriptions()
```

### Pattern 1: Canvas overlay inside `<MapContainer>` via `useMap()`

**What:** `<ScanOverlay>` is a react-leaflet child component (renders null as React output) that uses `useMap()` to grab the Leaflet instance, then manages an absolutely-positioned `<canvas>` overlay via a ref. It listens for Leaflet `zoom` and `move` events to resize and reposition the canvas.

**When to use:** Any time you need pixel-accurate custom drawing on top of Leaflet tiles that must track lat/lng.

**Pitfalls addressed:** 5 (bandwidth — Canvas not SVG/per-point), 14 (rosbridge whitelist — N/A for Humble default), **18 (canvas Y-axis flip — the big one: canvas Y increases downward, ROS/world Y increases upward, so polar-to-cartesian must negate Y before drawing)**.

### Pattern 2: Two-commit retrofit pattern (Phase 2 precedent)

**What:** Commit A changes a shared primitive (here: `subscribe()` + `TOPICS`). Commit A includes no new features — just the retrofit + a regression matrix. Commit B adds the new feature.

**When to use:** Any change that touches a primitive used by many existing consumers. Enables `git revert` of Commit A without losing Commit B work.

**Established by:** Phase 2's `x-ros-common` retrofit (Commit A `8337318`) + lidar service add (Commit B `f3bdb00`) [VERIFIED: git log].

### Pattern 3: Zustand per-domain store, subscribe via `ros-store.setupSubscriptions()`

**What:** `useScanStore` has state + `updateScan(msg: LaserScan)` action. Registration in `web/lib/store/ros-store.ts` `setupSubscriptions()` is a single `subscribe<LaserScan>("SCAN", (msg) => useScanStore.getState().updateScan(msg))` line mirroring the 5 existing subscriptions [VERIFIED: web/lib/store/ros-store.ts lines 60–91].

### Anti-Patterns to Avoid

- **DON'T subscribe to `/scan` from `<ScanOverlay>` directly.** All subscriptions go through `ros-store.setupSubscriptions()` to get HMR survival via `window.__mower_active_subs` and cleanup-before-reconnect [VERIFIED: web/lib/store/ros-store.ts lines 37–55]. `<ScanOverlay>` reads from the store only.
- **DON'T draw the canvas as a raw DOM child of `<MapContainer>`.** Use the react-leaflet `useMap()` pattern and attach the canvas to `map.getPanes().overlayPane` — or more simply, absolutely-position the canvas inside the parent `<div>` that hosts the MapContainer (same pattern as existing `<MapControls>` which is a sibling of `<MapContainer>`). Planner picks; canvas-as-sibling is simpler and matches existing controls layout [VERIFIED: web/components/map/robot-map.tsx lines 90–148].
- **DON'T add `<ScanOverlay>` as a child of `<MapContainer>` AND also absolutely-position it over the map.** Pick one. Recommend: child of `<MapContainer>` using `useMap()` inside, returns `null`, manages an external canvas ref mounted to the map's overlay pane or to an absolutely-positioned container div. This mirrors how existing overlays like `FollowRobot` (line 35 of `robot-map.tsx`) work — they live as children of `<MapContainer>`, call `useMap()`, and return `null`.
- **DON'T re-project scan points every frame.** Use `useMemo` keyed on scan object identity (D-13). Re-projection is needed only when the scan itself changes (10 Hz → 100ms), not every RAF (60 Hz).
- **DON'T recreate the canvas on every redraw.** Create once, clear via `ctx.clearRect(...)` before each draw.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Map projection math | Manual Mercator math | `map.latLngToLayerPoint(latlng)` | Leaflet already handles zoom, tile boundaries, and CRS. One function call. [CITED: leafletjs.com/reference.html] |
| ROS → JS bridging | Custom WebSocket parser | `roslibjs 2.1.0` (already in tree) | Existing primitive. Threading 3 extra options through is the whole Commit A. [VERIFIED] |
| Stale WebSocket reconnection | Custom timer | Existing `ros-client.ts` exponential backoff | Already works; Phase 3 does NOT touch it. [VERIFIED: web/lib/ros/ros-client.ts lines 234–246] |
| HMR-safe subscription tracking | Try-catch around unsubscribe | `window.__mower_active_subs` pattern | Established, documented, load-bearing. [VERIFIED: web/lib/store/ros-store.ts] |
| NaN-in-JSON handling | New sanitizer in browser | `server.mjs` existing regex proxy | Already load-bearing. Phase 3 does NOT touch it. But see Pitfall P2 for CBOR interaction. [VERIFIED: web/server.mjs] |
| Viridis color computation | On-the-fly HSV/LAB conversion | Pre-computed 256-entry Uint8Array LUT | LUT is O(1) per point; computed is O(many float ops). 456 points × 10 Hz = 4560 ops/s — LUT is essentially free. [ASSUMED — standard graphics knowledge] |
| LaserScan decoding | Parse CBOR manually | Let roslibjs decode — callback receives a plain JS object | roslibjs handles CBOR decoding when you opt in via `compression: "cbor"`. The callback signature is unchanged from JSON. [CITED: roslibjs Topic.js JSDoc] |

**Key insight:** Phase 3 adds zero libraries. Every primitive it needs is in the tree. The only new TypeScript is application code: one store, one component, one LUT, one type, one JSON layout, one doc.

---

## Runtime State Inventory

> Phase 3 is a feature addition, not a refactor — but the CBOR retrofit touches existing state. Tracked for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None. No persisted state touched. [VERIFIED: scan-store holds latest-only, no persistence] | None |
| Live service config | `rosbridge_server` config is built from `docker/rosbridge/Dockerfile` (no params file exists). CBOR is opt-in client-side — no server-side config change needed. [VERIFIED via Dockerfile + CITED via rosbridge-suite issue #367] | None |
| OS-registered state | None. No systemd unit, cron, udev rule added. | None |
| Secrets/env vars | None new. `NEXT_PUBLIC_ROSBRIDGE_URL` and `ROSBRIDGE_URL` unchanged. [VERIFIED: web/server.mjs + ros-client.ts] | None |
| Build artifacts | Next.js `.next/` will rebuild on next `npm run build`. Docker `web` service image must be rebuilt to include the new overlay component + Foxglove JSON. [VERIFIED: docker-compose.yml web service] | `docker compose build web && docker compose up -d web` after commits |
| Running browsers | **Existing open browser tabs will still be running old JS after deploy.** The CBOR flip affects the new tab's subscribe — old tabs keep JSON. No mixed-mode risk because each browser negotiates its own subscribe. | Operator refresh OK; no coordination required |

**The canonical question (adapted):** After commits land and `web` container rebuilds, what runtime systems still have stale state? Answer: nothing meaningful. Each browser tab's subscription is independent; rosbridge_server handles per-subscriber compression negotiation. The one thing to verify post-deploy is `server.mjs` does not crash on binary CBOR frames (see P2).

---

## Common Pitfalls

### P1 — Canvas Y-axis flip (PITFALLS.md #18)

**What goes wrong:** LaserScan angles follow ROS REP-103 (counter-clockwise, +X forward, +Y left). Canvas Y increases **downward**. If you compute `x = r*cos(θ); y = r*sin(θ); ctx.fillRect(x,y,1,1)` directly, the scan appears mirrored top-to-bottom. An obstacle that is physically in front of the robot appears behind.

**Why it happens:** Screen coordinates are the default for every 2D graphics API. ROS/world coordinates are not.

**How to avoid:**
- Negate Y when drawing: `cx = canvas.width/2 + x*pxPerMeter; cy = canvas.height/2 - y*pxPerMeter`.
- Apply an explicit `ctx.save(); ctx.translate(cx,cy); ctx.scale(1,-1);` and then draw in world-frame — more readable.
- Write a one-time validation comment in the overlay: "asymmetric obstacle on robot's LEFT should appear on the LEFT of the canvas."

**Warning signs:** Users report the scan "looks mirrored" or "inverted." tf2_echo shows correct orientation. RViz shows correct orientation. Only the web overlay is wrong.

---

### P2 — CBOR binary frames × `server.mjs` NaN sanitizer (NEW — most critical pitfall this phase)

**What goes wrong (hypothesized):** The current `server.mjs` proxy calls `sanitizeNaN(data)` on every incoming frame (line 87). For JSON text frames, `data` is a string or Buffer of UTF-8 JSON — regex works fine. For CBOR, `data` is a WebSocket binary frame carrying raw bytes. The current code:

```js
function sanitizeNaN(data) {
  if (typeof data === "string") { ...regex... }
  const str = data.toString("utf-8");                    // <-- binary → lossy UTF-8 decode
  if (str.includes("NaN")) { ...regex... return str; }   // <-- if "NaN" appears by coincidence
  return str;                                            // <-- ALWAYS returns string
}
```

**Two failure modes:**
1. `clientWs.send(str)` transmits the payload as a **text frame** — roslibjs sees a text frame while it expected binary CBOR and either (a) fails to decode, (b) silently drops, or (c) throws. Browser console will show CBOR decode errors.
2. By-chance occurrence of the byte sequence `:NaN` or `,NaN` inside a CBOR payload causes the regex to mangle bytes — silent data corruption. Low probability but nonzero.

**Why it happens:** The sanitizer was written for JSON-only. CBOR retrofit was never anticipated.

**How to avoid:**
- **MUST verify** this at Commit A regression time. The regression matrix MUST include: open DevTools, set `compression: "cbor"` on `/fix`, watch for CBOR decode errors in console AND verify `useGpsStore.latitude` still populates.
- **If broken:** narrow the sanitizer to text frames only. Concrete fix (planner should scope this into Commit A if needed):
  ```js
  rosbridgeWs.on("message", (data, isBinary) => {
    if (clientWs.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      clientWs.send(data, { binary: true });          // pass-through, no sanitize
    } else {
      clientWs.send(sanitizeNaN(data));
    }
  });
  ```
  The `ws` library provides `isBinary` as the second arg to the `message` event — this is the clean guard.
- **Cannot verify in research — requires live browser + rosbridge test.** Planner MUST include this probe as an explicit regression row.

**Warning signs:**
- Browser console: `Cannot process BSON encoded message without BSON header` [CITED: roslibjs issue #315] or `Unexpected token` CBOR decode errors.
- Zustand stores stop updating for one or more topics after CBOR flip.
- Chrome DevTools Network → WS tab shows frames marked "Binary" but payload shown as garbled text.

**Confidence:** MEDIUM on the failure mode, HIGH that the probe is mandatory. The existing code does `data.toString("utf-8")` unconditionally, which is a red flag for binary transport.

---

### P3 — `throttle_rate` is the rosbridge-server decimation; `throttleMs` is the client render throttle — BOTH needed per D-08

**What goes wrong:** Developer sets only `throttle_rate: 100` thinking the browser is safe. Or sets only client `throttleMs: 100` and lets full-rate CBOR frames saturate WebSocket.

**Why it happens:** They sound equivalent. They are not. `throttle_rate` is the minimum interval between messages **the server sends** (bandwidth cap). `throttleMs` is the minimum interval between messages **the client callback processes** (CPU/RAF cap). With 10 Hz source:
- `throttle_rate: 100` alone → 10 Hz on the wire, 10 Hz into the callback. Usually fine.
- `throttleMs: 100` alone → 10 Hz on the wire (full bandwidth), callback skips 50% of the work. Wire saturation risk with 2 clients.
- Both → 10 Hz on the wire, ~10 Hz into callback. Idempotent at 10 Hz, defensive if upstream rate changes.

**How to avoid:** Per D-08, both. Not optional. `TOPICS.SCAN = { name: "/scan", messageType: "sensor_msgs/LaserScan", compression: "cbor", throttle_rate: 100, queue_length: 1, throttleMs: 100 }`.

**Warning signs:** Chrome DevTools Network → WS shows buffered-amount growing with 2 browser tabs open.

---

### P4 — `subscribe()` currently ignores any option beyond `name` + `messageType`

**What goes wrong (confirmed now, not hypothetical):** Current `subscribers.ts` line 25–29 builds `new ROSLIB.Topic({ ros, name, messageType })` — no compression, no throttle_rate, no queue_length. Adding the options to `TOPICS` alone does nothing unless `subscribe()` is extended.

**Why it happens:** The primitive was written before CBOR/throttle was needed.

**How to avoid:** Commit A MUST modify `web/lib/ros/subscribers.ts` lines 25–29 to destructure optional fields from `topicDef` and pass them through. Example:
```ts
const topic = new ROSLIB.Topic({
  ros,
  name: topicDef.name,
  messageType: topicDef.messageType,
  ...("compression" in topicDef ? { compression: topicDef.compression } : {}),
  ...("throttle_rate" in topicDef ? { throttle_rate: topicDef.throttle_rate } : {}),
  ...("queue_length" in topicDef ? { queue_length: topicDef.queue_length } : {}),
});
```
Or simpler: make `TOPICS` entries declare those optional fields and spread-pass them. Planner picks.

---

### P5 — `setInterval(200ms)` stale detection and browser tab throttling

**What goes wrong:** When a browser tab is backgrounded, browsers throttle `setInterval` to ≥1s (often 10s). The stale flag may take 10+s to flip after the lidar stops.

**Why it happens:** Chrome/Firefox spec-conformant background throttling.

**How to avoid:** Not an issue for this use case. The operator opens the dashboard **to look at the scan**. The stale-badge is meant to be visible in the foreground tab. Background tabs don't need accurate stale detection. **If the overlay is foregrounded, `setInterval(200ms)` works fine.** [ASSUMED: operator use case per CONTEXT D-09 — user looks at overlay.]

**Alternative if stricter behavior wanted:** Use `requestAnimationFrame` timestamps in the same RAF loop that draws. Skip it — YAGNI this phase.

---

### P6 — `map.latLngToLayerPoint` per frame is fine; `map.project` per point is not

**What goes wrong:** If you call `map.latLngToLayerPoint(scanPointLatLng)` for all 456 beams, you invoke Leaflet projection math 456×/frame — measurable CPU.

**Why it happens:** The temptation is "compute each beam's lat/lng, project to pixels." This is wrong — scan points are in the robot frame (`laser_frame`), not world lat/lng.

**How to avoid:** Project the robot's lat/lng ONCE per frame to get a pixel anchor + a pixels-per-meter factor (via two test points 1 m apart), then do the polar-to-pixel math in plain arithmetic on the Float32Array. 456 beams × sin/cos + 2 Leaflet calls per frame = trivial.

**Confirmed code shape:**
```ts
const robotPx = map.latLngToLayerPoint([lat, lng]);
const oneMeterNorthPx = map.latLngToLayerPoint([lat + ONE_METER_LAT_DEG, lng]);
const pxPerMeter = Math.abs(oneMeterNorthPx.y - robotPx.y);
// then for each beam:
//   const x = robotPx.x + range * Math.cos(angle) * pxPerMeter;
//   const y = robotPx.y - range * Math.sin(angle) * pxPerMeter;   // Y flip for canvas
```
`ONE_METER_LAT_DEG ≈ 1 / 111320` at the equator. Standard latitude approximation is accurate enough for sub-kilometer scales.

---

### P7 — `range = Infinity` and `range = NaN` both mean "no return," both must be skipped

**What goes wrong:** LD19 driver outputs `Infinity` for out-of-range and NaN for no-return. If you draw them, you get crashes (NaN → no pixel) or bogus points at max-distance.

**How to avoid:**
```ts
for (let i = 0; i < ranges.length; i++) {
  const r = ranges[i];
  if (!isFinite(r) || r < range_min || r > range_max) continue;
  // project + draw
}
```
This is straight out of PITFALLS.md pitfall 8 transposed to the viz layer.

---

### P8 — Foxglove "Rosbridge (ROS 1 & 2)" connector, not "Foxglove WebSocket"

**What goes wrong:** User imports the layout, opens Foxglove Studio, clicks "Open connection," selects "Foxglove WebSocket," points at `ws://mower.local:9090` → fails because rosbridge speaks the rosbridge protocol, not Foxglove's native protocol.

**How to avoid:** `docs/foxglove-integration.md` MUST explicitly say: *Use the "Rosbridge (ROS 1 & 2)" connector tab* [CITED: https://docs.ros.org/en/jazzy/How-To-Guides/Visualizing-ROS-2-Data-With-Foxglove.html]. The layout JSON itself can store the rosbridge URL in its `layout.globalVariables` or the saved connection — planner chooses minimal approach (usually: no embedded connection, user enters URL once).

---

## Code Examples

Verified patterns from official sources and the existing codebase.

### §1 — `<ScanOverlay>` skeleton (NEW file)

```tsx
// web/components/map/scan-overlay.tsx
"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { useGpsStore } from "@/lib/store/gps-store";
import { useImuStore } from "@/lib/store/imu-store";
import { useScanStore } from "@/lib/store/scan-store";
import { yawToHeading } from "@/lib/utils/quaternion";
import { VIRIDIS } from "@/lib/viridis";

// Source: Leaflet idiom via react-leaflet 5 useMap() + map.latLngToLayerPoint
// https://leafletjs.com/reference.html#map-latlngtolayerpoint
export function ScanOverlay() {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Store selectors (re-render only on the fields we read)
  const latest = useScanStore((s) => s.latest);
  const lat = useGpsStore((s) => s.latitude);
  const lng = useGpsStore((s) => s.longitude);
  const yaw = useImuStore((s) => s.yaw);

  // Create canvas once, mount to overlayPane (or the parent container — planner picks)
  useEffect(() => {
    const pane = map.getPanes().overlayPane;
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 pointer-events-none";
    canvas.style.zIndex = "400";
    pane.appendChild(canvas);
    canvasRef.current = canvas;

    const resize = () => {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
    };
    resize();
    map.on("resize zoom move", resize);

    return () => {
      map.off("resize zoom move", resize);
      pane.removeChild(canvas);
      canvasRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [map]);

  // Redraw on scan/pose change via RAF
  useEffect(() => {
    if (!canvasRef.current || lat === null || lng === null || !latest) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      draw(canvasRef.current!, map, latest, lat, lng, yawToHeading(yaw));
    });
  }, [latest, lat, lng, yaw, map]);

  return null; // canvas is managed imperatively; this component renders no React children
}
```

### §2 — `subscribers.ts` retrofit (Commit A)

```ts
// web/lib/ros/subscribers.ts — MODIFIED in Commit A
import * as ROSLIB from "roslib";
import { getRos } from "./ros-client";
import { TOPICS } from "./topics";

type MessageHandler<T = unknown> = (message: T) => void;
interface ThrottledSubscriber { topic: ROSLIB.Topic; unsubscribe: () => void }

export function subscribe<T = unknown>(
  topicKey: keyof typeof TOPICS,
  callback: MessageHandler<T>
): ThrottledSubscriber {
  const topicDef = TOPICS[topicKey] as Record<string, unknown> & {
    name: string;
    messageType: string;
  };
  const ros = getRos();

  // Source: http://robotwebtools.org/jsdoc/roslibjs/current/Topic.html
  const topic = new ROSLIB.Topic({
    ros,
    name: topicDef.name,
    messageType: topicDef.messageType,
    ...("compression" in topicDef ? { compression: topicDef.compression as string } : {}),
    ...("throttle_rate" in topicDef ? { throttle_rate: topicDef.throttle_rate as number } : {}),
    ...("queue_length" in topicDef ? { queue_length: topicDef.queue_length as number } : {}),
  });

  let lastCall = 0;
  const throttleMs = typeof topicDef.throttleMs === "number" ? topicDef.throttleMs : 0;

  const handler = (message: unknown) => {
    if (throttleMs > 0) {
      const now = Date.now();
      if (now - lastCall < throttleMs) return;
      lastCall = now;
    }
    callback(message as T);
  };

  topic.subscribe(handler);
  return { topic, unsubscribe: () => topic.unsubscribe(handler) };
}
```

```ts
// web/lib/ros/topics.ts — MODIFIED in Commit A (per-topic compression)
export const TOPICS = {
  FIX:           { name: "/fix",               messageType: "sensor_msgs/NavSatFix",       compression: "cbor", throttleMs: 200 },
  IMU:           { name: "/imu",               messageType: "sensor_msgs/Imu",             compression: "cbor", throttleMs: 200 },
  ODOMETRY:      { name: "/odometry/filtered", messageType: "nav_msgs/Odometry",           compression: "cbor", throttleMs: 100 },
  BATTERY:       { name: "/battery_voltage",   messageType: "std_msgs/Float32",            compression: "cbor", throttleMs: 0 },
  DIAGNOSTICS:   { name: "/diagnostics",       messageType: "diagnostic_msgs/DiagnosticArray", compression: "cbor", throttleMs: 0 },
  MOWER_STATUS:  { name: "/mower/status",      messageType: "std_msgs/String",             compression: "cbor", throttleMs: 0 },
  // Commit B adds:
  SCAN:          { name: "/scan",              messageType: "sensor_msgs/LaserScan",
                   compression: "cbor", throttle_rate: 100, queue_length: 1, throttleMs: 100 },
  // Published-only topics (no compression needed):
  CMD_VEL:       { name: "/cmd_vel",       messageType: "geometry_msgs/Twist" },
  MOWER_COMMAND: { name: "/mower/command", messageType: "std_msgs/String" },
} as const;
```

### §3 — `useScanStore` + stale detection (Commit B)

```ts
// web/lib/store/scan-store.ts — NEW
"use client";
import { create } from "zustand";
import type { LaserScan } from "@/lib/types/ros-messages";

interface ScanState {
  latest: LaserScan | null;
  lastMessageAt: number | null;
  isStale: boolean;
  updateScan: (msg: LaserScan) => void;
  setStale: (stale: boolean) => void;
}

export const useScanStore = create<ScanState>((set) => ({
  latest: null,
  lastMessageAt: null,
  isStale: true,
  updateScan: (msg) => set({ latest: msg, lastMessageAt: Date.now(), isStale: false }),
  setStale: (stale) => set({ isStale: stale }),
}));
```

```tsx
// Stale detector — lives inside <ScanOverlay> or its own tiny hook
useEffect(() => {
  const id = setInterval(() => {
    const s = useScanStore.getState();
    const stale = s.lastMessageAt === null || Date.now() - s.lastMessageAt > 1500;
    if (stale !== s.isStale) s.setStale(stale);
  }, 200);
  return () => clearInterval(id);
}, []);
```

```tsx
// Stale badge — uses existing shadcn <Badge>
import { Badge } from "@/components/ui/badge";
<Badge variant={isStale ? "error" : "success"}>
  LIDAR: {isStale ? "stale" : "live"}
</Badge>
```

### §4 — Viridis 256-entry LUT (Commit B)

```ts
// web/lib/viridis.ts — NEW
// Source: matplotlib viridis colormap sampled at 256 steps.
// Emitted as a flat Uint8Array [R0,G0,B0,R1,G1,B1,...] for O(1) lookup.
// Generated via `matplotlib.cm.get_cmap('viridis', 256)` then flattened.
// Keeps the bundle addition to ~768 bytes inline (plus a few lines of boilerplate).
export const VIRIDIS: Uint8Array = new Uint8Array([
  /* 768 bytes — 256 RGB triplets. Planner: paste the full array here.
     Commonly available from d3-scale-chromatic or matplotlib. The planner can
     either (a) write a one-time Python script to dump these at plan time, or
     (b) paste a known-good LUT from a public source (e.g., https://github.com/
     sjmgarnier/viridis/blob/master/R/viridisPalette.R). */
]);

export function sampleViridis(t: number, out: Uint8Array, offset: number): void {
  const i = Math.max(0, Math.min(255, Math.floor(t * 255)));
  const j = i * 3;
  out[offset] = VIRIDIS[j];
  out[offset + 1] = VIRIDIS[j + 1];
  out[offset + 2] = VIRIDIS[j + 2];
}
```

### §5 — Foxglove layout JSON skeleton (Commit B, VIZ-04)

```json
{
  "configById": {
    "3D!scan": {
      "topics": { "/scan": { "visible": true } },
      "followTf": "base_link",
      "cameraState": { "distance": 15, "perspective": true }
    },
    "RawMessages!fix": { "topicPath": "/fix" },
    "Plot!odom": { "paths": [{ "value": "/odometry/filtered.twist.twist.linear.x", "enabled": true }] }
  },
  "globalVariables": {},
  "userNodes": {},
  "playbackConfig": { "speed": 1 },
  "layout": {
    "first": "3D!scan",
    "second": {
      "first": "RawMessages!fix",
      "second": "Plot!odom",
      "direction": "column"
    },
    "direction": "row",
    "splitPercentage": 60
  }
}
```

**Caveat:** The precise Foxglove layout schema evolves. Planner should open the committed layout in Foxglove Studio, arrange panels the user wants, "Download layout" to re-export, and commit the exported version. This JSON is a minimal starting point. [CITED: https://docs.foxglove.dev/docs/visualization/layouts]

### §6 — `LaserScan` type (Commit B — add to `ros-messages.ts`)

```ts
// Add to web/lib/types/ros-messages.ts
export interface LaserScan {
  header: { stamp: { sec: number; nanosec: number }; frame_id: string };
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  time_increment: number;
  scan_time: number;
  range_min: number;
  range_max: number;
  ranges: number[];        // from CBOR these arrive as plain arrays of numbers
  intensities: number[];   // may be empty
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JSON over rosbridge | CBOR over rosbridge for numeric messages | rosbridge_suite added CBOR 2018 [CITED: issue #367]; mature and default-friendly for Humble | Smaller payload + faster decode for LaserScan-like messages |
| `ros3djs` / `ros2djs` for web viz | Canvas 2D + custom component | Projects abandoned ros3djs for React 18+ | Full control, no React-version hostility [CITED: REQUIREMENTS Out of Scope] |
| SVG with React nodes per scan point | Single `<canvas>` + imperative draw | Canvas perf established since ~2015 | Trivial scaling to 500+ points at 60 FPS |

**Deprecated:**
- ros3djs: no active maintenance, incompatible with React 19.
- Leaflet `.svg` overlays for dense point sets: works, but ~100× slower for 456 nodes.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `server.mjs` proxy correctly passes CBOR binary frames unchanged — unverified; regex-sanitizer path might corrupt bytes. | Pitfall P2 | **HIGH.** If wrong, ALL CBOR subscriptions fail silently and Commit A rollback is needed. Mitigation: explicit regression probe in Commit A matrix. |
| A2 | `ws` library delivers binary WebSocket frames to `on("message")` with `isBinary=true` as second arg (standard `ws` API). | Pitfall P2 | LOW. This is standard `ws` 8.x behavior. Trivial to verify in the fix code. |
| A3 | Hardcoded 256-entry viridis LUT is ~768 bytes and preferable to adding `d3-scale-chromatic` (~20 KB minified). | Standard Stack | LOW. Planner can always install the package if hardcoding is painful. |
| A4 | Browser tab foreground throttling does NOT affect stale detection for the operator use case. | Pitfall P5 | LOW. Operator explicitly looks at the overlay; tab is foreground by definition. |
| A5 | `map.latLngToLayerPoint` at `lat + 1/111320 deg` returns consistent pixels/meter for sub-km mowing yards. | Pattern P6 | LOW. Latitude approximation degrades at high latitudes; MowerBot use case is residential yards. |
| A6 | `roslibjs 2.1.0` supports `queue_length` as a Topic constructor option in ROS2 mode. | Standard Stack | LOW-MEDIUM. CITED on JSDoc. Planner should dump the actual subscribe op sent by roslibjs in Commit A to confirm (`chrome://net-export/` or DevTools). |
| A7 | `web` service rebuild (`docker compose build web && up -d web`) is enough to deploy — no image pin, no cache bust. | Runtime State Inventory | LOW. Matches Phase 2 deploy pattern. |
| A8 | `<Badge>` variants `success`/`error` exist and render correctly. | Standard Stack | NONE — VERIFIED directly via Read of `web/components/ui/badge.tsx`. |

---

## Open Questions

1. **Does the `server.mjs` proxy pass WebSocket binary frames unchanged?**
   - What we know: current code calls `.toString("utf-8")` on every incoming frame and returns a string. This is likely wrong for binary CBOR.
   - What's unclear: whether `clientWs.send(str)` silently converts back to binary or sends as text frame (protocol violation).
   - Recommendation: Commit A regression matrix MUST include a live probe. If broken, include the `isBinary` guard fix in Commit A (scope slightly expands but is necessary for the retrofit to actually work).

2. **Where should `<ScanOverlay>` mount its canvas — `map.getPanes().overlayPane` or a sibling `<div>` of `<MapContainer>`?**
   - What we know: Either works. `overlayPane` rides the Leaflet pan/zoom transform for free; sibling `<div>` requires manual repositioning on move events.
   - What's unclear: Which gives smoother visual during `zoom` transitions (the pane's zoom animation vs. a static overlay that snaps).
   - Recommendation: Start with `overlayPane` because it's less code. If zoom animation looks jarring, switch to sibling-`<div>` with `moveend`/`zoomend` redraw.

3. **Should `throttleMs` and `throttle_rate` on `/scan` be equal?**
   - What we know: both are 100 ms per D-08.
   - What's unclear: Whether both are actually needed or if one is redundant — possibly a belt-and-suspenders decision.
   - Recommendation: Per D-08, both. Locked. Do not re-litigate.

4. **Robot heading source — `/imu` yaw vs. `/odometry/filtered` yaw?**
   - What we know: `useImuStore` already exposes `yaw`; `RobotMarker` uses it [VERIFIED: web/components/map/robot-marker.tsx line 35].
   - What's unclear: EKF output (`/odometry/filtered`) is typically less jittery than raw IMU yaw, but `useOdometryStore` currently only stores linear/angular velocity + position — NOT orientation [VERIFIED: web/lib/store/odometry-store.ts].
   - Recommendation: **Use `useImuStore.yaw`** — it's already wired, already feeds `RobotMarker`, and Phase 3 must keep scope minimal. Adding `orientation` to `odometry-store.ts` is a nice-to-have but not required. Planner: mirror `RobotMarker`'s source exactly so overlay rotation and marker rotation stay in lockstep.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 | web container build | ✓ | 22-alpine | — |
| `roslib` npm package | subscribers.ts | ✓ | 2.1.0 | — |
| `react-leaflet` | `<ScanOverlay>` useMap | ✓ | ^5 | — |
| `leaflet` | projection math | ✓ | ^1.9 | — |
| `zustand` | useScanStore | ✓ | ^4.5.7 | — |
| Docker + compose | web rebuild | ✓ (Pi) | — | — |
| rosbridge_server CBOR support | `/scan` subscribe | ✓ | Humble default [CITED: issue #367] | If broken: compression: "none" + client throttleMs only |
| Foxglove Studio | manual VIZ-04 verification | N/A (user-side) | desktop app | User must install separately; doc explains |

**No missing dependencies.** All runtime pieces exist in the current tree.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **None currently installed.** The project has no Jest, Vitest, or Playwright config [VERIFIED: `web/package.json` has no test script, no test dependency]. |
| Config file | none |
| Quick run command | n/a |
| Full suite command | n/a |

Given the project has no automated test infrastructure and this is a feature addition gated by a Core Value demonstration (operator opens browser and sees the scan), the validation strategy is **manual verification + ESLint + Next.js build + live browser regression**, not unit/integration tests.

### Phase Requirements → Verification Map

| Req ID | Behavior | Verification Type | Automated Command | Evidence |
|--------|----------|-------------------|-------------------|----------|
| VIZ-01 | Canvas 2D polar overlay renders on /map page fed by useScanStore | Manual + DevTools | `npm run build && npm run start`, open browser to `/map` | Screenshot of live overlay with robot position + scan points |
| VIZ-02 | Browser subscribes with throttle_rate=100, compression=cbor, queue_length=1; WS buffered-amount does not grow over 5 min with 2 clients | DevTools Network tab | Chrome DevTools → Network → WS → inspect outgoing `{"op":"subscribe"...}` frame; confirm fields. Open `chrome://net-internals/#events` or WS tab `bufferedAmount` column over 5 min with 2 tabs. | Screenshot of subscribe frame + buffered-amount timeseries |
| VIZ-03 | Stale indicator red within 1.5 s of lidar stop, green within 1.5 s of restart | Manual (live Pi) | `ssh pi@10.10.40.23 "cd ~/mowbot && docker compose stop lidar"` → watch browser → `docker compose start lidar` | Video or two screenshots |
| VIZ-04 | Foxglove layout opens and shows `/scan`, `/odom`, `/fix` panels with live data | Manual (Foxglove Studio) | Install Foxglove → File → Open Layout → `web/foxglove/mowerbot.foxglove-layout.json` → Open Connection → Rosbridge tab → `ws://mower.local:9090` | Screenshot of Foxglove showing populated panels |
| VIZ-05 | Gradient coloring legible; legend readable | Visual | Same as VIZ-01 browser session | Same screenshot shows gradient + color-bar legend |

### Commit A Regression Matrix (Phase-2-pattern)

Planner MUST include these exact probes in the 01-PLAN:

| # | Check | Command / Procedure | Pass Criterion |
|---|-------|---------------------|----------------|
| 1 | `server.mjs` survives CBOR binary frames | After Commit A, open `/map` in Chrome with DevTools console open. Watch for 30 s. | No `Cannot process BSON` or CBOR decode errors in console. |
| 2 | `/fix` → `useGpsStore.latitude` still updates | DevTools console: `useGpsStore.getState().latitude` after 5 s. | Non-null, non-zero matching live GPS. |
| 3 | `/imu` → `useImuStore.yaw` still updates | `useImuStore.getState().yaw` after 5 s. | Non-null, changes over 10 s. |
| 4 | `/odometry/filtered` → `useOdometryStore.linearSpeed` still updates | `useOdometryStore.getState().lastUpdate` after 5 s. | Non-zero, within last 500 ms. |
| 5 | `/battery_voltage` → `useBatteryStore` still updates | Same pattern as above. | Store populates within 5 s. |
| 6 | `/diagnostics` subscribe does not error | DevTools Network WS → look for `{"op":"subscribe","topic":"/diagnostics","compression":"cbor"}` outgoing and no error response. | No rosbridge error frame in return. |
| 7 | `/mower/status` same | Same. | Same. |
| 8 | Subscribe frame bytes correct | DevTools Network WS → click outgoing subscribe frame → inspect JSON. | Contains `"compression":"cbor"` for all 6 pre-existing topics. |
| 9 | WS buffered-amount bounded | Open 2 browser tabs on `/map` for 3 minutes, watch WS bufferedAmount in Network tab. | `bufferedAmount` stays < 50 KB (no monotonic growth). |
| 10 | ESLint passes | `cd web && npm run lint` | No errors, warnings only for existing `any`. |
| 11 | Next.js build passes | `cd web && npm run build` | Exit 0. |
| 12 | Commit A reverts cleanly if needed | Dry-run `git revert --no-commit <commitA>` | Only `subscribers.ts` + `topics.ts` affected, no conflicts. |

**If any row 1–9 fails:** Follow CONTEXT D-07 rollback — revert retrofit, narrow CBOR to `/scan` only, document deviation in Commit B's summary.

### Commit B Acceptance (Success Criteria)

- SC#1 Core Value: `npm run build` + fresh docker stack → operator sees live scan on `/map`. Screenshot.
- SC#2 WS bounded: 5-min 2-client session, bufferedAmount flat. Chrome DevTools graph.
- SC#3 Stale badge: 1.5 s transition on lidar stop/start. Two screenshots + timestamps.
- SC#4 Foxglove: Layout loads and populates. Screenshot.
- SC#5 Readability: Gradient + legend visible. Included in SC#1 screenshot.

### Sampling Rate

- **Per task commit:** `cd web && npm run lint` (fast; catches syntax/type issues).
- **Per Commit (A and B):** `npm run build` + Commit A regression matrix (A) or Commit B acceptance (B).
- **Phase gate:** All 5 SCs manually demonstrated via screenshots in `03-01-SUMMARY.md`.

### Wave 0 Gaps

- **No automated test framework exists.** Installing Vitest / Playwright is out of scope for this phase (too large a dependency delta and no existing habit). Planner explicitly accepts manual verification. If the user wants automated browser tests later, that's a separate phase.

---

## Security Domain

> CLAUDE.md does not explicitly enable `security_enforcement`. Applying default-on standard review.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | NO | Dashboard is LAN-only, no auth by design (PROJECT.md — "cloud telemetry / remote access beyond LAN" is anti-feature). |
| V3 Session Management | NO | N/A |
| V4 Access Control | NO | N/A |
| V5 Input Validation | PARTIAL | `/scan` ranges come from a trusted driver on the same host. No user input is introduced this phase. |
| V6 Cryptography | NO | N/A — WebSocket is `ws://` on LAN. |

### Known Threat Patterns for Browser + rosbridge

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| WebSocket buffer exhaustion (10 Hz × 2 clients × uncapped) | Denial-of-Service | `throttle_rate: 100` + `compression: "cbor"` + `queue_length: 1` (D-08) |
| Malformed CBOR frame crashes roslibjs | Denial-of-Service (browser crash) | roslibjs catches decode errors — verify in Commit A regression probe 1. |
| XSS via `/mower/status` JSON.parse | Tampering | Already mitigated: `useMissionStore` only reads specific fields, does not inject into DOM [VERIFIED: web/lib/store/ros-store.ts lines 73–89]. |
| Scan coordinate injection (negative `range_min`) | Tampering | Filter with `isFinite(r) && r >= range_min && r <= range_max` (Pitfall P7). Driver-trusted but defend-in-depth is cheap. |

No new secrets, no new authentication surface, no new remote endpoints.

---

## Sources

### Primary (HIGH confidence)

- `web/lib/ros/subscribers.ts`, `topics.ts`, `ros-client.ts`, `ros-store.ts` — verified by Read [VERIFIED]
- `web/components/map/robot-map.tsx`, `robot-marker.tsx` — verified by Read [VERIFIED]
- `web/components/ui/badge.tsx` — verified by Read [VERIFIED]
- `web/package.json` — verified by Read [VERIFIED]
- `web/server.mjs` — verified by Read [VERIFIED]
- `.planning/research/PITFALLS.md` — pitfalls 5, 14, 18 apply directly [CITED]
- `.planning/phases/02-lidar-driver-scan-publication/02-01-SUMMARY.md` — confirms `/scan` @ 9.9 Hz, BEST_EFFORT KEEP_LAST(5), `laser_frame` TF identity [CITED]
- [roslibjs Topic.js JSDoc](http://robotwebtools.org/jsdoc/roslibjs/current/Topic.html) — `compression`, `throttle_rate`, `queue_length` option names [CITED]
- [rosbridge_suite ROSBRIDGE_PROTOCOL.md](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md) — binary CBOR transport [CITED]
- [rosbridge_suite issue #367 — CBOR compression summary](https://github.com/RobotWebTools/rosbridge_suite/issues/367) — CBOR is opt-in, server auto-supports [CITED]
- [Leaflet reference — latLngToLayerPoint](https://leafletjs.com/reference.html) — projection API [CITED]

### Secondary (MEDIUM confidence)

- [ROS 2 Jazzy docs — Visualizing ROS 2 data with Foxglove](https://docs.ros.org/en/jazzy/Related-Projects/Visualizing-ROS-2-Data-With-Foxglove.html) — Foxglove connector type (Rosbridge tab, not Foxglove WebSocket tab) [CITED]
- [Foxglove docs changelog](https://docs.foxglove.dev/) — layout JSON schema evolves; committed layout should be user-exported post-arrangement [CITED]
- [roslibjs issue #315 — CBOR BSON header error](https://github.com/RobotWebTools/roslibjs/issues/315) — symptom pattern for CBOR misconfig [CITED]

### Tertiary (LOW confidence, kept honest)

- Hardcoded-LUT-vs-d3 bundle-size estimate — derived knowledge, not measured [ASSUMED]
- `server.mjs` CBOR-safety prediction — inferred from reading the sanitizer code; not empirically tested [ASSUMED — must probe in Commit A]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in `web/package.json`, versions verified.
- Architecture: HIGH — mirrors established patterns (Zustand per-domain, subscribers.ts primitive, react-leaflet useMap).
- Pitfalls: HIGH for Canvas Y-flip, CBOR mechanics, RAF loop; MEDIUM for `server.mjs` CBOR × NaN sanitizer interaction (requires live probe).
- Validation: HIGH — manual verification strategy is concrete, regression matrix is specific to this phase.

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (30 days — frontend stack is stable, rosbridge Humble is stable)
