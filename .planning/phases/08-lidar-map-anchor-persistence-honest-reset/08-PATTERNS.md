# Phase 8: `/lidar` Map-Anchor + Persistence + Honest Reset — Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 15 (9 new, 6 modified)
**Analogs found:** 14 / 15

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `web/components/lidar/map-bitmap.tsx` (M) | component (canvas renderer) | transform / render-response | self — prior-art inside same file (lines 119–169) | exact (in-file refactor) |
| `web/components/lidar/scan-canvas.tsx` (M) | component (canvas renderer + UI) | event-driven (click) + render-response | self — existing Eraser onClick lines 635–668 | exact (in-file refactor) |
| `web/lib/store/map-store.ts` (M) | store (zustand) | CRUD (+localStorage persistence) | `web/lib/store/gps-store.ts` (richer zustand w/ `get()` + derived actions) + self (current map-store.ts) | role-match + in-file refactor |
| `web/lib/store/slam-pose-store.ts` (M) | store (zustand) | event-driven (ROS message) | self — existing `updatePose` at lines 46–67 | exact (in-file refactor) |
| `web/lib/store/odometry-store.ts` (M) | store (zustand) | event-driven (ROS message) | self — existing `updateOdometry` lines 23–33 + `quaternionToEuler` usage in slam-pose-store.ts:49 | exact (in-file extension) |
| `web/lib/utils/quaternion.ts` (new) | utility (pure math) | transform | self (existing `quaternionToEuler`) + `slam-pose-store.ts:49` consumer | exact (add sibling function) |
| `web/app/api/map/epoch/route.ts` (new) | API route (GET, filesystem) | request-response | `web/app/api/config/route.ts` (GET + lazy-init + `data/<file>.json`) | exact |
| `web/app/api/map/reset/route.ts` (new) | API route (POST, multi-stage) | request-response | `web/app/api/logs/containers/route.ts` (runtime:"nodejs", structured error) + `web/app/api/missions/route.ts` POST (try/catch + `[route] ERROR` log) | role-match (multi-stage is novel) |
| `web/lib/server/map-epoch.mjs` (new) | server utility (.mjs) | file-I/O | `web/lib/server/since-preset.mjs` (pure .mjs helper, JSDoc style) | exact (shape) — no atomic-write analog exists |
| `web/lib/server/slam-reset.mjs` (new) | server utility (.mjs) | request-response (WS → roslib) | `web/lib/ros/services.ts::callSlamReset` (client-side analog for roslib Service usage) | role-match (server-side roslib is novel) |
| `data/map-epoch.json` (new) | runtime state | file-I/O | `data/config.json`, `data/zones.json` (existing mounted-volume pattern) | exact |
| `config/empty.posegraph` + `config/empty.data` (new) | runtime data fixture | batch (Wave 0 one-time) | none — first posegraph committed to the repo | no analog (generate via `ros2 service call /slam_toolbox/serialize_map`) |
| `web/__tests__/map-epoch.test.mjs` (new) | test (node:test) | test | `web/__tests__/since-preset.test.mjs` | exact (same framework, same shape) |
| `web/__tests__/map-frame-pose.test.mjs` (new) | test (node:test) | test | `web/__tests__/demux.test.mjs` (pure-function fixture test) | exact |
| `web/__tests__/map-store-rehydrate.test.mjs` (new) | test (node:test) | test | `web/__tests__/docker-adapter.test.mjs` (dynamic import + stubbed globals) | role-match |
| `web/__tests__/map-reset-route.test.mjs` (new) | test (node:test) | integration test | `web/__tests__/docker-adapter.test.mjs` + `web/__tests__/demux.test.mjs` | role-match |

---

## Pattern Assignments

### `web/app/api/map/epoch/route.ts` (new, controller, GET request-response)

**Analog:** `web/app/api/config/route.ts` (lines 1–23) — canonical App Router GET with filesystem read + lazy default.

**Imports pattern** (config/route.ts lines 1–5):
```typescript
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "config.json");
```
Copy verbatim; swap constant to `EPOCH_FILE = path.join(process.cwd(), "data", "map-epoch.json")`.

**Read-with-default pattern** (config/route.ts lines 7–14):
```typescript
async function readConfig(): Promise<Record<string, unknown>> {
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}
```
Adapt for `readEpoch()` returning `{ epoch: 0, resetAt: new Date().toISOString() }` on any error. Also validate shape like `web/app/api/zones/route.ts:14` does (`if (data?.type === "FeatureCollection" && Array.isArray(data.features))`) — check `typeof parsed.epoch === "number" && typeof parsed.resetAt === "string"` before returning the parsed value.

**GET handler pattern** (config/route.ts lines 20–23):
```typescript
export async function GET() {
  const config = await readConfig();
  return NextResponse.json(config);
}
```

**No-cache headers** (pattern from `web/app/api/logs/containers/route.ts:12–14`):
```typescript
return NextResponse.json(containers, {
  headers: { "Cache-Control": "no-store" },
});
```
Apply to epoch GET per CONTEXT D-09.

**Runtime pin** (logs/containers/route.ts lines 5–7) — only needed if the route imports dockerode/roslib Node-native modules. For epoch GET (pure `fs`) it is optional but harmless:
```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

**Error log pattern** (logs/containers/route.ts lines 15–20 + missions/route.ts:180):
```typescript
} catch (err) {
  console.error("[map/epoch] GET error:", err);
  return NextResponse.json({ error: "Epoch read failed" }, { status: 500 });
}
```
Match the `[route] ACTION error:` prefix convention exactly.

---

### `web/app/api/map/reset/route.ts` (new, controller, POST multi-stage)

**Analog (outer shell):** `web/app/api/logs/containers/route.ts:1–22` for runtime pin + structured error envelope. **Analog (multi-stage branching):** novel in this codebase — no existing route does "write state → call service → await event → return structured JSON". Compose from primitives:

**Runtime + dynamic export** (logs/containers/route.ts:5–7):
```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```
Required because roslib + `ws` pull Node-native modules.

**Import pattern** (from logs/containers/route.ts:2 and missions/route.ts):
```typescript
import { NextResponse } from "next/server";
import { bumpEpoch, readEpoch } from "@/lib/server/map-epoch.mjs";
import { slamDeserializeEmpty, waitForNextMap } from "@/lib/server/slam-reset.mjs";
```

**Structured success/failure response** (per CONTEXT D-13, no existing codebase analog — apply as stated):
```typescript
// success
return NextResponse.json({ ok: true, epoch, mapReceived: true, elapsedMs });
// service stage
return NextResponse.json(
  { ok: false, stage: "service", error: `…` },
  { status: 502 }
);
// mapTimeout stage (still 200 — slam IS reset; the map subscription just didn't deliver in time)
return NextResponse.json({
  ok: false, stage: "mapTimeout", epoch,
  error: "Reset acknowledged but no fresh /map within 3000ms",
});
```

**Ordering note (CONTEXT D-15):** `bumpEpoch()` executes BEFORE `slamDeserializeEmpty()`. On bump failure return `{ok:false, stage:"service"}` with HTTP 500 without touching slam.

**Operator log line (CONTEXT D-18):**
```typescript
console.log(`[map-reset] epoch ${prev}→${epoch} service:ok mapReceived:${!!mapMsg} ${elapsedMs}ms`);
```
The `[name] ACTION` prefix matches every other route (`[missions] POST error:`, `[logs/containers] GET error:`, `[route_name] ACTION error:` convention).

---

### `web/lib/server/map-epoch.mjs` (new, server utility, file-I/O atomic write)

**Analog:** `web/lib/server/since-preset.mjs` for shape, JSDoc style, and `.mjs` export conventions. No existing atomic-write helper — this file is a greenfield 5-line helper per RESEARCH §Pattern 2.

**JSDoc preamble** (since-preset.mjs:1–10):
```javascript
/**
 * map-epoch — authoritative epoch counter for /api/map/reset.
 *
 * Atomic write pattern: write `.tmp` sibling, fs.rename to final. Rename is
 * POSIX-atomic on the same filesystem (Linux ext4 / Docker overlayfs).
 * See 08-RESEARCH §Pattern 2.
 *
 * @module web/lib/server/map-epoch
 */
```

**Path constant** (matches every route.ts in the codebase: `process.cwd() + "data"`):
```javascript
import { promises as fs } from "node:fs";
import path from "node:path";

const EPOCH_FILE = path.join(process.cwd(), "data", "map-epoch.json");
```
Note: existing client-side routes use `import { promises as fs } from "fs"` — here use `node:fs` because this is a pure-`.mjs` server utility (matches `demux.mjs` and `since-preset.mjs` import style).

**Named exports pattern** (since-preset.mjs:20):
```javascript
export function parseSincePreset(preset) { /* … */ }
```
Export exactly: `readEpoch()`, `writeEpochAtomic(data)`, `bumpEpoch()`. Wave 0 test `docker-adapter.test.mjs` (lines 4–12) is the template for an allowlist-style test if the planner wants to lock the surface.

**Atomic write body** (per RESEARCH lines 397–403):
```javascript
export async function writeEpochAtomic(data) {
  await fs.mkdir(path.dirname(EPOCH_FILE), { recursive: true });
  const tmp = `${EPOCH_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, EPOCH_FILE);
}
```
Match the config/route.ts:17 formatting (`JSON.stringify(config, null, 2)`) for consistency when someone cats the file.

---

### `web/lib/server/slam-reset.mjs` (new, server utility, WS → roslib)

**Analog:** `web/lib/ros/services.ts::callSlamReset` (lines 26–52) — existing client-side pattern for invoking a ROS service via roslib. Not a perfect match because it's client-side and uses `getRos()` (singleton browser WS), but the `new ROSLIB.Service(...)` / `callService(req, onOk, onErr)` shape is identical.

**Client-side analog (services.ts lines 37–47):**
```typescript
const svc = new ROSLIB.Service<Record<string, never>, Record<string, never>>({
  ros,
  name: "/slam_toolbox/clear_changes",
  serviceType: "slam_toolbox/srv/Clear",
});
svc.callService(
  {},
  () => resolve(),
  () => resolve() // swallow server errors
);
```

**Adapt for server-side with explicit lifecycle** (per RESEARCH §Pattern 3, lines 422–462):
```javascript
import ROSLIB from "roslib";

const ROSBRIDGE_URL = process.env.ROSBRIDGE_URL || "ws://localhost:9090";

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
      svc.callService(
        new ROSLIB.ServiceRequest({
          filename: "/config/empty",
          match_type: 1,
          initial_pose: { x: 0, y: 0, theta: 0 },
        }),
        (resp) => { try { ros.close(); } catch {}; resolve(resp); },
        (err) => { try { ros.close(); } catch {}; reject(new Error(`service fail: ${err}`)); }
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

**One-shot subscribe helper** (no analog — greenfield per RESEARCH §Pattern 4 lines 470–494). Critical subtlety: per RESEARCH §Pitfall 6 the `/map` subscribe MUST begin BEFORE `slamDeserializeEmpty` resolves, otherwise the TL-latched old map is returned as "fresh".

**URL note:** server-side code connects to `ws://localhost:9090` (direct rosbridge), NOT `/rosbridge` (which is the browser-facing proxy owned by `server.mjs` — do NOT edit `server.mjs` per Phase 6 regression gate enforced by `web/__tests__/server-upgrade.test.mjs:10–19`).

---

### `web/lib/store/map-store.ts` (modify, store, extend with epoch + persistence)

**Analog (primary):** self — current `map-store.ts` is a 32-line `create<MapState>((set) => …)` that already has `updateMap`, `setStale`, `clear`. **Analog (richer reference for `get()` usage, derived actions):** `web/lib/store/gps-store.ts:67–80`.

**Existing shape to extend** (map-store.ts lines 10–31):
```typescript
interface MapState {
  latest: OccupancyGrid | null;
  lastMessageAt: number | null;
  isStale: boolean;

  updateMap: (m: OccupancyGrid) => void;
  setStale: (s: boolean) => void;
  clear: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  latest: null,
  lastMessageAt: null,
  isStale: true,
  updateMap: (m) => set({ latest: m, lastMessageAt: Date.now(), isStale: false }),
  setStale: (s) => set({ isStale: s }),
  clear: () => set({ latest: null, lastMessageAt: null, isStale: true }),
}));
```

**Pattern for `(set, get)` signature when actions need to read other state** (gps-store.ts:67 and existing `useMapStore` does NOT use `get` — this is the change):
```typescript
export const useGpsStore = create<GpsState>((set, get) => ({ /* … */ }));
```
Planner must change signature from `(set) =>` to `(set, get) =>` so `updateMap` can read `epoch` and `persistenceDisabled` before serializing.

**New fields** (per RESEARCH §Example 1 lines 838–907):
```typescript
interface MapState {
  latest: OccupancyGrid | null;
  lastMessageAt: number | null;
  isStale: boolean;
  epoch: number | null;             // NEW
  persistenceDisabled: boolean;     // NEW

  updateMap: (m: OccupancyGrid) => void;
  setStale: (s: boolean) => void;
  clear: () => void;
  setEpoch: (n: number) => void;    // NEW
  rehydrate: () => Promise<void>;   // NEW
}
```

**Quota-safe setItem pattern** (RESEARCH lines 706–742 — no direct codebase analog; greenfield helper):
```typescript
function isQuotaExceededError(err: unknown): boolean {
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
```
The `console.error("[map-store] …")` prefix matches the convention enforced across every existing store and route (`[gps-store]`, `[missions]`, `[map/epoch]`).

**Int8Array round-trip pattern** (RESEARCH Pitfall 5 lines 815–820 + Example 1 line 867):
```typescript
// write
const serializable = { ...m, data: Array.from(m.data as Int8Array) };
safeSetItem(`mowerbot.map.epoch.${epoch}`, JSON.stringify(serializable));

// read (in rehydrate)
const parsed = JSON.parse(raw);
const hydrated: OccupancyGrid = { ...parsed, data: Int8Array.from(parsed.data) };
```
Consumer code in `map-bitmap.tsx:61` relies on `data.length === info.width * info.height` — so the `Int8Array.from(parsed.data)` restoration is load-bearing.

**Rehydrate sequence** (CONTEXT D-11, code in RESEARCH Example 1 lines 888–906):
```typescript
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
    get().setEpoch(epoch); // also cleans up older keys
  } catch (err) {
    console.error("[map-store] rehydrate failed:", err);
  }
}
```

---

### `web/lib/store/slam-pose-store.ts` (modify, store, add odom snapshot)

**Analog:** self — existing file is the exact template; just extend `updatePose` to also capture odom at pose-time.

**Existing updatePose pattern** (slam-pose-store.ts lines 46–67):
```typescript
updatePose: (msg: PoseWithCovarianceStamped) => {
  const pos = msg.pose.pose.position;
  const ori = msg.pose.pose.orientation;
  const euler = quaternionToEuler(ori);

  const cov = msg.pose.covariance?.[35];
  const yawCovariance =
    cov != null && isFinite(cov) && cov > 0 ? cov : -1;

  set({
    x: pos.x,
    y: pos.y,
    yaw: euler.yaw,
    yawCovariance,
    lastUpdate: Date.now(),
  });
}
```

**Cross-store read pattern** (from `web/lib/store/gps-store.ts` — `get()` usage) + import style from `useImuStore` usage in `scan-canvas.tsx:211`:
```typescript
import { useOdometryStore } from "@/lib/store/odometry-store";

updatePose: (msg: PoseWithCovarianceStamped) => {
  // … existing x/y/yaw/cov extraction …
  const o = useOdometryStore.getState();
  set({
    x: pos.x,
    y: pos.y,
    yaw: euler.yaw,
    yawCovariance,
    lastUpdate: Date.now(),
    anchorOdom: { x: o.posX, y: o.posY, yaw: o.yaw }, // NEW — requires odom-store extension first
  });
}
```

**Sign/unit caution (per RESEARCH §Composite Pose Math):** existing slam-pose-store stores `yaw` in **degrees** (via `quaternionToEuler`). The map-anchor math needs **radians**. Recommend either (a) add a `yawRad` field alongside `yaw` (degrees kept for badge compatibility), or (b) store radians and convert at the badge consumer. This is a Claude's Discretion item per CONTEXT.

---

### `web/lib/store/odometry-store.ts` (modify, store, add yaw field)

**Analog:** self — existing 34-line store is the direct template.

**Existing shape** (odometry-store.ts lines 6–34):
```typescript
interface OdometryState {
  linearSpeed: number;
  angularSpeed: number;
  posX: number;
  posY: number;
  lastUpdate: number;
  updateOdometry: (msg: Odometry) => void;
}

updateOdometry: (msg: Odometry) => {
  set({
    linearSpeed: Math.sqrt(
      msg.twist.twist.linear.x ** 2 + msg.twist.twist.linear.y ** 2
    ),
    angularSpeed: msg.twist.twist.angular.z,
    posX: msg.pose.pose.position.x,
    posY: msg.pose.pose.position.y,
    lastUpdate: Date.now(),
  });
}
```

**Extension** (RESEARCH §Composite Pose Math lines 578–580):
```typescript
import { quaternionToEuler } from "@/lib/utils/quaternion";
// ...
interface OdometryState {
  // …existing…
  yaw: number; // NEW — radians OR degrees; match slam-pose-store's convention
  yawRad: number; // NEW (if radians chosen) — needed for map-anchor math
}

updateOdometry: (msg: Odometry) => {
  const euler = quaternionToEuler(msg.pose.pose.orientation);
  set({
    // …existing fields…
    yaw: euler.yaw, // degrees (matches slam-pose-store)
    yawRad: (euler.yaw * Math.PI) / 180, // for map math
    lastUpdate: Date.now(),
  });
}
```
Use same `quaternionToEuler` call the slam-pose store uses (slam-pose-store.ts:5 + 49) — consistency across stores.

---

### `web/lib/utils/quaternion.ts` (new helper sibling — quaternionToYawRad)

**Analog:** self — existing `quaternion.ts` already has `quaternionToEuler` (lines 12–30) and `yawToHeading` (lines 35–40). New helper is a trivial sibling that returns radians directly (skips the `* 180/Math.PI` round-trip):

**Existing quaternionToEuler pattern** (quaternion.ts:12–30):
```typescript
export function quaternionToEuler(q: Quaternion): EulerAngles {
  // … roll + pitch + yaw atan2 …
  const yaw = Math.atan2(
    2 * (q.w * q.z + q.x * q.y),
    1 - 2 * (q.y * q.y + q.z * q.z)
  );
  return {
    roll: roll * (180 / Math.PI),
    pitch: pitch * (180 / Math.PI),
    yaw: yaw * (180 / Math.PI),
  };
}
```

**New helper** (per CONTEXT D-05 and RESEARCH lines 570–573):
```typescript
/**
 * Extract yaw in radians directly from a quaternion. Used for map-frame
 * cursor heading where we need radians for trig without the deg ↔ rad
 * round-trip. Formula identical to quaternionToEuler's yaw extraction.
 * Matches scripts/yaw-drift-test.sh line NN for parity with log-analysis tools.
 */
export function quaternionToYawRad(q: Quaternion): number {
  return Math.atan2(
    2 * (q.w * q.z + q.x * q.y),
    1 - 2 * (q.y * q.y + q.z * q.z)
  );
}
```
JSDoc style matches existing file (lines 9–11, 32–34).

---

### `web/components/lidar/map-bitmap.tsx` (modify, renderer, consume mapFramePose)

**Analog:** self — the existing file is the exact template. The in-file TODO at lines 30–36 ("following base_link via /tf or /odometry/filtered is a v1 follow-up") is the issue this modification closes.

**Current imports** (map-bitmap.tsx lines 1–8):
```typescript
"use client";
import { useEffect, useRef } from "react";
import { useMapStore } from "@/lib/store/map-store";
import {
  LIDAR_DISPLAY_YAW_OFFSET,
  type ScanUnderlayTransform,
} from "@/components/lidar/scan-canvas";
```

**Extend props interface** — add `mapFramePose` passed down from scan-canvas:
```typescript
export interface MapBitmapProps {
  transform: ScanUnderlayTransform;
  mapFramePose: { x: number; y: number; yaw: number } | null; // NEW
}
```

**Core drawImage anchor pattern — before (lines 140–152):**
```typescript
const cx = canvasWidth / 2 + panX;
const cy = canvasHeight / 2 + panY;
const cellPx = info.resolution * pxPerMeter;
const dw = info.width * cellPx;
const dh = info.height * cellPx;
const dx = cx + info.origin.position.x * pxPerMeter;
const dy = cy - (info.origin.position.y * pxPerMeter + dh);
```

**After** (per RESEARCH §MapBitmap Math lines 539–545):
```typescript
const cx = canvasWidth / 2 + panX;
const cy = canvasHeight / 2 + panY;
const cellPx = info.resolution * pxPerMeter;
const dw = info.width * cellPx;
const dh = info.height * cellPx;

// NEW: subtract live map-frame pose so the grid stays world-fixed under a moving robot.
// When mapFramePose is null (pre-first-/pose), fall back to previous behavior.
const rx = mapFramePose?.x ?? 0;
const ry = mapFramePose?.y ?? 0;
const dx = cx + (info.origin.position.x - rx) * pxPerMeter;
const dy = cy - ((info.origin.position.y - ry) * pxPerMeter + dh);
```

**LIDAR_DISPLAY_YAW_OFFSET rotation — current (lines 162–168):**
```typescript
ctx.save();
ctx.translate(cx, cy);
ctx.rotate(LIDAR_DISPLAY_YAW_OFFSET);
ctx.translate(-cx, -cy);
ctx.imageSmoothingEnabled = false;
ctx.drawImage(backing, dx, dy, dw, dh);
ctx.restore();
```

**Evaluation (per RESEARCH §Pitfall 4 + §MapBitmap Math lines 549–551 + CONTEXT §Claude's Discretion):** this rotation is likely wrong once the map is rendered in world-fixed map-frame. Expected change (pending Wave 1 outdoor verification):
```typescript
ctx.imageSmoothingEnabled = false;
ctx.drawImage(backing, dx, dy, dw, dh);
// No rotate() — map frame is world-fixed, only the cursor rotates with yaw.
```

**Effect dep array update** (lines 119, 169):
```typescript
useEffect(() => { /* … */ }, [latest, transform, mapFramePose]); // add mapFramePose
```

---

### `web/components/lidar/scan-canvas.tsx` (modify, controller + renderer)

**Analog:** self — all modifications replace or extend existing in-file patterns.

**Modification 1: Eraser onClick** — current (lines 635–668):
```typescript
<button
  type="button"
  onClick={async () => {
    useMapStore.getState().clear();
    try {
      await callSlamReset();
    } catch (e) {
      console.error("[lidar] /slam_toolbox/reset failed:", e);
    }
  }}
  title="Reset map"
  aria-label="Reset map"
  style={{ /* … */ }}
>
  <Eraser size={16} />
</button>
```

**New onClick pattern** (per CONTEXT D-13 + D-16):
```typescript
onClick={async () => {
  useMapStore.getState().clear(); // optimistic
  try {
    const res = await fetch("/api/map/reset", { method: "POST" });
    const body = await res.json();
    if (body.ok) {
      useMapStore.getState().setEpoch(body.epoch);
      showToast("Karte zurückgesetzt"); // success toast (3s auto-dismiss)
    } else if (body.stage === "service") {
      showBanner("red", body.error); // red banner + Retry
    } else if (body.stage === "mapTimeout") {
      useMapStore.getState().setEpoch(body.epoch); // epoch IS bumped
      showBanner("yellow", body.error);
    }
  } catch (e) {
    console.error("[lidar] /api/map/reset failed:", e);
    showBanner("red", String(e));
  }
}}
```
`[lidar]` log prefix matches existing line 645.

**Modification 2: Remove `callSlamReset` import** — current line 9:
```typescript
import { callSlamReset } from "@/lib/ros/services";
```
Delete this import. Per RESEARCH §State of the Art line 1009, `callSlamReset` can be stubbed or removed entirely after Phase 8.

**Modification 3: Pass `mapFramePose` to MapBitmap** — current line 625:
```typescript
{underlay(currentTransform)}
```
The `underlay` callback is configured by the `/lidar` page render-prop (not in scan-canvas.tsx directly). Planner should trace where `<ScanCanvas>` is used with `underlay={t => <MapBitmap transform={t} />}` (likely `web/app/lidar/page.tsx`) and extend the render-prop to also compute and pass `mapFramePose`:
```typescript
<ScanCanvas underlay={(t) => <MapBitmap transform={t} mapFramePose={computeMapFramePose()} />} />
```
`computeMapFramePose()` is the new helper from RESEARCH §Composite Pose Math lines 590–617.

**Modification 4: Replace blue marker with orange cursor** — current (lines 946–976, in `drawScan`):
```typescript
if (standalone && !projector) {
  const w = canvas.width;
  const h = canvas.height;
  const mcx = w / 2 + view.panX;
  const mcy = h / 2 + view.panY;
  // heading tick straight up, blue filled disc
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mcx, mcy);
  ctx.lineTo(mcx, mcy - 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(mcx, mcy, 8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(59, 130, 246, 0.9)";
  ctx.fill();
  /* white outline */
}
```

**Replacement** (per RESEARCH §Cursor Rendering lines 631–674 and CONTEXT D-04):
```typescript
if (standalone && !projector) {
  const mapPose = computeMapFramePose(); // may be null
  const { panX, panY, pxPerMeter } = view;
  const w = canvas.width, h = canvas.height;

  let mcx: number, mcy: number, yaw: number;
  if (mapPose) {
    mcx = w / 2 + panX + mapPose.x * pxPerMeter;
    mcy = h / 2 + panY - mapPose.y * pxPerMeter; // Y-flip
    yaw = mapPose.yaw; // radians, math convention
  } else {
    mcx = w / 2 + panX;
    mcy = h / 2 + panY;
    yaw = 0;
  }

  const slamAgeMs = Date.now() - useSlamPoseStore.getState().lastUpdate;
  const isStale = slamAgeMs > 2000; // CONTEXT D-03
  const fillColor = isStale ? "rgba(249, 115, 22, 0.5)" : "rgba(249, 115, 22, 0.95)";
  const strokeColor = isStale ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.95)";

  // heading line 12 px, stroke 1.5 px (CONTEXT D-04)
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mcx, mcy);
  ctx.lineTo(mcx + 12 * Math.cos(yaw), mcy - 12 * Math.sin(yaw));
  ctx.stroke();

  // r=6 filled circle + 1 px white outline (CONTEXT D-04)
  ctx.beginPath();
  ctx.arc(mcx, mcy, 6, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
}
```

**Modification 5: Subscribe-driven re-render** — per RESEARCH lines 683–694, extend `viewTick` bump to fire on slam-pose + odometry updates so cursor redraws at EKF rate (~30 Hz):
```typescript
useEffect(() => {
  const unsub1 = useSlamPoseStore.subscribe(() => bumpView());
  const unsub2 = useOdometryStore.subscribe(() => bumpView());
  return () => { unsub1(); unsub2(); };
}, []);
```
Uses the existing `bumpView()` closure defined at line 203.

---

### `web/__tests__/map-epoch.test.mjs` (new, test)

**Analog:** `web/__tests__/since-preset.test.mjs` (lines 1–34) — pure-function .mjs test with dynamic import.

**Full file template** (since-preset.test.mjs verbatim shape):
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

test("readEpoch returns {epoch: 0, resetAt: <iso>} when file missing", async () => {
  const { readEpoch } = await import("../lib/server/map-epoch.mjs");
  // …stub fs or use tmpdir…
  const got = await readEpoch();
  assert.equal(typeof got.epoch, "number");
  assert.equal(typeof got.resetAt, "string");
});

test("bumpEpoch increments epoch and updates resetAt", async () => {
  // …arrange tmpdir, call bumpEpoch twice, assert monotonic…
});

test("writeEpochAtomic never leaves a torn read during concurrent writes", async () => {
  // …race two writes, verify only .tmp files or the final valid JSON visible…
});
```
Same import-after-landing pattern as `docker-adapter.test.mjs:6` ("Import path after Plan 02 lands. Until then this throws ENOENT → RED → correct.").

---

### `web/__tests__/map-frame-pose.test.mjs` (new, test)

**Analog:** `web/__tests__/demux.test.mjs` — pure-function fixture test with arrange-act-assert.

**Pattern** (demux.test.mjs lines 12–21):
```javascript
test("mapFramePose = slam when odom delta = 0", async () => {
  const { computeMapFramePose } = await import("../lib/utils/map-frame-pose.js");
  const got = computeMapFramePose(
    { x: 1, y: 2, yaw: 0.5, anchorOdom: { x: 5, y: 5, yaw: 0.1 } }, // slam
    { posX: 5, posY: 5, yawRad: 0.1 }                                // odom
  );
  assert.equal(got.x, 1);
  assert.equal(got.y, 2);
  assert.equal(got.yaw, 0.5);
});

test("mapFramePose rotates odom delta into map frame via (slam.yaw − anchorOdom.yaw)", async () => {
  // arrange: slam at origin yaw 90°, anchorOdom aligned with axes, odom +1m east
  // expect: mapFramePose.x ≈ 0, mapFramePose.y ≈ +1 (rotated into map frame)
  /* assertion with ±1e-6 tolerance per RESEARCH line 1099 */
});
```

---

### `web/__tests__/map-store-rehydrate.test.mjs` (new, test)

**Analog:** `web/__tests__/docker-adapter.test.mjs` — mock-boundary test with dynamic import.

**Shape** (docker-adapter.test.mjs:1–13):
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

test("rehydrate() fetches /api/map/epoch and loads matching localStorage key", async () => {
  // stub global fetch to return {epoch: 7, resetAt: "..."}
  // stub localStorage.getItem for key mowerbot.map.epoch.7
  // import and call useMapStore.getState().rehydrate()
  // assert useMapStore.getState().latest !== null
  // assert useMapStore.getState().epoch === 7
});

test("setEpoch drops localStorage keys with suffix < current epoch", async () => {
  // populate mowerbot.map.epoch.{3,4,5}, call setEpoch(5), assert only .5 remains
});

test("safeSetItem flips persistenceDisabled on QuotaExceededError", async () => {
  // stub localStorage.setItem to throw DOMException with code 22
  // call updateMap with a grid, assert persistenceDisabled === true
});
```

---

### `web/__tests__/map-reset-route.test.mjs` (new, integration test)

**Analog:** `web/__tests__/docker-adapter.test.mjs` (mocking at the adapter boundary) + RESEARCH §Example 2 for expected shapes.

**Sketch** (no direct codebase analog for HTTP route testing — greenfield pattern):
```javascript
test("POST /api/map/reset happy path returns {ok:true, epoch, mapReceived, elapsedMs}", async () => {
  // stub bumpEpoch → {epoch: 7}
  // stub slamDeserializeEmpty → Promise.resolve()
  // stub waitForNextMap → mock OccupancyGrid
  const { POST } = await import("../app/api/map/reset/route.ts");
  const res = await POST();
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.epoch, 7);
  assert.equal(body.mapReceived, true);
});

test("service-stage failure → {ok:false, stage:'service'} HTTP 502", async () => { /* … */ });
test("mapTimeout stage → {ok:false, stage:'mapTimeout', epoch} HTTP 200, epoch bumped", async () => { /* … */ });
test("epoch write failure returns {ok:false, stage:'service'} BEFORE invoking slam (D-15)", async () => { /* … */ });
```

---

## Shared Patterns

### Import Style
**Client-side TS:** `import { promises as fs } from "fs"` (e.g. `config/route.ts:2`).
**Server-side .mjs:** `import { promises as fs } from "node:fs"` (e.g. `demux.mjs` style — pure ESM).
**Path alias:** `@/` resolves to `web/` (CLAUDE.md); all cross-module imports inside `web/` MUST use `@/…` not relative paths.

### File-backed Route Pattern
**Source:** `web/app/api/config/route.ts:1–14` (canonical) + `web/app/api/zones/route.ts:8–21` (shape validation).
**Apply to:** `web/app/api/map/epoch/route.ts`.
```typescript
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "<name>.json");

async function read<T>(): Promise<T> {
  try {
    const data = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (/* shape check */) return parsed;
  } catch { /* fall through to default */ }
  return /* default */;
}
```

### Error Logging Prefix
**Source:** `web/app/api/missions/route.ts:180` + `web/app/api/logs/containers/route.ts:16`.
**Apply to:** ALL new API routes + store helpers.
```typescript
console.error("[<route_or_module>] <ACTION> error:", err);
```
Examples to match verbatim:
- `[map/epoch] GET error:` — in route.ts
- `[map/reset] POST error:` — in route.ts
- `[map-store] localStorage.setItem error:` — in store
- `[map-reset] epoch N→N+1 service:ok mapReceived:true 1842ms` — CONTEXT D-18 log line

### NextResponse.json Error Envelope
**Source:** `web/app/api/missions/route.ts:181–184`, `web/app/api/ntrip/route.ts:160–164`.
**Apply to:** All error branches in new routes.
```typescript
return NextResponse.json({ error: "<message>" }, { status: <code> });
```
For structured multi-stage responses (CONTEXT D-13), match the shape verbatim — do NOT wrap in a generic `{error}` envelope; the client branches on `body.stage`.

### Cache-Control on dynamic GET
**Source:** `web/app/api/logs/containers/route.ts:12–14`.
**Apply to:** `web/app/api/map/epoch/route.ts` per CONTEXT D-09.
```typescript
return NextResponse.json(payload, {
  headers: { "Cache-Control": "no-store" },
});
```

### Runtime Pin for Node-native Routes
**Source:** `web/app/api/logs/containers/route.ts:5–7`.
**Apply to:** `web/app/api/map/reset/route.ts` (pulls roslib + ws).
```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

### Zustand Store with `(set, get)`
**Source:** `web/lib/store/gps-store.ts:67` (`create<GpsState>((set, get) => …)`).
**Apply to:** `web/lib/store/map-store.ts` extension (`updateMap` needs to read epoch; `rehydrate` needs `get().setEpoch()`).

### Cross-store read via `.getState()`
**Source:** `web/components/lidar/scan-canvas.tsx:641` (`useMapStore.getState().clear()`); similar pattern inside `updatePose` for reading odom.
**Apply to:** `slam-pose-store.ts updatePose` (reads `useOdometryStore.getState()`), the cursor draw branch in `scan-canvas.tsx` (reads `useSlamPoseStore.getState().lastUpdate`).

### node:test Framework
**Source:** `web/__tests__/since-preset.test.mjs`, `docker-adapter.test.mjs`, `demux.test.mjs`, `server-upgrade.test.mjs`.
**Apply to:** All new tests.
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

test("<description>", async () => {
  const { thing } = await import("../path/under-test.mjs");
  assert.equal(/* ... */);
});
```
No test framework install needed — `web/package.json:8–9` already declares `"test": "node --test __tests__/"`.

### `server.mjs` Regression Gate
**Source:** `web/__tests__/server-upgrade.test.mjs:10–19`.
**Constraint for Phase 8:** Do NOT edit `web/server.mjs`. Reset is an HTTP route through the default Next.js handler, not a WS upgrade. The existing test enforces exactly one `server.on("upgrade")` listener — adding a second would regress Phase 6.

### ROSLIB Service Call Shape
**Source:** `web/lib/ros/services.ts:37–47` (client-side analog).
**Apply to:** `web/lib/server/slam-reset.mjs` (server-side, same roslib API; only the `new ROSLIB.Ros({url})` lifecycle differs — server opens per-request, client uses singleton).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `config/empty.posegraph` + `config/empty.data` | runtime data fixture | batch (Wave 0 one-time) | First SLAM posegraph committed to this repo. Generation procedure: `docker compose restart slam && sleep 3 && docker exec mower-slam ros2 service call /slam_toolbox/serialize_map slam_toolbox/srv/SerializePoseGraph "{filename: '/config/empty'}"`. See RESEARCH §Blocking Finding Option B lines 148–152. |

**Partial-analog caveat:** `web/app/api/map/reset/route.ts` as a whole is greenfield — the multi-stage structured response (success / service-stage failure / mapTimeout stage) with optimistic state updates has no existing codebase analog. Build from the primitives in §Pattern Assignments above.

---

## Metadata

**Analog search scope:**
- `web/app/api/**/route.ts` (9 routes scanned)
- `web/lib/store/**/*.ts` (6 stores scanned)
- `web/lib/server/**/*.mjs` (3 helpers scanned)
- `web/lib/ros/**/*.ts` (subscribers, services, topics, ros-client)
- `web/lib/utils/quaternion.ts`
- `web/components/lidar/*.tsx` (map-bitmap, scan-canvas)
- `web/__tests__/*.test.mjs` (4 test files scanned)

**Files scanned:** ~30

**Pattern extraction date:** 2026-04-16
