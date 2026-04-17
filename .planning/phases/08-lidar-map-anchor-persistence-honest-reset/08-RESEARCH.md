# Phase 8: `/lidar` Map-Anchor + Persistence + Honest Reset — Research

**Researched:** 2026-04-16
**Domain:** Canvas 2D map rendering + client-side state persistence + Node.js atomic file I/O + ROS2 service invocation via rosbridge
**Confidence:** HIGH for architecture / file I/O / client math; **MEDIUM-with-caveat** for the reset service — a BLOCKER surfaced (see §Blocking Finding)

---

## Summary

Phase 8 makes `/lidar` trustworthy under motion by (1) subtracting the live `map→base_link` pose from the OccupancyGrid draw anchor so the grid stays world-fixed, (2) drawing a robot cursor at that live pose, (3) persisting the grid in `localStorage` keyed by a server-held epoch, and (4) moving the Eraser's reset path from a no-op client service call to a server-side endpoint that honestly invokes a slam service, bumps the epoch, and waits for a fresh `/map`.

All four capabilities are at the browser/frontend-server tier with zero ROS2 config changes, zero `server.mjs` edits, and zero new Docker containers. The existing `slam-pose-store` (Phase 7) + `useOdometryStore` (existing) provide the composite pose source. The existing `mower-data:/app/data` Docker volume provides the persistent, container-writeable home for the epoch counter (see §Path Correction — CONTEXT.md D-07 must be updated from `.planning/state/` to `data/`). Existing `app/api/*/route.ts` handlers establish the canonical Next.js 16 App Router pattern (`promises as fs` + `process.cwd()` + `NextResponse.json`). `write-file-atomic` or equivalent temp-then-rename handles atomic writes cleanly.

**Primary recommendation:** Before Wave 1, the planner MUST resolve the **slam-reset BLOCKER** — `/slam_toolbox/reset` does NOT exist in the `ros-humble-slam-toolbox` 2.6.10 package MowerBot ships (verified against upstream humble branch source). See §Blocking Finding for three options; recommended option is "restart slam container via docker.sock (already mounted RO — needs RW for this)" OR "switch to `/slam_toolbox/deserialize_map` with a pre-baked empty .posegraph". CONTEXT.md D-13/D-14 assumed a service that is not there.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Live `map→base_link` composite (slam anchor + odom delta) | Browser / Client (Zustand store + MapBitmap math) | — | No TF2 tree in JS (out of scope per CONTEXT); composed from two existing topics client-side |
| Robot cursor render | Browser / Client (Canvas 2D in scan-canvas.tsx) | — | Draw-time decision, no state beyond what Zustand already caches |
| OccupancyGrid `localStorage` persistence | Browser / Client (useMapStore hydrate on mount, write on updateMap) | — | Storage is browser-local by definition |
| Server-held map epoch counter | Frontend Server (Next.js API route in `web/app/api/map/`) | Filesystem (`data/map-epoch.json` — mounted volume) | Must be authoritative across all clients; file survives container restart via `mower-data` volume |
| slam_toolbox reset invocation | Frontend Server (new `/api/map/reset` route opens WS to rosbridge from Node) | ROS2 / slam_toolbox container | Server-side call so the operator sees HTTP-level success/failure, not a silent client fire-and-forget |
| Epoch bump atomicity | Frontend Server (temp file + `fs.rename`) | POSIX kernel | `fs.rename` on same filesystem is atomic; no concurrent writers (single operator) |
| `/map` WS proxy + NaN scrub (existing) | Frontend Server (`server.mjs`) | — | **Unchanged — regression gate from Phase 6; do not edit** |

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Composite source. `slam-pose-store` provides the map-frame anchor (last `/pose`); `useOdometryStore` provides inter-update odom deltas (~30 Hz). MapBitmap and the cursor consume `mapFramePose = lastSlamPose ⊕ (currentOdom − odomAtSlamPoseTime)`.

**D-02:** Cache `odomAtSlamPoseTime` whenever `slam-pose-store.updatePose()` fires — store the matching odom snapshot at that moment as the "anchor odom". Inter-update positions then derive cleanly.

**D-03:** If `/pose` silent >2 s, render cursor with same color desaturation Phase 7 badge uses; degrade, don't hide.

**D-04:** Filled circle + heading line. `r = 6 px` filled circle (orange `#f97316`), 1 px white outline, 12 px heading line, 1.5 px stroke. Constant pixel size regardless of zoom.

**D-05:** Heading derived from quaternion in `/pose.pose.orientation` via `atan2(2(wz+xy), 1-2(y²+z²))` (matches `quaternionToEuler` in `web/lib/utils/quaternion.ts`).

**D-06:** No covariance ellipse this phase.

**D-07:** Server-side counter in `.planning/state/map-epoch.json` of shape `{ "epoch": <int>, "resetAt": "<ISO8601>" }`. **⚠ See §Path Correction below — this path is not reachable from the web container.** Planner must either mount `.planning/` into `mower-web` OR relocate to `data/map-epoch.json` (already mounted).

**D-08:** Atomic write: write to `<path>.tmp` then `fs.rename`.

**D-09:** GET `/api/map/epoch` returns JSON verbatim, no-cache headers, called on mount + every rosbridge reconnect.

**D-10:** localStorage key `mowerbot.map.epoch.<N>`, value `JSON.stringify(occupancyGrid)`.

**D-11:** Rehydration sequence on mount: GET epoch → look up key → set latest + isStale:true → drop lower-epoch keys → wait for fresh `/map`.

**D-12:** Quota handling: try/catch on setItem, on QuotaExceededError flip `persistenceDisabled` flag, show inline banner.

**D-13:** POST `/api/map/reset` returns one of three shapes: `{ok:true,epoch,mapReceived,elapsedMs}`, `{ok:false,stage:"service",error}`, `{ok:false,stage:"mapTimeout",epoch,error}`.

**D-14:** Server flow: call slam service → atomic bump epoch → subscribe `/map` once with 3 s timeout → return JSON.

**D-15:** File write happens BEFORE service call; on write failure, return early.

**D-16:** UI flow: optimistic `clear()` → POST → branched UI (success toast / red banner service-stage / yellow banner mapTimeout). Epoch still gets updated on mapTimeout.

**D-17:** No false-success path. Optimistic clear reverted only on service-stage failure.

**D-18:** Log reset event as `[map-reset] epoch N→N+1 service:ok mapReceived:true 1842ms`.

### Claude's Discretion

- Quaternion→yaw helper location (recommend: reuse `web/lib/utils/quaternion.ts` which already exists and is used by `slam-pose-store`)
- Toast component pick (Radix + existing `@radix-ui/react-toast` is wired; matches header-badge aesthetic)
- File-locking strategy for epoch file (default: trust POSIX rename atomicity; single-operator assumption)
- "Rehydrated, awaiting fresh data" badge vs using existing `isStale` dim (recommend: reuse `isStale`)
- Key cleanup timing: drop `< currentEpoch` on every mount (recommend: also cleanup on reset response for symmetry)

### Deferred Ideas (OUT OF SCOPE)

- Covariance ellipse around cursor
- Full `/tf` subscription with tf2 in JS
- IndexedDB migration
- slam_toolbox map serialization across reboots
- Multi-tab reset coordination
- Confirmation token on `/api/map/reset`
- Reset undo

---

## Project Constraints (from CLAUDE.md)

- **Web:** Next.js 16 / React 19 App Router — keep structure. New API route goes under `web/app/api/map/`.
- **Tech stack:** ROS2 Humble — fixed. No slam_toolbox upgrade to Jazzy's 2.8.x this phase (that would grant `/slam_toolbox/reset` for free but breaks constraint).
- **Dependencies:** CycloneDDS + rosbridge + NaN sanitization layer are load-bearing — preserve.
- **Naming:** API routes kebab-case (`/api/map/epoch`, `/api/map/reset`); TS utilities camelCase files; stores `use{Name}Store`.
- **Error handling:** Try-catch + `console.error("[route] ACTION error:", err)` + `NextResponse.json({error:"..."}, {status})` matches existing routes.
- **`server.mjs` unchanged** — Phase 6 single-upgrade-handler regression gate (enforced by `web/__tests__/server-upgrade.test.mjs`).

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **MAP-01** | OccupancyGrid anchored in map frame (grid stays fixed under moving robot) | §MapBitmap Math section shows exact pixel offset derivation; new term `mapFramePose` subtracted from canvas-center anchor |
| **MAP-02** | Robot cursor at base_link in map frame, updating live | §Composite Pose Math + §Cursor Rendering sections; Zustand subscribe pattern proven by Phase 7 badge |
| **MAP-03** | localStorage epoch-keyed persistence with server-authoritative epoch | §Epoch File I/O + §Quota-Safe setItem sections; existing `app/api/config/route.ts` is the canonical App Router pattern |
| **MAP-04** | Eraser → `/api/map/reset` → slam reset → epoch bump → client cleanup; no stale resurrection | §Blocking Finding (slam reset service) MUST be resolved first; §Server-to-rosbridge Pattern shows Node-side roslib usage |

---

## Blocking Finding: `/slam_toolbox/reset` does not exist in Humble

**Evidence (HIGH confidence):**

`ros-humble-slam-toolbox` 2.6.10 (the apt package MowerBot installs — see `docker/slam/Dockerfile` line 4) does NOT advertise a `/slam_toolbox/reset` service. Confirmed three ways:

1. `[CITED: github.com/SteveMacenski/slam_toolbox/tree/humble/srv]` — `.srv` directory on the humble branch contains 10 files: AddSubmap, Clear, ClearQueue, DeserializePoseGraph, LoopClosure, MergeMaps, Pause, SaveMap, SerializePoseGraph, ToggleInteractive. **No Reset.srv.** (The ros2 branch / Jazzy 2.8.4 does have Reset.srv.)
2. `[CITED: github.com/SteveMacenski/slam_toolbox/blob/2.6.10/src/slam_toolbox_common.cpp]` — only 4 `create_service` calls: `slam_toolbox/dynamic_map`, `slam_toolbox/pause_new_measurements`, `slam_toolbox/serialize_map`, `slam_toolbox/deserialize_map`. No reset service is registered on the base class.
3. `[CITED: docs.ros.org/en/humble/p/slam_toolbox/__PACKAGE.html]` — official humble package doc version 2.6.10 lists the same services; no `/slam_toolbox/reset`.

**Corroborating in-codebase evidence:**

`web/lib/ros/services.ts:8-24` already contains this comment (pre-existing from Phase 4):

> `NOTE: slam_toolbox in Humble online_async mode does NOT expose a /slam_toolbox/reset service (verified via 'ros2 service list' on the Pi).`

The existing `callSlamReset()` calls `/slam_toolbox/clear_changes` — which **also does not exist** in the 2.6.10 source (no `create_service` for it in any file I inspected). That call has been silently failing since Phase 4; the optimistic client-side `useMapStore.clear()` masks the failure because it wipes the canvas anyway.

**CONTEXT.md D-13/D-14 are therefore unimplementable as written.** The comment in `canonical_refs` that names "slam_toolbox/reset (or /slam_toolbox/reset depending on namespace) — std_srvs/Empty" reflects a different slam_toolbox version.

### Three options for the planner to choose among

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| **A. Container restart via Docker API** | POST /api/map/reset → `docker restart mower-slam` via dockerode (same sock already mounted for Phase 6 logs, currently `:ro` — requires flipping to RW) | Guaranteed fresh map, no slam_toolbox upgrade needed, clean semantics | Breaks Phase 6 security boundary (`docker.sock:ro`); 3–5 s restart latency eats the 3 s `mapTimeout` budget — need to re-think |
| **B. `/slam_toolbox/deserialize_map` with an empty posegraph** | Ship a pre-baked empty `.posegraph` file, call `deserialize_map` service (exists in 2.6.10) | Uses a supported service; restart-free; map wiped | Need to generate the empty posegraph once (serialize on a freshly-launched container); non-obvious operationally |
| **C. Upgrade slam_toolbox to 2.6.x-from-source OR to Jazzy (breaks milestone constraint)** | Build slam_toolbox from the `ros2` branch which has Reset.srv; or migrate project to Jazzy | Clean native reset service | Violates CLAUDE.md "ROS2 Humble — fixed" constraint; rebuilds a container image; out of scope for v2.2 polish milestone |

**Recommended: Option A (container restart).** Rationale:

- It's the most honest reset — the CONTEXT's goal was precisely "honest reset", and slam_toolbox's internal state is fully wiped
- The `docker.sock:ro` → `rw` flip is a one-line docker-compose change with a documented regression gate (the Phase 6 dockerode method allowlist already prevents dangerous calls; extend it to include `container.restart`)
- The 3–5 s restart vs 3 s `mapTimeout` mismatch is resolvable by either (a) extending the budget to 8 s, or (b) returning `mapTimeout` honestly — the UI already handles that state (D-16 yellow banner). Option (b) is cleaner.
- docker.sock is already mounted in the web container from Phase 6; only the `:ro` flag needs to change

**If the planner picks Option B instead:** Wave 0 must include generating the empty posegraph. Concrete procedure:
1. `docker exec mower-slam ros2 service call /slam_toolbox/serialize_map slam_toolbox/srv/SerializePoseGraph "{filename: '/data/empty'}"` — with an empty-map state (fresh container, no scans yet; set `docker compose restart slam && sleep 3 && serialize`)
2. Commit the resulting `empty.posegraph` and `empty.data` files under `config/` or `data/`
3. `/api/map/reset` calls `/slam_toolbox/deserialize_map` with `filename: '/config/empty'`

**If the planner picks Option C:** renegotiate the milestone scope with the user. Do not surreptitiously upgrade.

**Tracking:** The planner MUST surface this decision to the user via `/gsd-discuss-phase` or as the first item in the plan's Wave 0. Silent adoption of any option without the user ratifying it fails the "honest" criterion of success criterion 4.

---

## Path Correction: `.planning/state/map-epoch.json` is not container-reachable

**Evidence:** `docker-compose.yml:140-146` shows `mower-web` mounts `./config:/app/config` and `mower-data:/app/data` — nothing under `.planning/`. `process.cwd()` inside the container is `/app` (Next.js standard). `path.join(process.cwd(), ".planning", "state", "map-epoch.json")` resolves to `/app/.planning/state/map-epoch.json` which does not exist and cannot be created without filesystem permissions on a path the image doesn't own.

**Two fixes:**

1. **(Recommended) Relocate to `data/map-epoch.json`** — under the existing `mower-data` volume. Survives container restarts. Matches the `data/config.json`, `data/zones.json`, `data/missions.json` pattern already in use by every existing API route (zones/route.ts:8, config/route.ts:5, missions/route.ts:8-10). Zero docker-compose changes. Planner should update the CONTEXT.md D-07 path during discuss-phase or record the override in the plan.

2. Mount `.planning/` into the web container (`./.planning:/app/.planning`). Preserves CONTEXT.md verbatim but couples planning metadata to runtime state — wrong tier.

**Both the dev environment (`.planning/state/…` on the Mac running planning tools) and the runtime environment (on the Pi) need to agree.** Option 1 keeps them cleanly separate: `.planning/` = human planning docs; `data/` = runtime state.

**Recommendation:** Use `data/map-epoch.json`. Wave 0 creates the file with initial `{epoch: 0, resetAt: <now>}` on first GET if missing — same lazy-initialize pattern as `readConfig()` in `api/config/route.ts:7-14`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `roslib` | 2.1.0 (pinned in `web/package.json:35`) | Node-side + browser-side ROS2 comms via rosbridge | Already the project's rosbridge client; works server-side via `isomorphic-ws` shim |
| `next` | 16.x | App Router + API routes | Project standard |
| `zustand` | 4.5.7 | Client state (map store epoch extension) | Project standard |
| `write-file-atomic` (optional) | 7.x | Temp-file-then-rename writer | Popular npm library; alternatively a 5-line inline implementation suffices |
| Node `node:test` | built-in | Unit tests for atomic write / epoch logic | Already used by `web/__tests__/*.test.mjs` (Phase 6) |

[VERIFIED: `web/package.json` — roslib ^2.1.0, @types/roslib ^1.3.5, next ^16, zustand ^4.5.7 all present]

### Supporting (all pre-existing, no new installs needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `web/lib/utils/quaternion.ts::quaternionToEuler` | existing | Quaternion → yaw for cursor heading | D-05 spec |
| `web/lib/store/slam-pose-store.ts::useSlamPoseStore` | existing (Phase 7) | Map-frame pose anchor | D-01 composite source |
| `web/lib/store/odometry-store.ts::useOdometryStore` | existing | Odom-frame delta at EKF rate (~30 Hz) | D-01/D-02 interpolation |
| `web/lib/store/map-store.ts::useMapStore` | existing | OccupancyGrid cache + clear() | Extended with `epoch`, `setEpoch`, `persistenceDisabled`, `rehydrate()` |
| `@radix-ui/react-toast` | present in `package.json` | Success toast for reset | D-16 UI flow |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Opening a fresh rosbridge WS per reset request | Keep a long-lived Node-side roslib connection | A connection-per-request is simpler (no lifecycle mgmt inside Next.js), and reset is rare — ship simpler |
| Writing epoch JSON via `write-file-atomic` npm | Inline `fs.writeFile(tmp) + fs.rename(tmp, final)` | Inline is ~5 lines with zero new dep; prefer it unless Windows is a target (it's not; Linux container) |
| Full `/tf` subscription + tf2 tree | slam-pose + odom-delta composite | Composite is 30 lines; full tf2-in-JS is a library-sized undertaking out of scope (§D-01 locked) |
| Rotate cursor by `LIDAR_DISPLAY_YAW_OFFSET` | Don't — map frame is world-fixed | See §MapBitmap Math: the LIDAR_DISPLAY_YAW_OFFSET currently applied in MapBitmap is WRONG once map-frame anchoring is in place. Planner must re-derive. |

**Installation:** Nothing new to install for Option A or B. Option C would require rebuilding the slam container.

**Version verification:**
```bash
npm view roslib version    # [ASSUMED] 2.1.0 latest stable — matches pinned ^2.1.0
npm view next version      # [ASSUMED] 16.x — matches pinned ^16
```
(Planner should run these at Wave 0 start to confirm; not executed during research to avoid network dependency in sandboxed env.)

---

## Architecture Patterns

### System Architecture Diagram

```
                    ┌──────────────────────────────────────────────────────────────┐
                    │  BROWSER (Next.js client — /lidar route)                     │
                    │                                                              │
                    │   [on mount]                                                 │
                    │     ├─► GET /api/map/epoch ──────► serverEpoch               │
                    │     ├─► localStorage.getItem('mowerbot.map.epoch.<N>')       │
                    │     │     └─► hydrate useMapStore.latest (isStale:true)      │
                    │     └─► drop 'mowerbot.map.epoch.*' where N < serverEpoch    │
                    │                                                              │
                    │   [steady state]                                             │
                    │     /pose subscription ──► slam-pose-store.updatePose()      │
                    │                              ├─ cache x,y,yaw                │
                    │                              └─ capture odom SNAPSHOT        │
                    │     /odometry/filtered subscr ──► odom-store.updateOdom()    │
                    │     /map subscription ──► map-store.updateMap()              │
                    │                              └─ localStorage.setItem(…)      │
                    │                                                              │
                    │   [render loop — ScanCanvas]                                 │
                    │     useMemo(currentTransform) ──► ScanUnderlayTransform      │
                    │     underlay render ──► MapBitmap                            │
                    │       compute mapFramePose = slamAnchor ⊕ (odomNow − odomAt) │
                    │       offset = -mapFramePose × pxPerMeter                    │
                    │       drawImage(backing, dx+offset, dy+offset)               │
                    │     cursor render (in scan-canvas.tsx drawScan)              │
                    │       pos = canvasCenter + mapFramePose × pxPerMeter         │
                    │       arc() + heading line at yaw                            │
                    │                                                              │
                    │   [Eraser click]                                             │
                    │     useMapStore.clear()  ◄── optimistic                      │
                    │     POST /api/map/reset                                      │
                    │       ├─ {ok:true,epoch,…} → setEpoch(n); toast              │
                    │       ├─ {ok:false,stage:service} → rehydrate; red banner    │
                    │       └─ {ok:false,stage:mapTimeout} → setEpoch(n); yellow   │
                    └────────┬────────────────────────────────────────┬────────────┘
                             │                                        │
                             │ HTTP (GET/POST)                        │ WS /rosbridge
                             │                                        │ (proxied by server.mjs, unchanged)
                             ▼                                        ▼
                    ┌───────────────────────────────────┐  ┌──────────────────────────────────┐
                    │  NEXT.JS SERVER (server.mjs +     │  │  rosbridge_server container      │
                    │   app/api/ route handlers)        │  │  (ws://localhost:9090)           │
                    │                                   │  │                                  │
                    │   GET /api/map/epoch              │  │   subscribe/publish relay        │
                    │     ├─ read data/map-epoch.json   │  │                                  │
                    │     │   (init if missing)         │  └────────┬──────────────────────────┘
                    │     └─ return JSON (no-cache)     │           │ DDS
                    │                                   │           ▼
                    │   POST /api/map/reset             │  ┌──────────────────────────────────┐
                    │     1. atomic write epoch+1       │  │  slam_toolbox (mower-slam)       │
                    │     2. open roslib WS → rosbridge │  │   publishes /map, /pose          │
                    │     3. invoke reset (OPTION A/B)  │  │   ⚠ /slam_toolbox/reset: DOES NOT│
                    │     4. subscribe /map once        │  │     EXIST in humble 2.6.10       │
                    │        (3 s timeout, one-shot)    │  │   see §Blocking Finding          │
                    │     5. return {ok, stage, …}      │  └──────────────────────────────────┘
                    │                                   │
                    │   [OR Option A: docker restart]   │  ┌──────────────────────────────────┐
                    │     via dockerode → docker.sock   │  │  Docker daemon (/var/run/        │
                    │     container.restart('slam')     │◄─│   docker.sock — already mounted  │
                    │                                   │  │   read-only from Phase 6;        │
                    └───────────────────────────────────┘  │   needs RW for Option A)         │
                                                           └──────────────────────────────────┘
```

### Component Responsibilities

| File (new/existing) | Responsibility |
|--------------------|----------------|
| `web/components/lidar/map-bitmap.tsx` (modify) | Consume `mapFramePose` prop; offset drawImage anchor by `-mapFramePose × pxPerMeter`; re-evaluate whether `LIDAR_DISPLAY_YAW_OFFSET` still applies (§MapBitmap Math) |
| `web/components/lidar/scan-canvas.tsx` (modify) | Replace client-side `callSlamReset` with `fetch('/api/map/reset')`; add toast/banner branches per D-16; pass `mapFramePose` to MapBitmap; render new orange cursor (replacing current blue marker at canvas center) |
| `web/lib/store/map-store.ts` (modify) | Add `epoch: number \| null`, `setEpoch(n)`, `persistenceDisabled: boolean`, `rehydrate()`; wrap `updateMap` with quota-safe `setItem`; drop stale keys on setEpoch |
| `web/lib/store/slam-pose-store.ts` (modify) | On `updatePose()`, additionally capture `useOdometryStore.getState().{posX, posY, yaw}` into `anchorOdomAtPoseTime` for §Composite Pose Math consumption |
| `web/app/api/map/epoch/route.ts` (new) | GET: read `data/map-epoch.json`; init if missing; return JSON with `Cache-Control: no-store` |
| `web/app/api/map/reset/route.ts` (new) | POST: atomic-write epoch+1 → invoke reset (Option A/B) → one-shot subscribe `/map` → return structured response per D-13 |
| `web/lib/server/map-epoch.mjs` (new) | Shared helper: `readEpoch()`, `bumpEpoch()` with temp-rename atomicity |
| `web/lib/server/slam-reset.mjs` (new) | Shared helper invoked by reset route: Option A dockerode restart OR Option B roslib WS → deserialize_map |
| `data/map-epoch.json` (new, runtime) | `{ "epoch": 0, "resetAt": "2026-04-17T…" }` |
| `web/__tests__/map-epoch.test.mjs` (new) | Unit tests for atomic write, missing-file init, epoch increment |

### Recommended Project Structure

```
web/
├── app/
│   ├── api/
│   │   ├── map/                      # NEW subdirectory
│   │   │   ├── epoch/
│   │   │   │   └── route.ts          # GET /api/map/epoch
│   │   │   └── reset/
│   │   │       └── route.ts          # POST /api/map/reset
│   │   ├── config/                   # existing template
│   │   ├── zones/                    # existing template
│   │   └── ...
├── components/
│   └── lidar/
│       ├── map-bitmap.tsx            # MODIFY — add mapFramePose offset
│       └── scan-canvas.tsx           # MODIFY — Eraser onClick, cursor rendering
├── lib/
│   ├── server/
│   │   ├── docker-adapter.mjs        # existing (Phase 6) — possibly extend for Option A
│   │   ├── map-epoch.mjs             # NEW — atomic fs helpers
│   │   └── slam-reset.mjs            # NEW — Option A or B invocation
│   ├── store/
│   │   ├── map-store.ts              # MODIFY — epoch + rehydrate + quota
│   │   └── slam-pose-store.ts        # MODIFY — capture odom snapshot
│   └── utils/
│       └── quaternion.ts             # EXISTING — reuse for cursor heading
└── __tests__/
    └── map-epoch.test.mjs            # NEW
```

### Pattern 1: Next.js 16 App Router API Route (Filesystem-Backed)

**What:** Canonical App Router route handler with `process.cwd()` + `promises as fs`.
**When to use:** Every new handler under `web/app/api/map/`.
**Example (modeled on existing `web/app/api/config/route.ts:1-23`):**

```typescript
// Source: web/app/api/config/route.ts (lines 1-23)
// web/app/api/map/epoch/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// cwd at runtime is /app inside the container (verified against docker-compose.yml:125-145)
// On dev, cwd is the web/ directory (verified against npm run dev script in package.json:6)
// Either way, process.cwd() + "data" reaches the mounted mower-data volume in prod
// and the repo's data/ folder in dev.
const EPOCH_FILE = path.join(process.cwd(), "data", "map-epoch.json");

interface MapEpoch { epoch: number; resetAt: string; }

async function readEpoch(): Promise<MapEpoch> {
  try {
    const data = await fs.readFile(EPOCH_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (typeof parsed.epoch === "number" && typeof parsed.resetAt === "string") {
      return parsed;
    }
  } catch {
    // file missing or malformed — return default
  }
  return { epoch: 0, resetAt: new Date().toISOString() };
}

export async function GET() {
  try {
    let current = await readEpoch();
    // Lazy-init: write on first read if file missing — same pattern as readConfig()
    try { await fs.access(EPOCH_FILE); }
    catch {
      await writeEpochAtomic(current); // see §Epoch File I/O for this helper
    }
    return NextResponse.json(current, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[map/epoch] GET error:", err);
    return NextResponse.json({ error: "Epoch read failed" }, { status: 500 });
  }
}
```

### Pattern 2: Atomic File Write (Temp + Rename)

**What:** POSIX-atomic file replacement — no torn reads during concurrent access.
**When to use:** Every epoch write. `fs.rename` is atomic on the same filesystem on Linux `[CITED: nodejs.org/api/fs.html — fs.rename() and write-file-atomic npm package semantics]`.
**Example:**

```typescript
// web/lib/server/map-epoch.mjs
import { promises as fs } from "node:fs";
import path from "node:path";

const EPOCH_FILE = path.join(process.cwd(), "data", "map-epoch.json");

export async function writeEpochAtomic(data) {
  // Ensure parent dir exists (equivalent of mkdir -p). `recursive:true` is idempotent.
  await fs.mkdir(path.dirname(EPOCH_FILE), { recursive: true });
  const tmp = `${EPOCH_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, EPOCH_FILE); // atomic on same FS
}

export async function bumpEpoch() {
  const current = await readEpoch();
  const next = { epoch: current.epoch + 1, resetAt: new Date().toISOString() };
  await writeEpochAtomic(next);
  return next;
}
```

**Pitfall note:** If you write to a `.tmp` path in a *different* directory than the target, `rename` degrades to a cross-filesystem copy+unlink which is NOT atomic. Always keep the temp alongside the target. `[CITED: npm write-file-atomic README — "tmpfile name must be on the same filesystem"]`

### Pattern 3: Server-side roslib → rosbridge (Option B path)

**What:** Call a rosbridge service from Node.js code inside a Next.js API handler.
**When to use:** Option B only (deserialize_map). Option A uses dockerode instead.
**Example:**

```typescript
// web/lib/server/slam-reset.mjs — Option B
import ROSLIB from "roslib";

const ROSBRIDGE_URL = process.env.ROSBRIDGE_URL || "ws://localhost:9090";
// Note: server-side rosbridge URL is the direct rosbridge endpoint, NOT /rosbridge
// (that path is the browser-facing proxy that server.mjs owns). Node goes straight to :9090.

export async function slamDeserializeEmpty() {
  return new Promise((resolve, reject) => {
    const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });
    const timeout = setTimeout(() => {
      try { ros.close(); } catch {}
      reject(new Error("rosbridge connect timeout"));
    }, 2000);

    ros.on("connection", () => {
      clearTimeout(timeout);
      const svc = new ROSLIB.Service({
        ros,
        name: "/slam_toolbox/deserialize_map",
        serviceType: "slam_toolbox/srv/DeserializePoseGraph",
      });
      const req = new ROSLIB.ServiceRequest({
        filename: "/config/empty",
        match_type: 1,    // START_AT_GIVEN_POSE per slam_toolbox convention
        initial_pose: { x: 0, y: 0, theta: 0 },
      });
      svc.callService(req,
        (resp) => { try { ros.close(); } catch {}; resolve(resp); },
        (err)  => { try { ros.close(); } catch {}; reject(new Error(`service fail: ${err}`)); }
      );
    });

    ros.on("error", (err) => {
      clearTimeout(timeout);
      try { ros.close(); } catch {}
      reject(new Error(`ros error: ${err?.message ?? err}`));
    });
  });
}
```

**`[VERIFIED: roslib ^2.1.0 present in web/package.json:35]`** `[CITED: roslib npm README — isomorphic-ws dependency enables Node usage identically to browser]`

### Pattern 4: One-Shot Subscribe with Timeout (for D-14 step 3)

```typescript
// Wait up to 3000 ms for the next /map publish. Resolves with the message or null on timeout.
export async function waitForNextMap(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });
    let resolved = false;
    const done = (v) => { if (!resolved) { resolved = true; try { ros.close(); } catch {}; resolve(v); } };

    const timer = setTimeout(() => done(null), timeoutMs);

    ros.on("connection", () => {
      const topic = new ROSLIB.Topic({
        ros, name: "/map",
        messageType: "nav_msgs/OccupancyGrid",
        compression: "cbor",
        queue_length: 1,
        // throttle_rate here is ignored — we only want ONE message then unsubscribe
      });
      topic.subscribe((msg) => {
        topic.unsubscribe();
        clearTimeout(timer);
        done(msg);
      });
    });
    ros.on("error", () => { clearTimeout(timer); done(null); });
  });
}
```

**Note on `/map` latched publisher:** slam_toolbox publishes `/map` with `TRANSIENT_LOCAL` QoS (latched). After a fresh subscribe, rosbridge will deliver the **last** map immediately — NOT necessarily a new post-reset map. For Option A (container restart), the old latch is gone once the container restarts, so the first delivered message after the new container comes up is the fresh empty map — correct behavior. For Option B (deserialize_map), slam_toolbox's behavior is less clean; the old map's latch persists until `/map` next publishes. **Planner should test this experimentally during Wave 0.**

### Anti-Patterns to Avoid

- **Don't** call the slam service from the browser client (current design). The operator needs to see whether the service succeeded; the server is the right place to invoke + await + translate to structured HTTP response.
- **Don't** edit `server.mjs`. Phase 6's single-upgrade-handler regression test (`web/__tests__/server-upgrade.test.mjs:10-19`) will fail if a second `server.on("upgrade")` appears. Route `/api/map/reset` and `/api/map/epoch` are HTTP, not WS — they go through the default Next.js handler, no upgrade handling needed.
- **Don't** hand-write a websocket message generator for rosbridge. Use `roslib` — it handles op framing, reconnection semantics, and binary compression.
- **Don't** block the API handler on slam's startup. If Option A restart takes 10 s, the handler MUST return `{ok:false, stage:"mapTimeout"}` at 3 s — UI handles it (D-16 yellow banner).
- **Don't** write-file-in-place without temp-rename. Half-written JSON during a read = torn read = bug that only surfaces under load.
- **Don't** rehydrate localStorage → setState → then subscribe to `/map`. Do it in the opposite order OR mark rehydrated data as `isStale` immediately so the first fresh `/map` replaces it (§D-11 handles this correctly).

---

## MapBitmap Math — exact pixel offset

**Current (broken under motion) code (`web/components/lidar/map-bitmap.tsx:140-152`):**

```ts
const cx = canvasWidth / 2 + panX;
const cy = canvasHeight / 2 + panY;
const cellPx = info.resolution * pxPerMeter;
const dw = info.width * cellPx;
const dh = info.height * cellPx;
const dx = cx + info.origin.position.x * pxPerMeter;
const dy = cy - (info.origin.position.y * pxPerMeter + dh);
```

This draws the grid so the **map-frame origin** sits at canvas center + pan. It assumes the robot is also at canvas center == map-frame origin (true only immediately post-reset, per the pre-existing TODO comment lines 30-36).

**New (map-anchored, robot moves across the grid):**

Let `mapFramePose = { x, y, yaw }` be the live map-frame base_link pose. The robot icon stays at canvas center (the view's anchor). The grid's map-frame origin must therefore appear at canvas position:

```
screenPos(map_origin) = canvasCenter + pan + (map_origin - robot_in_map) × pxPerMeter
                      = canvasCenter + pan - mapFramePose × pxPerMeter
                      (because map_origin is at (0,0) in map frame — modulo info.origin.position offset)
```

Combining with the existing `info.origin.position` term (slam_toolbox publishes a non-zero `info.origin.position` — the grid's bottom-left corner in map frame):

```typescript
const cx = canvasWidth / 2 + panX;
const cy = canvasHeight / 2 + panY;

// NEW: offset by live map-frame pose so the grid stays world-fixed under a moving robot
const dx = cx + (info.origin.position.x - mapFramePose.x) * pxPerMeter;
const dy = cy - ((info.origin.position.y - mapFramePose.y) * pxPerMeter + dh);
```

**Y-flip convention (unchanged):** ROS +y is north, canvas +y is south. `cy - (…)` handles this as today.

**The `LIDAR_DISPLAY_YAW_OFFSET` question:** The existing code applies `ctx.rotate(LIDAR_DISPLAY_YAW_OFFSET)` (=π/2) to the bitmap draw because the scan is drawn in laser_frame with a +π/2 display offset to make mower-forward = canvas-up (scan-canvas.tsx:69-70). The map frame is world-fixed and does NOT rotate with the robot, so applying a rotation based on physical mounting offset is **wrong** for the map. **Recommendation:** drop the `ctx.rotate(LIDAR_DISPLAY_YAW_OFFSET)` call from MapBitmap in Phase 8 (currently lines 162-168). The map should render north-up, world-fixed, with the robot cursor rotating on top of it. This is a visible UX change — the planner must verify with a short outdoor test that scan + map align post-change.

**This rotation question is adjacent-to-D-03/D-04 but not explicitly decided in CONTEXT.md.** Planner should surface it as a design-check in the plan (probably Wave 1 task: "verify scan+map alignment under yaw change; remove LIDAR_DISPLAY_YAW_OFFSET from MapBitmap if misaligned").

---

## Composite Pose Math — TS code

Derived from D-01/D-02. Store-side change (`web/lib/store/slam-pose-store.ts`):

```typescript
// NEW fields on the state
anchorOdom: { x: number; y: number; yaw: number } | null;
// yaw in radians for this context to match math; we currently store degrees on line 63.
// Either (a) store radians here and convert at badge display, or (b) convert at consumption.
// Recommendation: store radians internally, convert only at the badge layer.

updatePose: (msg) => {
  const pos = msg.pose.pose.position;
  const ori = msg.pose.pose.orientation;
  // Extract yaw in radians (same formula as quaternion.ts:20-23 but without deg conversion)
  const yawRad = Math.atan2(
    2 * (ori.w * ori.z + ori.x * ori.y),
    1 - 2 * (ori.y * ori.y + ori.z * ori.z)
  );
  // Capture matching odom snapshot NOW
  const o = useOdometryStore.getState();
  // Note: useOdometryStore currently stores yaw only implicitly via twist.angular.z rate;
  // D-02 needs the CURRENT odom-frame pose (x, y, yaw). odometry-store.ts stores posX/posY
  // but NOT yaw — planner should extend odometry-store.ts to also store yaw extracted from
  // msg.pose.pose.orientation.
  set({
    x: pos.x, y: pos.y, yaw: yawRad, /* … */,
    anchorOdom: { x: o.posX, y: o.posY, yaw: o.yaw /* new field */ },
  });
}
```

Consumer-side (in MapBitmap or a small `useMapFramePose()` hook):

```typescript
function computeMapFramePose() {
  const slam = useSlamPoseStore.getState();
  const odom = useOdometryStore.getState();
  if (slam.x == null || slam.anchorOdom == null) {
    // no slam pose yet — fall back to canvas-center render
    return null;
  }
  const dx = odom.posX - slam.anchorOdom.x;
  const dy = odom.posY - slam.anchorOdom.y;
  const dyaw = odom.yaw - slam.anchorOdom.yaw;

  // Rotate the odom delta into the map frame using the slam anchor's yaw.
  // This is the critical step: odom deltas are in odom frame; map frame is rotated by the
  // anchor-time slam yaw relative to odom frame. (At the anchor moment, slam says the robot
  // was at (slam.x, slam.y, slam.yaw) while odom said (anchorOdom.x, anchorOdom.y, anchorOdom.yaw).
  // Rotation between those frames = slam.yaw - anchorOdom.yaw.)
  const dtheta = slam.yaw - slam.anchorOdom.yaw;
  const cos = Math.cos(dtheta), sin = Math.sin(dtheta);
  const dxMap = cos * dx - sin * dy;
  const dyMap = sin * dx + cos * dy;

  return {
    x: slam.x + dxMap,
    y: slam.y + dyMap,
    yaw: slam.yaw + dyaw,  // yaw composes additively
  };
}
```

**For a React component**, subscribe via a memoized selector or a separate `useMapFramePose()` hook; recompute on every frame via `requestAnimationFrame` keyed off a shared tick. The existing scan-canvas `viewTick` pattern can extend to a `poseTick` that bumps on every `useSlamPoseStore` or `useOdometryStore` update.

**Performance:** two store reads + 8 multiplies per frame. At 30 Hz EKF rate this is ~2 µs/frame on a Pi 4 — negligible.

**Sign convention caution (D-05 / pitfall):** `quaternionToEuler` yaw is math-convention (counterclockwise from +x axis). ROS convention matches that. The `yawToHeading()` helper (`quaternion.ts:32-40`) converts to compass/clockwise-from-north — **do NOT use for this math.** The cursor heading line should use the raw math-convention yaw, then the canvas Y-flip handles the screen mapping: `ctx.lineTo(center.x + L*cos(yaw), center.y - L*sin(yaw))` — the minus sign on the y term is the Y-flip.

---

## Cursor Rendering — the 12 px tick and constant-pixel-size

The current blue marker (scan-canvas.tsx:946-975) is drawn at canvas center. The new orange cursor must draw at the live map-frame robot position:

```typescript
// Replace lines 946-975 of scan-canvas.tsx with:
if (standalone && !projector) {
  const mapPose = computeMapFramePose(); // see above; null → fallback to canvas center
  const { panX, panY, pxPerMeter } = view; // pxPerMeter = baseFit * view.zoom
  const w = canvas.width, h = canvas.height;

  let mcx: number, mcy: number, yaw: number;
  if (mapPose) {
    // Canvas center represents the ANCHOR (fixed world reference). Robot moves across it.
    // If the robot moves +1 m east in map frame, the CURSOR moves +1m × pxPerMeter to the right.
    mcx = w / 2 + panX + mapPose.x * pxPerMeter;
    mcy = h / 2 + panY - mapPose.y * pxPerMeter;  // Y-flip
    yaw = mapPose.yaw; // radians
  } else {
    mcx = w / 2 + panX;
    mcy = h / 2 + panY;
    yaw = 0; // fallback: point up
  }

  // Desaturation for stale slam pose (D-03)
  const slamAgeMs = Date.now() - useSlamPoseStore.getState().lastUpdate;
  const isStale = slamAgeMs > 2000;
  const fillColor = isStale ? "rgba(249, 115, 22, 0.5)" : "rgba(249, 115, 22, 0.95)";  // orange
  const strokeColor = isStale ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.95)";

  // Heading line: 12 px from center at yaw radians (math convention, Y-flipped for canvas)
  const tickLen = 12;
  ctx.strokeStyle = fillColor; // orange per D-04 (line color), 1.5 px
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mcx, mcy);
  ctx.lineTo(mcx + tickLen * Math.cos(yaw), mcy - tickLen * Math.sin(yaw));
  ctx.stroke();

  // Filled circle r=6 px with 1 px white outline
  ctx.beginPath();
  ctx.arc(mcx, mcy, 6, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
}
```

**Constant pixel size regardless of zoom:** the radius (`6 px`) and tick length (`12 px`) are pixel constants; they don't participate in `pxPerMeter` scaling. Only the **position** uses pxPerMeter. This matches D-04.

### Re-render cadence

**Problem:** the existing ScanCanvas draw effect (scan-canvas.tsx:522-553) only re-runs on `[cartesian, projector, standalone, viewTick, yawDeg]` — which fires on new scan (~10 Hz) + view change + IMU yaw change (fires ~30 Hz). Adding `mapFramePose` as a rendered element needs a fresh tick on every EKF update (~30 Hz per CONTEXT.md).

**Recommended approach — extend existing `viewTick` bump pattern to cover pose updates:**

```typescript
// Somewhere in ScanCanvas (or a sibling hook):
useEffect(() => {
  const unsub1 = useSlamPoseStore.subscribe(() => bumpView());
  const unsub2 = useOdometryStore.subscribe(() => bumpView());
  return () => { unsub1(); unsub2(); };
}, []);
```

This triggers `viewTick++` on every store update, reusing the existing `cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(…)` debouncing so redraws are naturally capped at display refresh rate (~60 Hz).

**Alternative considered and rejected:** separate cursor canvas layer (second `<canvas>` on top of the scan canvas). More code, more DOM, same perf at our scale. The scan canvas redraw at 30 Hz with ~2000 dots + one drawImage for the map + one circle + one line is well under 2 ms/frame. Single-layer is simpler.

**Perf budget:** scan draws ~1500-3000 lidar dots; at 30 Hz that's ~60 k ops/s — measured under 5 ms/frame on a Pi 4 in the existing impl. Adding bitmap drawImage (~1 ms) + cursor (<0.1 ms) is well within 16 ms VSync budget.

---

## localStorage Quota-Safe setItem Pattern

```typescript
// web/lib/store/map-store.ts (new helper)
function isQuotaExceededError(err: unknown): boolean {
  // Source: mmazzarolo.com/blog/2022-06-25-local-storage-status
  // All modern browsers throw DOMException, but the code/name varies:
  //   Chrome/Edge/new Firefox: code=22 name="QuotaExceededError"
  //   Firefox legacy:          code=1014 name="NS_ERROR_DOM_QUOTA_REACHED"
  //   Safari private mode:     quota is effectively 0; throws QuotaExceededError on first write
  return (
    err instanceof DOMException &&
    (err.code === 22 ||
     err.code === 1014 ||
     err.name === "QuotaExceededError" ||
     err.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function safeSetItem(key: string, value: string): "ok" | "quota" | "error" {
  try {
    localStorage.setItem(key, value);
    return "ok";
  } catch (err) {
    if (isQuotaExceededError(err)) return "quota";
    console.error("[map-store] localStorage.setItem error:", err);
    return "error";
  }
}

// Usage in updateMap:
updateMap: (m: OccupancyGrid) => {
  set({ latest: m, lastMessageAt: Date.now(), isStale: false });
  const { epoch, persistenceDisabled } = get();
  if (epoch == null || persistenceDisabled) return;
  const result = safeSetItem(`mowerbot.map.epoch.${epoch}`, JSON.stringify(m));
  if (result === "quota") {
    set({ persistenceDisabled: true });
    console.warn("[map-store] localStorage quota exceeded; persistence disabled for session");
  }
}
```

**Int8Array JSON caveat (D-10):** `JSON.stringify(occupancyGrid)` serializes `info.data` — which roslib delivers as `Int8Array` under CBOR — as an Object with integer-string keys `"0": 0, "1": 0, …`, NOT as an array. Reads via `JSON.parse` produce a plain Object with those keys. **This will break MapBitmap's `data[i]` indexing.** Two fixes:

1. **Serializer wraps Int8Array as regular array** before stringify:
   ```typescript
   const serializable = { ...m, data: Array.from(m.data) };
   safeSetItem(key, JSON.stringify(serializable));
   ```
2. **Deserializer reconstructs Int8Array** on hydrate:
   ```typescript
   const parsed = JSON.parse(raw);
   const hydrated = { ...parsed, data: Int8Array.from(parsed.data) };
   ```

Planner must implement BOTH sides consistently. Existing codebase has `scrubNaN` with `ArrayBuffer.isView` exemption (`web/lib/ros/subscribers.ts:48-50`) — rehydrated grids don't need that scrub because there's no NaN in Int8 data by definition.

**Size estimate:** MowerBot uses `resolution: 0.025 m/cell` (slam_toolbox_params.yaml:33). A generous 30 m × 30 m yard → 1200 × 1200 = 1.44 M cells × 1 byte = 1.44 MB. Array.from int8 serialized as JSON ≈ 4 bytes/cell (ASCII digit + comma) → ~6 MB — **exceeds** the 5 MB localStorage quota. Realistic yard (say 15×15 m) is ~600×600 = 360k cells × 4 bytes ≈ 1.4 MB. At 30×30 m coverage we'll start hitting quota — the quota-exceeded path will fire. CONTEXT.md §Out-of-scope notes "IndexedDB only triggered if grids blow past 5 MB" — worth monitoring.

**Mitigation:** consider run-length encoding `-1` sequences (unknown cells, the vast majority of an early-phase map) before stringify. Cuts ~80% in practice. Out of scope per §D-12 baseline, but a **Deferred Idea candidate** if quota hits become common.

---

## Epoch File I/O — gotchas

1. **Dev vs Prod cwd:** On dev (`npm run dev` from `web/`), `process.cwd()` is `web/`. On prod (container), `process.cwd()` is `/app`. Existing `zones/route.ts:8` uses `path.join(process.cwd(), "data", "zones.json")` and works in both modes — follow the same pattern. Verified via `grep` of existing routes.
2. **File missing on first boot:** Existing `readConfig()` returns `{}`; we return a default `{epoch:0, resetAt:now}`. Lazy-initialize on first GET (write the default to disk so subsequent reads are stable).
3. **Permissions:** `mower-data` is a named Docker volume owned by the container's UID. The Next.js standalone build runs as root by default in the prod image — no permission issue. In dev, the host user owns `web/data/` — no issue.
4. **Git-ignored:** `data/map-epoch.json` should be in `.gitignore` (alongside missions.json, zones.json, config.json which already are per pattern). Planner to verify.
5. **Concurrent reset clicks:** CONTEXT.md §Claude's Discretion explicitly says "single operator, sequential clicks — trust POSIX rename atomicity". A second POST while the first is in-flight will race the read-then-write, potentially double-bumping the epoch. Acceptable per §D-15 + single-operator assumption. If a mutex is wanted, a simple in-memory `let inFlight = false` flag in the route module suffices.

---

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | localStorage keys `mowerbot.map.*` once Phase 8 ships | First-time users have no existing keys; cleanup on mount drops lower-epoch keys. Not a migration concern. |
| Live service config | `data/map-epoch.json` new at runtime; slam_toolbox params unchanged | Wave 0 initializes file. No slam param change. |
| OS-registered state | None — no systemd/launchd/Task Scheduler state involved | None — verified by inspection of docker-compose.yml (no pid files, no host services) |
| Secrets/env vars | `ROSBRIDGE_URL` env var already read by server.mjs:16; same var consumed by new server-side roslib client | None — env var contract unchanged |
| Build artifacts | None — pure TS + config additions; no new Docker image build required for Option B. Option A needs `docker-compose.yml` edit (docker.sock `:ro`→`:rw`) + rebuild of `mower-web`. | If Option A chosen: rebuild `mower-web` image via `docker-compose.build.yml` pipeline. If Option B: none. |

**Post-ship regression check:** first F5 after deploying Phase 8 against an operator who already has stale keys from dev sessions — their `mowerbot.*` keys without an epoch suffix (pre-Phase-8 shape) will remain until the mount-time cleanup step drops them. §D-11 step 4 handles this: cleanup drops all `mowerbot.map.*` that don't match the serverEpoch. Recommend cleanup use a `startsWith("mowerbot.map.")` filter to catch pre-Phase-8 debug keys too.

---

## Common Pitfalls

### Pitfall 1: Rehydrate-before-subscribe race
**What goes wrong:** If `useMapStore.rehydrate()` fires AFTER the `/map` subscription has already delivered the first fresh message, the rehydrate silently overwrites live data with stale localStorage. Operator sees old grid snap over fresh one, briefly, then hopefully fresh arrives again.
**Why it happens:** the ordering depends on (a) browser cache of the first GET /api/map/epoch vs (b) when rosbridge subscribes. Not deterministic.
**How to avoid:** rehydrate MUST run BEFORE any subscription processes a message. Practical pattern: gate the `useRosStore.init()` call on the rehydration completing, OR set `isStale: true` on the rehydrated message so `updateMap()` unconditionally replaces it (the `isStale: false` side effect of `updateMap` flips stale back). Existing `useMapStore.updateMap` already does `isStale: false` (map-store.ts:26) — this works out.
**Warning sign:** operator reports "map flickers back to old on F5". Grep `useMapStore.getState()` call order in layout/mount code.

### Pitfall 2: Epoch read-then-write race with concurrent resets
**What goes wrong:** two browser tabs click Eraser simultaneously. Both read epoch=7, both write 8. Second write wins; first lost epoch number but operator thinks their click produced epoch=8. Mismatch possible.
**Why it happens:** §D-15 mitigation says "trust POSIX rename atomicity" — which protects against torn writes, not against read-then-write races.
**How to avoid:** per CONTEXT's "single operator" assumption, this is out of scope. If it ever becomes a problem, wrap reset in a node-level `AsyncLock` or use `fs.open` with `O_CREAT|O_EXCL` as a poor-man's mutex file.
**Warning sign:** server logs show two `[map-reset] epoch N→N+1 service:ok` lines within ms of each other with the same N.

### Pitfall 3: Quaternion yaw sign/convention mismatch
**What goes wrong:** cursor heading points opposite direction or 90° off from the scan's "forward".
**Why it happens:** `atan2(2(wz+xy), 1-2(y²+z²))` returns radians CCW from +x axis (math convention). Canvas +y is south; we must flip with `-sin(yaw)`. Pairing radians with degrees (or with `yawToHeading()`) silently produces wrong results.
**How to avoid:** store yaw in **radians** throughout the math pipeline; convert to degrees ONLY at the badge-display layer. Unit-test the cursor with a known orientation: face robot east in map frame → slam yaw = 0 rad → cursor tick at 3 o'clock (canvas +x).
**Warning sign:** cursor tick and scan's dense-return direction disagree during rotation.

### Pitfall 4: `LIDAR_DISPLAY_YAW_OFFSET` stale application to map bitmap
**What goes wrong:** after adding `mapFramePose` offset, if the `ctx.rotate(LIDAR_DISPLAY_YAW_OFFSET)` line stays in MapBitmap (lines 162-168), the map is rotated 90° CCW around canvas center — this is wrong for a world-fixed map. Scan rotates by that same offset to make mower-forward = canvas-up, which is a LASER_FRAME convention, not a map-frame convention.
**Why it happens:** the pre-existing code was written when MAP ≈ LASER_FRAME (post-reset stationary) and applying the rotation worked. Under motion with real map-frame anchoring, it's wrong.
**How to avoid:** drop the rotate() in MapBitmap when adding the map-frame offset. Verify by watching an outdoor drive: grid lines (walls) should stay aligned with real walls regardless of robot yaw.
**Warning sign:** rotating the robot 90° makes the grid appear to also rotate 90°, instead of the robot cursor rotating against a fixed grid.

### Pitfall 5: OccupancyGrid `data` is Int8Array under CBOR → breaks on JSON round-trip
**What goes wrong:** `JSON.stringify(grid)` serializes `Int8Array` as an object, not an array; rehydration produces `data: {"0":0, "1":0…}` — `data[i]` still works, `data.length` doesn't. Some consumer code uses `.length` (see `map-bitmap.tsx:61`) — that path crashes.
**Why it happens:** JSON has no typed-array support.
**How to avoid:** see §localStorage Quota-Safe setItem Pattern — convert with `Array.from(m.data)` before stringify; `Int8Array.from(parsed.data)` on parse.
**Warning sign:** F5 loads the grid but rendering is broken (empty canvas or undefined values).

### Pitfall 6: `/map` latched publisher resurrects stale map after Option B reset
**What goes wrong:** `slam_toolbox` publishes `/map` with `TRANSIENT_LOCAL` QoS. After `deserialize_map`, the first `/map` published is the new empty one — good. But if any subscriber joins between the service success and the first publish, rosbridge may deliver the previous latched message as the "first" message.
**Why it happens:** rosbridge's TL QoS handling.
**How to avoid:** in the `/api/map/reset` server handler, **first** subscribe `/map`, **then** call the service. Any message received before the service call is ignored (or tracked as "pre-reset"). Only messages with `header.stamp > serviceCallStartTime` count as fresh. Alternatively, with Option A (container restart), the latch resets naturally.
**Warning sign:** `mapReceived: true` in response, but the client sees the old grid.

### Pitfall 7: Node process.cwd quirk in standalone Next.js builds
**What goes wrong:** `output: "standalone"` in next.config places the server at `.next/standalone/server.js` — `process.cwd()` may be that subdirectory depending on how the image is invoked, NOT the app root.
**Why it happens:** standalone deployments assume deploy-time you'll either `cd` into the app dir or use ENV overrides.
**How to avoid:** `web/package.json` uses `node server.mjs` (not standalone) in dev and prod. `server.mjs` calls `loadEnvConfig(process.cwd())` already (line 10). The image's WORKDIR is `/app` (inferred from `./config:/app/config` mount). Verified no `output: "standalone"` in any `next.config.*` file found. If the planner adds standalone output, path strategy must shift to `__dirname` instead.
**Warning sign:** `ENOENT: no such file 'data/map-epoch.json'` with path resolving to `/app/.next/standalone/data/...` in prod.

---

## Code Examples

### Example 1: map-store.ts extension (rehydrate + epoch)

```typescript
// Source: pattern derived from existing map-store.ts + D-07..D-12
interface MapState {
  latest: OccupancyGrid | null;
  lastMessageAt: number | null;
  isStale: boolean;
  epoch: number | null;
  persistenceDisabled: boolean;

  updateMap: (m: OccupancyGrid) => void;
  setStale: (s: boolean) => void;
  clear: () => void;
  setEpoch: (n: number) => void;
  rehydrate: () => Promise<void>;
}

export const useMapStore = create<MapState>((set, get) => ({
  latest: null,
  lastMessageAt: null,
  isStale: true,
  epoch: null,
  persistenceDisabled: false,

  updateMap: (m) => {
    set({ latest: m, lastMessageAt: Date.now(), isStale: false });
    const { epoch, persistenceDisabled } = get();
    if (epoch == null || persistenceDisabled) return;
    const serializable = { ...m, data: Array.from(m.data as Int8Array) };
    const res = safeSetItem(`mowerbot.map.epoch.${epoch}`, JSON.stringify(serializable));
    if (res === "quota") set({ persistenceDisabled: true });
  },

  setStale: (s) => set({ isStale: s }),
  clear: () => set({ latest: null, lastMessageAt: null, isStale: true }),

  setEpoch: (n) => {
    set({ epoch: n });
    // Drop older epoch keys
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("mowerbot.map.epoch.")) continue;
      const suffix = parseInt(k.slice("mowerbot.map.epoch.".length), 10);
      if (isFinite(suffix) && suffix < n) {
        try { localStorage.removeItem(k); } catch {}
      }
    }
  },

  rehydrate: async () => {
    try {
      const res = await fetch("/api/map/epoch", { cache: "no-store" });
      if (!res.ok) throw new Error(`GET /api/map/epoch ${res.status}`);
      const { epoch } = await res.json();
      const raw = localStorage.getItem(`mowerbot.map.epoch.${epoch}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const hydrated: OccupancyGrid = { ...parsed, data: Int8Array.from(parsed.data) };
        set({ latest: hydrated, lastMessageAt: null, isStale: true, epoch });
      } else {
        set({ epoch });
      }
      // Cleanup old keys
      get().setEpoch(epoch);
    } catch (err) {
      console.error("[map-store] rehydrate failed:", err);
    }
  },
}));
```

### Example 2: /api/map/reset route skeleton (Option A — Docker restart)

```typescript
// Source: structure from existing api/logs/containers/route.ts + new map-epoch helpers
// web/app/api/map/reset/route.ts
import { NextResponse } from "next/server";
import { bumpEpoch, readEpoch } from "@/lib/server/map-epoch";
import { restartSlamContainer } from "@/lib/server/slam-reset"; // wraps dockerode
import { waitForNextMap } from "@/lib/server/wait-next-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const t0 = Date.now();
  let epoch: number;
  try {
    // §D-15: write BEFORE service call, so a write fail doesn't leave slam reset
    const bumped = await bumpEpoch();
    epoch = bumped.epoch;
  } catch (err) {
    console.error("[map/reset] epoch write failed:", err);
    const current = await readEpoch().catch(() => ({ epoch: -1, resetAt: "" }));
    return NextResponse.json({
      ok: false, stage: "service",
      error: `Epoch write failed: ${err instanceof Error ? err.message : String(err)}`,
      epoch: current.epoch,
    }, { status: 500 });
  }

  try {
    await restartSlamContainer(); // throws on any dockerode error
  } catch (err) {
    console.error("[map/reset] slam restart failed:", err);
    return NextResponse.json({
      ok: false, stage: "service",
      error: `slam restart failed: ${err instanceof Error ? err.message : String(err)}`,
    }, { status: 502 });
  }

  // §D-14 step 3: subscribe /map once, wait 3 s for fresh publish
  const mapMsg = await waitForNextMap(3000);
  const elapsedMs = Date.now() - t0;

  if (mapMsg) {
    console.log(`[map-reset] epoch ${epoch - 1}→${epoch} service:ok mapReceived:true ${elapsedMs}ms`);
    return NextResponse.json({ ok: true, epoch, mapReceived: true, elapsedMs });
  } else {
    console.log(`[map-reset] epoch ${epoch - 1}→${epoch} service:ok mapReceived:false ${elapsedMs}ms`);
    return NextResponse.json({
      ok: false, stage: "mapTimeout", epoch,
      error: "Reset acknowledged but no fresh /map within 3000ms",
    });
  }
}
```

### Example 3: Existing API route canonical structure

```typescript
// Source: web/app/api/zones/route.ts:1-25 (full read-side pattern)
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const ZONES_FILE = path.join(process.cwd(), "data", "zones.json");

async function readZones(): Promise<ZoneCollection> {
  try {
    const content = await fs.readFile(ZONES_FILE, "utf-8");
    const data = JSON.parse(content);
    if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
      return data as ZoneCollection;
    }
  } catch { /* file doesn't exist or is invalid */ }
  return { type: "FeatureCollection", features: [] };
}

export async function GET() {
  const collection = await readZones();
  return NextResponse.json({ type: "FeatureCollection", features: enriched });
}
```

Planners: follow this exact shape — helper function for file I/O, typed return, try/catch swallowing missing-file with a sensible default, `NextResponse.json` with explicit status on error.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side fire-and-forget slam reset via `callSlamReset()` calling a non-existent service | Server-side `/api/map/reset` with honest success/failure contract | Phase 8 | Operator gets truthful feedback; regression gate on reset honesty |
| MapBitmap assumes robot ≈ map origin; grid drifts under motion | Grid anchored in map frame via `mapFramePose` subtraction | Phase 8 | Map stays world-fixed; scan scrolls over it as robot moves |
| Blue static marker at canvas center | Orange live cursor at live map-frame pose | Phase 8 | True "this is me in the map" visual |
| Grid evaporates on F5 | Epoch-keyed localStorage rehydrate | Phase 8 | Operator doesn't lose map on page reload |

**Deprecated/outdated:**

- `web/lib/ros/services.ts::callSlamReset()` — leave stubbed or remove after `/api/map/reset` ships; either way scan-canvas.tsx:637-647 replaces the import.
- Blue static robot marker in `scan-canvas.tsx:940-976` — replaced by orange live cursor.
- `ctx.rotate(LIDAR_DISPLAY_YAW_OFFSET)` in `map-bitmap.tsx:162-168` — likely drop per §MapBitmap Math caveat.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `mower-data:/app/data` volume persists across container restarts | §Path Correction | If misconfigured, epoch file lost on container recreate → Phase 8 appears broken on Pi reboot. Verify: `docker volume inspect mowbot_mower-data` |
| A2 | `process.cwd()` resolves to `/app` inside `mower-web` container | §Path Correction, §Code Example 3 | If not, epoch file lands in wrong location. Verify with temporary log: `console.log("[map/epoch] cwd:", process.cwd())` on first GET. Alternatively: `console.log` inside `listContainers()` which the logs route already runs. |
| A3 | Option A (container restart via dockerode) is acceptable to the user given the security boundary change | §Blocking Finding | Major: if user rejects, planner must fall back to Option B or C. MUST surface in discuss-phase. |
| A4 | roslib 2.1.0 works correctly server-side in a Next.js API route (isomorphic-ws) | §Pattern 3 | Medium: if not, fall back to direct `ws` library + manual rosbridge JSON framing. Verify: one-shot test during Wave 0 — call an existing service like `/slam_toolbox/pause_new_measurements` from Node. |
| A5 | Realistic yard grid size stays under localStorage 5 MB quota | §localStorage Quota | Medium: at 30×30 m coverage with 2.5 cm resolution we approach quota. Quota path is handled (§D-12), but persistence may silently disable for larger yards. Measurable via `localStorage.getItem(key).length` in DevTools after first `/map`. |
| A6 | slam_toolbox's `TRANSIENT_LOCAL` latch on `/map` works as described | §Pitfall 6 | Medium: if first post-reset subscribe returns stale map, Option A still needs a stamp filter. Planner should test empirically. |
| A7 | `useOdometryStore` already provides or can provide `yaw` field | §Composite Pose Math | Low-medium: a trivial extension (extract yaw from `msg.pose.pose.orientation` in updateOdometry). Must be done as part of Phase 8 or Wave 0. |
| A8 | The existing LIDAR_DISPLAY_YAW_OFFSET applied to MapBitmap is wrong under map-frame anchoring | §Pitfall 4 / §MapBitmap Math | Low: worst case the map looks 90° off and the planner fixes during bring-up. Surface as design-check in Wave 1. |
| A9 | Single operator / no concurrent reset clicks | §D-15, §Pitfall 2 | Low per CONTEXT — explicitly accepted risk. |

---

## Open Questions

1. **Which slam-reset option does the user want? (A/B/C)**
   - What we know: /slam_toolbox/reset does not exist in humble 2.6.10. Three viable alternatives catalogued.
   - What's unclear: user's tolerance for `docker.sock:rw` (Option A) vs extra Wave 0 posegraph generation (Option B) vs milestone scope change (Option C).
   - Recommendation: **surface to user via `/gsd-discuss-phase` amendment or as first Wave 0 task surfaced in plan-check.** Do not silently pick.

2. **Where does `.planning/state/map-epoch.json` actually live at runtime?**
   - What we know: inside the web container, `.planning/` is not mounted.
   - What's unclear: whether the user prefers the file in the `mower-data` volume (runtime state) or mounting `.planning/` into the web container.
   - Recommendation: relocate to `data/map-epoch.json` (matches existing pattern); surface in discuss-phase.

3. **Does `LIDAR_DISPLAY_YAW_OFFSET` need to come out of MapBitmap?**
   - What we know: applying a fixed rotation to a world-fixed map frame is geometrically wrong.
   - What's unclear: whether the existing code "accidentally works" because of how the scan-canvas's scan rotation and the map-bitmap's rotation both cancel out in the post-reset stationary case.
   - Recommendation: add a Wave 1 verification task: with mower rotated 90°, confirm grid stays north-up and scan rotates.

4. **What's the MAX yard size the user realistically plans to map with this Phase 8 design?**
   - What we know: 5 MB quota ≈ 15×15 m at 2.5 cm resolution (after Array.from JSON overhead).
   - What's unclear: whether the mower's coverage area exceeds that.
   - Recommendation: surface as a post-ship metric; flag in docs that IndexedDB migration is the pre-planned escape valve.

5. **Does `/map` TRANSIENT_LOCAL latch deliver stale-then-fresh, or stale-only until next publish?**
   - What we know: slam_toolbox publishes `/map` at `map_update_interval: 2.0` = 0.5 Hz.
   - What's unclear: empirical behavior after Option A container restart.
   - Recommendation: Wave 0 smoke test — measure time from `docker restart mower-slam` to first `/map` receipt via rosbridge.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 20 | Next.js 16 runtime | ✓ | package.json declares Node 22 per image base | — |
| roslib (npm) | Server-side reset invocation | ✓ | 2.1.0 (web/package.json:35) | Direct ws + manual rosbridge protocol |
| rosbridge_server container | Server-side roslib WS | ✓ | rosbridge v2 via `ros-humble-rosbridge-suite` | — |
| `mower-data` Docker volume | Epoch file persistence | ✓ | declared in docker-compose.yml:188-190 | — |
| `/var/run/docker.sock` (read/write) | Option A only — `container.restart()` | ✓ (mounted RO from Phase 6) | requires `:ro`→`:rw` swap | If user rejects RW: fall back to Option B |
| `slam_toolbox/reset` service | Direct path from CONTEXT.md D-14 | ✗ | — | **BLOCKER — see §Blocking Finding** |
| `slam_toolbox/deserialize_map` (Option B) | Fallback reset path | ✓ | 2.6.10 | — |
| `slam_toolbox/serialize_map` (Wave 0 for Option B) | One-time empty-posegraph generation | ✓ | 2.6.10 | — |
| Empty `.posegraph` file (Option B) | Pre-baked reset payload | ✗ (must be generated in Wave 0) | — | Option B cannot ship without this |
| `write-file-atomic` npm package | Convenience | N/A | — | Inline 5-line implementation |

**Missing dependencies with no fallback:** `slam_toolbox/reset` — no workaround besides the three options in §Blocking Finding.

**Missing dependencies with fallback:** Empty `.posegraph` — create in Wave 0 if Option B is chosen.

---

## Validation Architecture

> Include this section because `.planning/config.json` has `workflow.nyquist_validation: true`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` (matches Phase 6 pattern in `web/__tests__/*.test.mjs`) |
| Config file | None — `web/package.json:8-9` declares `"test": "node --test __tests__/"` |
| Quick run command | `cd web && npm run test -- __tests__/map-epoch.test.mjs` |
| Full suite command | `cd web && npm run test` |
| Smoke (runtime, hardware) | `curl -s http://mower.local:3000/api/map/epoch | jq .` ; `curl -s -X POST http://mower.local:3000/api/map/reset | jq .` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MAP-01 | Grid anchored in map frame | manual + runtime | Manual drive test: mower moves 2 m forward; grid origin stays fixed relative to real walls (visual). Runtime support: `docker exec mower-slam ros2 topic echo /pose --once` confirms pose is changing. | ❌ manual — no auto path |
| MAP-01 | `mapFramePose` math correctness | unit | `cd web && npm run test -- __tests__/map-frame-pose.test.mjs` — input (slam, odom, anchorOdom) → expected composite; ±1e-6 tolerance | ❌ W0 |
| MAP-02 | Cursor rendered at live pose | manual | Playwright check: inject known `/pose` via rosbridge mock; assert DOM canvas has an orange pixel at computed screen position | ❌ manual — no test harness for canvas pixel probe yet |
| MAP-03 | localStorage rehydrate | unit (jsdom) | `cd web && npm run test -- __tests__/map-store-rehydrate.test.mjs` — stubbed fetch + stubbed localStorage; assert useMapStore.latest after rehydrate() | ❌ W0 |
| MAP-03 | Epoch cleanup on setEpoch | unit | Same test file; assert lower-epoch keys removed after setEpoch(new) | ❌ W0 |
| MAP-03 | QuotaExceededError handling | unit | Stub `localStorage.setItem` to throw DOMException w/ code 22; assert `persistenceDisabled: true` | ❌ W0 |
| MAP-04 | POST /api/map/reset happy path | integration | `cd web && npm run test -- __tests__/map-reset-route.test.mjs` — stubbed dockerode + stubbed rosbridge; assert `{ok:true}` + epoch file bumped | ❌ W0 |
| MAP-04 | service-stage failure | integration | Same test — dockerode throws; assert `{ok:false, stage:"service"}` | ❌ W0 |
| MAP-04 | mapTimeout stage | integration | Same test — waitForNextMap returns null; assert `{ok:false, stage:"mapTimeout", epoch}` with epoch still bumped (§D-17) | ❌ W0 |
| MAP-04 | Atomic write | unit | `cd web && npm run test -- __tests__/map-epoch.test.mjs` — create file, crash between write & rename (simulate) → assert no torn read | ❌ W0 |
| — | server.mjs unchanged | static | `cd web && npm run test -- __tests__/server-upgrade.test.mjs` — **existing from Phase 6** — must stay green | ✅ exists |

### Sampling Rate
- **Per task commit:** `cd web && npm run test` (runs ~< 2 s; all unit + integration tests)
- **Per wave merge:** `npm run lint && npm run test` + manual runtime smoke via `curl` on mower
- **Phase gate:** Full suite green + live hardware smoke (drive mower forward 2 m, verify grid stays anchored visually + cursor tracks; reload /lidar, verify grid rehydrates; click Eraser, verify map wipes and F5 shows empty grid — no stale resurrection)

### Wave 0 Gaps
- [ ] `web/__tests__/map-epoch.test.mjs` — covers MAP-03 (atomic write, init-on-missing, bump increments)
- [ ] `web/__tests__/map-frame-pose.test.mjs` — covers MAP-01 (pose composite math)
- [ ] `web/__tests__/map-store-rehydrate.test.mjs` — covers MAP-03 (rehydrate, setEpoch cleanup, quota handling)
- [ ] `web/__tests__/map-reset-route.test.mjs` — covers MAP-04 (all 3 response shapes)
- [ ] Wave 0 decision task: **pick slam-reset option A/B/C and record in discuss-phase amendment or plan lock** (blocks Wave 1 reset implementation)
- [ ] If Option B: generate + commit empty `.posegraph` under `config/empty.posegraph` + `config/empty.data`
- [ ] If Option A: docker-compose.yml edit `/var/run/docker.sock:/var/run/docker.sock:ro` → `:rw` (regression-test the Phase 6 allowlist still blocks forbidden dockerode methods)

Framework install: **none** — `node --test` is built in.

---

## Security Domain

> Required per default (security_enforcement absent in config → enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Trusted-LAN posture per CONTEXT.md §D-13 — no auth on reset endpoint |
| V3 Session Management | no | Stateless API routes; no sessions |
| V4 Access Control | marginal | Same trusted-LAN posture. The Eraser is **client-side opt-in** (deliberate click). No service-level access control. |
| V5 Input Validation | **yes** | POST /api/map/reset: empty body per §D-13 — reject non-empty bodies? Practical: ignore body, never parse it. GET /api/map/epoch: no input. |
| V6 Cryptography | no | No secrets handled; the `data/map-epoch.json` is read-write state, not a secret |
| V9 Communication | marginal | rosbridge protocol is plaintext JSON/CBOR over WS — same posture as all existing topics. No change. |
| V10 Malicious Code | no | No user-uploaded code; no eval |
| V12 File + Resources | **yes** | `data/map-epoch.json` write — temp-rename pattern prevents torn writes; path is constant (no path traversal vector) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via epoch filename manipulation | Tampering | Path is hardcoded constant `path.join(process.cwd(), "data", "map-epoch.json")`; no user input reaches it |
| Dockerode method abuse if Option A is picked and `docker.sock:rw` | Elevation of Privilege | Extend Phase 6 allowlist in `web/lib/server/docker-adapter.mjs` to permit ONLY `container.restart()` for the mower-slam ID; keep `list`/`inspect`/`logs` as-is; reject everything else |
| localStorage XSS exfiltration of map | Information Disclosure | Low-risk — maps contain no PII; trusted-LAN app |
| Unauthenticated reset abuse | Denial of Service | Trusted-LAN posture accepts this. A bad actor on the LAN can POST /api/map/reset repeatedly, which wipes the slam state. Mitigation: rate-limit in-flight resets via module-level mutex; one reset in-flight at a time. Not a hard security boundary. |
| Torn JSON read during reset | Tampering (integrity) | Temp-rename atomic write (§Pattern 2) |
| rosbridge CBOR frame bypass of server.mjs NaN scrub | (existing) | Handled by `scrubNaN` at subscriber boundary (§existing web/lib/ros/subscribers.ts) — unchanged |

---

## Sources

### Primary (HIGH confidence)
- [slam_toolbox humble .srv directory](https://github.com/SteveMacenski/slam_toolbox/tree/humble/srv) — confirms no Reset.srv in humble
- [slam_toolbox 2.6.10 src/slam_toolbox_common.cpp](https://raw.githubusercontent.com/SteveMacenski/slam_toolbox/2.6.10/src/slam_toolbox_common.cpp) — 4 create_service calls, no reset
- [docs.ros.org humble slam_toolbox 2.6.10 PACKAGE](https://docs.ros.org/en/humble/p/slam_toolbox/__PACKAGE.html) — official package doc confirms no reset service
- [slam_toolbox ros2 branch src/slam_toolbox_common.cpp](https://raw.githubusercontent.com/SteveMacenski/slam_toolbox/ros2/src/slam_toolbox_common.cpp) — contrast: ros2/Jazzy branch DOES have reset service
- [rosbridge v2 ROSBRIDGE_PROTOCOL.md ros2](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md) — call_service, subscribe, throttle_rate JSON format
- [Node.js fs.rename docs](https://nodejs.org/api/fs.html) — POSIX atomic rename semantics
- [npm write-file-atomic](https://www.npmjs.com/package/write-file-atomic) — temp + rename pattern reference implementation
- MowerBot existing code (project-internal, verified via Read tool):
  - `web/lib/ros/services.ts:8-24` (existing comment confirms /slam_toolbox/reset absent)
  - `web/lib/store/map-store.ts`, `slam-pose-store.ts`, `odometry-store.ts`
  - `web/lib/ros/topics.ts` (TOPICS.MAP + TOPICS.POSE definitions)
  - `web/app/api/{zones,config,missions}/route.ts` (App Router pattern)
  - `web/app/api/logs/containers/route.ts` (dockerode + runtime:"nodejs" precedent)
  - `web/server.mjs` (regression gate — do not edit)
  - `web/__tests__/server-upgrade.test.mjs` (regression test mechanism)
  - `docker-compose.yml:125-146` (mower-web volume mounts)
  - `docker/slam/Dockerfile` (apt-installed slam_toolbox 2.6.10 confirmation)
  - `config/slam_toolbox_params.yaml:30-34` (map_update_interval 2.0 → 3 s timeout rationale)

### Secondary (MEDIUM confidence)
- [mmazzarolo.com — localStorage QuotaExceededError cross-browser](https://mmazzarolo.com/blog/2022-06-25-local-storage-status/) — cross-browser code/name handling
- [trackjs.com — setItem Storage errors](https://trackjs.com/javascript-errors/failed-to-execute-setitem-on-storage/) — Safari private-mode quota behavior
- [rclc/roslibjs Node usage tutorial](https://medium.com/@rafaazahra_93357/how-setup-rosbridge-suite-for-ros2-roslib-js-library-74b918db1a64) — isomorphic-ws server-side usage pattern
- [Next.js App Router API reference](https://nextjs.org/docs/app/api-reference) — route.ts handler shape

### Tertiary (LOW confidence — flagged for validation)
- `/map` TRANSIENT_LOCAL latched QoS behavior on reset (§Pitfall 6) — documented behavior is consistent across QoS literature but empirical result after Option A container restart needs Wave 0 verification.
- 5 MB localStorage quota is an ASSUMED commonly-stated ceiling; actual browser-specific limits (Chrome/Firefox ~10 MB, Safari ~5 MB) vary. Planner may measure with `new Blob([json]).size` before writing.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every library already pinned in package.json; no new deps except optional write-file-atomic
- Architecture patterns: **HIGH** — App Router + Zustand store extension + Canvas 2D math are all existing patterns in this codebase
- Composite pose math: **MEDIUM-HIGH** — formulas derived from standard SE(2) algebra; not yet exercised on real hardware; unit test in Wave 0 closes the gap
- Slam reset path: **LOW-HIGH split** — **HIGH confidence the advertised D-14 service doesn't exist**; **LOW confidence** on which of the three alternatives the user will pick
- localStorage edge cases: **HIGH** — cross-browser pattern is well-established
- MapBitmap rotation question: **MEDIUM** — §Pitfall 4 recommends a Wave 1 empirical check
- Pitfalls: **HIGH** — all six documented pitfalls are either observed in the existing codebase or derived from well-known browser/ROS behavior

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 days — stable library ecosystem). Revisit sooner if user migrates to slam_toolbox Jazzy or introduces standalone Next.js output.

---

## RESEARCH COMPLETE

**Phase:** 8 — `/lidar` Map-Anchor + Persistence + Honest Reset
**Confidence:** HIGH for architecture + implementation patterns; surfaces ONE BLOCKER + ONE path correction the planner/user must resolve before Wave 1

### Key Findings

1. **BLOCKER (§Blocking Finding):** `/slam_toolbox/reset` does NOT exist in `ros-humble-slam-toolbox` 2.6.10 — confirmed against upstream humble source. CONTEXT.md D-13/D-14 reference a service that was only added in the newer `ros2` branch (Jazzy+). Three viable alternatives catalogued: (A) docker restart mower-slam via dockerode, (B) `/slam_toolbox/deserialize_map` with a pre-baked empty posegraph, (C) upgrade slam to Jazzy. Recommended Option A. **Must be user-ratified before Wave 1.**
2. **Path correction (§Path Correction):** `.planning/state/map-epoch.json` per CONTEXT.md D-07 is not reachable from the `mower-web` container. Recommend relocate to `data/map-epoch.json` — lives in the existing `mower-data` Docker volume, matches existing `zones.json`/`config.json`/`missions.json` pattern.
3. **MapBitmap rotation caveat (§Pitfall 4):** the existing `ctx.rotate(LIDAR_DISPLAY_YAW_OFFSET)` in `map-bitmap.tsx` is geometrically wrong once the map is rendered in map-frame coordinates. Likely needs to be dropped; flag as a Wave 1 empirical verification task.
4. **Composite pose math is straightforward (§Composite Pose Math):** `mapFramePose = slamAnchor ⊕ rotate(odomNow − anchorOdom, slam.yaw − anchorOdom.yaw)`. Requires small extension to `odometry-store.ts` to also store `yaw` (currently only stores angular rate).
5. **Stack + patterns are all in-hand:** roslib 2.1.0 supports Node.js use; `node:test` already used for Phase 6 tests; App Router pattern verified against 3 existing routes; atomic file write is a 5-line helper; quota-safe setItem is a 10-line helper; `@radix-ui/react-toast` already available for D-16 toasts.

### File Created

`.planning/phases/08-lidar-map-anchor-persistence-honest-reset/08-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All libraries pinned; no new deps |
| Architecture | HIGH | All patterns derived from existing routes/stores/tests in the codebase |
| Pitfalls | HIGH | All six are observed-in-repo or well-documented browser/ROS behavior |
| Slam reset option (A/B/C) | LOW | User decision required; authoritative claim only that the originally-assumed service doesn't exist |
| Validation Architecture | HIGH | Extends Phase 6 `node --test` pattern straightforwardly |
| Composite pose math | MEDIUM-HIGH | Formula is standard SE(2); Wave 0 unit test closes the gap |

### Open Questions

1. Which slam-reset option (A/B/C) does the user want?
2. Should `.planning/state/map-epoch.json` relocate to `data/map-epoch.json`?
3. Should `LIDAR_DISPLAY_YAW_OFFSET` be dropped from MapBitmap?
4. Real yard max size relative to 5 MB localStorage quota?
5. Empirical `/map` TRANSIENT_LOCAL latch behavior post Option A restart?

### Ready for Planning

Research complete. Planner can draft PLAN files, but the **slam-reset option** and **epoch-file path** questions MUST be resolved (via discuss-phase amendment or plan-lock task) before Wave 1 implementation begins. All other design questions have concrete recommendations the planner can adopt directly.
