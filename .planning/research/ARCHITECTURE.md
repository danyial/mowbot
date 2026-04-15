# Architecture Research — v2.2 Ops & Fusion Polish

**Domain:** Brownfield integration into a distributed ROS2 + Next.js robotics stack
**Researched:** 2026-04-15
**Confidence:** HIGH (grounded in the existing codebase map; no speculative redesign)

## Scope & Principle

Three features land on top of the existing v2.1 stack. **Nothing about the service topology, container anchor (`x-ros-common`), or proxy model changes.** Each feature is a minimally invasive extension to a specific layer:

| Feature | Layer touched | Shape of change |
|---------|---------------|-----------------|
| Container-logs view | Web (server.mjs + Next.js + new Docker mount) | **Modify** server.mjs; **new** `/logs` route; **modify** `docker-compose.yml` for `docker.sock` mount |
| SLAM pose → EKF yaw fusion | ROS2 (nav + slam config) | **Modify** `ekf.yaml` and `mower_nav_launch.py` remappings; **no new container** |
| `/lidar` residuals + persistence + reset | Web (React + API + rosbridge call) | **Modify** `<MapBitmap>`; **new** `/api/map/reset` route; **extract** persistence hook |

## System Overview — Where Each Feature Lands

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Browser (Next.js 16 / React 19)                                           │
│                                                                           │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────────────────┐    │
│  │/dashboard│   │   /map   │   │  /lidar  │   │  /logs   (NEW)      │    │
│  │          │   │ scan viz │   │ MapBitmap│   │  container picker + │    │
│  │          │   │          │   │ + Eraser │   │  live tail viewer   │    │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └──────────┬──────────┘    │
│       │              │              │                    │                │
│       │   Zustand stores (gps/imu/battery/ros/...)       │                │
│       │   + NEW: map-persist hook (localStorage)         │                │
│       │   + NEW: logs-store (ring buffer per container)  │                │
└───────┼──────────────┼──────────────┼────────────────────┼────────────────┘
        │              │              │                    │
        │         ws: /rosbridge (proxied, NaN-scrubbed, CBOR passthrough)  │
        │                                                  │                │
        │              ┌───────────────────────────────────┤                │
        │              │              server.mjs (Node :3000)               │
        │              │  • Next.js handler                                  │
        │              │  • /rosbridge WS proxy → ws://localhost:9090       │
        │              │  • /api/map/reset  (NEW REST)                       │
        │              │  • /logs/stream/<container>  (NEW WS proxy)        │
        │              │     uses dockerode over /var/run/docker.sock (RO)  │
        │              └──────┬──────────────────────┬──────────────────────┘
        │                     │                      │
        │                     │                      │ docker.sock (read-only)
┌───────┼─────────────────────┼──────────────────────┼──────────────────────┐
│ ROS2 Humble host-network stack (Docker + CycloneDDS + ipc:host + pid:host)│
│                                                                           │
│ micro-ros-agent  gnss  imu  ntrip  lidar  slam        nav (EKF)  rosbridge│
│    │              │    │     │      │      │            │            │   │
│    │              │    │     │      │      └─ /map, TF  │            │   │
│    │              │    │     │      └─ /scan            │            │   │
│    │              │    │     │                          │            │   │
│    │              │    │     │    MODIFY ekf.yaml:      │            │   │
│    │              │    │     │    add pose0 := slam pose┘            │   │
│    │              │    │     │                                        │   │
│    └──/cmd_vel subs, /imu, /fix → fused /odometry/filtered            │   │
│                                                                       │   │
└───────────────────────────────────────────────────────────────────────┼───┘
                                                                        │
                                                               Docker engine
```

## Feature 1 — Container Logs View

### Decision: Sidecar **in the existing `web` container**, not a new service

**Rationale:**
- `server.mjs` already owns the `/rosbridge` WS proxy pattern. Adding a second WS endpoint (`/logs/stream/:name`) is the same pattern, same process, same reconnect story in the browser.
- A separate sidecar container would duplicate the Node runtime, double the Next.js → sidecar hop, and add a second Docker-network boundary for zero benefit (both would bind-mount `docker.sock` anyway).
- The `web` service already runs as root-equivalent inside the container; granting it read-only `docker.sock` is an isolated, documented risk (see PITFALLS).
- Preserves the "one WS path per feature, all multiplexed through server.mjs" convention that the codebase already established.

**Rejected alternative: dedicated `logs-agent` container.** Extra moving part, extra image, extra compose entry — pays no dividend since the proxy pattern is trivial.

### Topology: one WS per viewer, server fans out

- **Browser side:** a single WS per open `/logs` page, carrying the currently-selected container name as a path param: `ws://host:3000/logs/stream/slam`.
- **Server side:** on each connection, `server.mjs` opens a `dockerode` log stream for that one container (`container.logs({ follow: true, stdout: true, stderr: true, tail: 500 })`) and pipes stdout+stderr bytes out as text frames to the browser.
- Switching containers in the UI closes the old WS and opens a new one — simpler than multiplexing N containers over one socket, and matches the "one subscription at a time" operator workflow.
- **Container list endpoint:** plain HTTP `GET /api/containers` returning `[{name, state, image}, ...]` from `docker.listContainers({all: true})`. No WS needed for this.

### docker.sock mount

Added only to the `web` service in `docker-compose.yml`:

```yaml
web:
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro   # NEW, read-only
```

**Why read-only:** dockerode log streaming uses `GET /containers/{id}/logs`, which is allowed by the read-only flag on recent Docker engines. The real safety is the dockerode wrapper exposing only `list` + `logs` + `inspect` — PITFALLS will flag that `:ro` on `docker.sock` is advisory at best.

### File touch list

- **NEW:** `web/lib/server/docker-logs.ts` — dockerode wrapper exposing `listContainers()` and `streamLogs(name, onChunk, onClose)`; the ONLY surface allowed.
- **MODIFY:** `web/server.mjs` — add `/logs/stream/:name` WS upgrade path alongside existing `/rosbridge` handler; add `/api/containers` HTTP route; keep NaN scrubber untouched (does not apply to log bytes).
- **NEW:** `web/app/logs/page.tsx` — container list + selected-container live viewer.
- **NEW:** `web/components/logs/log-viewer.tsx` — virtualized scrollback, autoscroll-at-bottom UX, ANSI color handling (decide in implementation).
- **NEW:** `web/lib/store/logs-store.ts` — Zustand store with a bounded ring buffer (~2000 lines default) per container.
- **MODIFY:** `docker-compose.yml` — add `docker.sock:ro` mount to `web` service.
- **MODIFY:** `web/package.json` — add `dockerode` dep.

### Dependencies on other features: **none.** This ships independently first.

## Feature 2 — SLAM Pose → EKF Yaw Fusion

### What slam_toolbox actually publishes

`slam_toolbox` in async mode publishes:

- **TF** `map → odom` (continuously, corrects for accumulated odom drift)
- **`/slam_toolbox/pose`** (geometry_msgs/PoseWithCovarianceStamped) — scan-matched pose in the `map` frame, published on each scan match. This is the topic `robot_localization` can consume directly.
- **`/map`** (nav_msgs/OccupancyGrid, latched)

Key fact: slam_toolbox DOES publish `PoseWithCovarianceStamped`, so EKF has a directly-ingestible source without a bridging node. (Verify at runtime — some versions gate this behind a parameter; if so, enable `map_update_interval` pose publishing or write a thin republisher.)

### TF tree — stays `map → odom → base_link → laser_frame`

`robot_localization` convention:
- The `odom`-frame EKF (the one we already run) fuses high-rate continuous data (IMU, wheel odom) and publishes `odom → base_link`.
- Anything in the `map` frame (SLAM pose, GPS via navsat_transform) typically goes into a separate `map`-frame EKF, which publishes `map → odom`.

**Current state:** we have one EKF (odom-frame) with `world_frame: odom`. navsat_transform produces `/odometry/gps` which today feeds the same odom EKF. Technically OK for v2.1 but not canonical per robot_localization docs.

**Decision for v2.2: stay with ONE EKF (odom-frame), feed SLAM pose *as yaw only* into it.**

- Rationale: we only want to kill yaw drift. Full dual-EKF (odom + map) is a larger refactor and introduces a second TF producer fighting slam_toolbox over `map → odom`.
- Configure `pose0: /slam_toolbox/pose` with a selection matrix enabling ONLY yaw (index 5 of the 15-dim state). x, y, z, roll, pitch, and all velocities/accels stay `false`.
- slam_toolbox keeps publishing `map → odom` (its normal behavior). EKF keeps publishing `odom → base_link`. No frame-tree collision.

### Concrete ekf.yaml delta

The 15-dim state vector order is `[x, y, z, roll, pitch, yaw, vx, vy, vz, vroll, vpitch, vyaw, ax, ay, az]` — yaw is index 5.

```yaml
ekf_filter_node:
  ros__parameters:
    # ... existing frequency, frame config unchanged ...

    # NEW input: slam_toolbox pose, yaw-only
    pose0: /slam_toolbox/pose
    pose0_config: [false, false, false,    # x, y, z
                   false, false, true,     # roll, pitch, YAW <- only this
                   false, false, false,    # vx, vy, vz
                   false, false, false,    # vroll, vpitch, vyaw
                   false, false, false]    # ax, ay, az
    pose0_differential: false
    pose0_relative: false
    pose0_queue_size: 5
    pose0_rejection_threshold: 2.0        # Mahalanobis, tune in phase
    pose0_nodelay: true
```

Existing `imu0`/`odom0`/GPS inputs stay untouched. The IMU yaw contribution should then be **disabled** (`imu0_config` yaw index flipped to `false`) — IMU yaw is the drifting source being replaced. Leaving it on fights the SLAM pose.

### navsat_transform: no remapping needed

navsat_transform consumes `/imu` + `/fix` and outputs `/odometry/gps` → odom EKF. Its inputs don't change. Its yaw source (IMU) still matters for the initial heading lock, but after the lock, EKF's yaw state comes from SLAM. No launch-file remap changes required.

### File touch list

- **MODIFY:** `config/ekf.yaml` — add `pose0` block; flip `imu0` yaw bit to `false`.
- **MODIFY (maybe):** `config/mower_nav_launch.py` — only if we need to ensure EKF starts after slam_toolbox publishes its first pose (otherwise EKF rejects early messages until topic appears, which is benign). Likely no change.
- **NO NEW CONTAINERS.**

### Dependencies

- **Requires** slam_toolbox to actually be publishing `/slam_toolbox/pose` with non-degenerate covariance. v2.1 has slam running; verify topic presence before wiring.
- **Blocked-by nothing** from the other two features.
- **Downstream unlocks:** `/lidar` residuals become meaningfully accurate (because `map → base_link` is stable at rest, not drifting from pure IMU integration).

## Feature 3 — /lidar Map Anchor, Persistence, Honest Reset

### MapBitmap stays in `/lidar/page.tsx` — do not extract prematurely

The existing `<MapBitmap>` is a subcomponent of `web/app/lidar/page.tsx` (Canvas 2D render of the `/map` OccupancyGrid). The three new behaviors touch three different concerns and should be separated **inside** that component tree, but not spun into their own file family unless size demands:

- **Render transform (residuals):** small edit to the existing canvas draw call.
- **Persistence:** extract into a `useMapPersistence` hook (`web/lib/hooks/use-map-persistence.ts`) so the page component stays thin.
- **Reset button:** wire the existing Eraser UI element to a new async handler.

### Residuals: subtract `map → base_link` translation in the draw

Today the bitmap paints at a fixed canvas origin derived from `/map`'s origin + resolution, and the robot icon moves over it. Result: when the robot moves, the icon drifts off-center and the grid stays put.

**Target:** grid scrolls under a robot icon pinned at canvas center (standard "ego-centric mini-map" UX).

- Subscribe to the TF `map → base_link` via rosbridge (or read from `/odometry/filtered` if `frame_id` is `map` — simpler to use TF).
- Compute pixel offset: `dx_px = (robot_x - map_origin_x) / map_resolution - canvas_center_x`.
- Apply as a canvas transform before drawing the occupancy grid; draw robot icon at canvas center unconditionally.
- **This feature materially depends on Feature 2** — an untrusted yaw makes rotational alignment of the grid look drunk. Translation-only residuals work today; honest rotational compensation needs yaw fusion first.

### Persistence: single blob in localStorage, keyed by map-session

**Scheme:**
- Key: `mower.lidar.map.v1` (single blob; bump suffix on format change).
- Value (JSON): `{ resolution, width, height, origin: {x,y,theta}, frame_id, data_b64, savedAt }` where `data_b64` is the occupancy grid bytes base64-encoded.
- Write: throttled (e.g., once per 5 s) — OccupancyGrid updates can be large and frequent.
- Read: on `/lidar` mount, if no live `/map` has arrived within ~1 s, hydrate canvas from localStorage; as soon as a live message arrives, swap.

**Why single blob, not chunked:** a 500×500 grid at 1 byte/cell is 250 KB, comfortably under the 5 MB localStorage quota. Chunking adds complexity with no current benefit. Flagged for PITFALLS: users mapping multi-acre yards at fine resolution will blow the quota — document the resolution/size tradeoff.

**Storage is per-origin (localhost:3000), per-browser.** This is operator-convenience persistence, not canonical map storage. slam_toolbox on the Pi remains source of truth.

### Honest reset: Next.js API route calling the rosbridge service

Two kinds of "reset" exist, and the operator needs the honest one:

1. **Browser-only:** clear localStorage + clear canvas. Quick, but does not affect the robot's internal map.
2. **Honest:** call the `slam_toolbox` reset service (e.g., `/slam_toolbox/clear_queue` + `/slam_toolbox/reset`) to wipe the actual SLAM map, then clear localStorage, then the next `/map` message repopulates the canvas from scratch.

The operator wants #2 behind the Eraser. #1 alone is misleading because scan data on the map page would re-hydrate from slam_toolbox's still-full map.

**Implementation route: Next.js API route that calls rosbridge.**

- **NEW:** `web/app/api/map/reset/route.ts` — a POST handler. Opens a short-lived rosbridge WS (or reuses a server-side client), calls `/slam_toolbox/reset` as a ROS service call, waits for response, returns 200.
- Why server-side (not direct from the browser via roslibjs)? Keeps the destructive operation behind a named endpoint, server-side logged, matches the "operator actions go through a named endpoint" convention. Client-side roslibjs would also work but is harder to audit.

### File touch list

- **MODIFY:** `web/app/lidar/page.tsx` — introduce ego-centric canvas transform; pass TF-derived offset into `<MapBitmap>`.
- **MODIFY:** `<MapBitmap>` subcomponent — accept `translation` prop; draw with transform.
- **NEW:** `web/lib/hooks/use-map-persistence.ts` — localStorage read/write, throttled.
- **NEW:** `web/app/api/map/reset/route.ts` — POST handler calling `/slam_toolbox/reset` via rosbridge.
- **MODIFY:** Eraser button — swap its onClick to `fetch('/api/map/reset', {method: 'POST'})`, then clear localStorage, then clear canvas.

### Dependencies

- **Translation residuals:** no hard dependency; works with current drifting yaw (just looks off rotationally). Ships standalone.
- **Rotation correctness of residuals:** needs Feature 2 (yaw fusion) to be trustworthy.
- **Persistence + reset:** no dependency on Feature 2.

## Data Flow Changes

### Logs (NEW flow)

```
Docker engine --docker.sock (RO)--> dockerode in server.mjs
                                           |
                                           v
                             WS /logs/stream/<container>
                                           |
                                           v
                             logs-store (Zustand, ring buffer)
                                           |
                                           v
                             <LogViewer> (virtualized)
```

### Sensor fusion (MODIFIED)

```
  /imu  --------------+
  /fix -> navsat_xform+-> EKF --> /odometry/filtered --> TF: odom->base_link
  /odometry/gps ------|
  /slam_toolbox/pose -+  (NEW input, yaw-only)
                           ^
  slam_toolbox ------------+-- also publishes TF: map->odom, /map
```

### /lidar render (MODIFIED)

```
/map (OccupancyGrid) --> MapBitmap cache --+
TF map->base_link     --> translation px --+--> Canvas draw (grid under robot)
/scan                 --> polar overlay  --+
                                   |
                                   v (throttled)
                          localStorage blob
                                   ^
                                   | (hydrate on mount if /map not yet received)
```

## Suggested Build Order

Dependencies ordered strictly; this order minimizes rework.

### Phase A: Logs View (fully independent)
1. Add dockerode dep + `docker.sock` mount.
2. Extend `server.mjs` with `/api/containers` + `/logs/stream/:name`.
3. Build `/logs` page + `<LogViewer>` + `logs-store`.

**Why first:** zero coupling to the other two. Also, **it is a force-multiplier for debugging the other two features** — being able to tail slam, nav, and rosbridge logs from the browser while wiring yaw fusion is directly useful.

### Phase B: SLAM Yaw Fusion (ROS-side only)
4. Verify `/slam_toolbox/pose` is publishing with sane covariance (via rosbridge topic echo or Foxglove).
5. Edit `config/ekf.yaml` — add `pose0` block, disable `imu0` yaw bit.
6. Restart `nav` container; observe `/odometry/filtered` yaw stability at rest (the core acceptance criterion).

**Why second:** Feature C's rotational correctness depends on this, and it is a purely server-side change validatable in Foxglove before touching the web UI.

### Phase C: /lidar residuals + persistence + reset (builds on B)
7. Add `useMapPersistence` hook + wire hydration.
8. Add translation transform to `<MapBitmap>`.
9. Add `/api/map/reset` + rewire Eraser.

**Why last:** the rotation check ("does the grid look right when the robot spins?") is only answerable after Phase B lands.

### Crossover risk

The three features touch three disjoint file sets:
- Logs: `server.mjs`, `/app/logs/`, `/lib/store/logs-store.ts`, `docker-compose.yml`
- Yaw: `config/ekf.yaml`
- /lidar: `/app/lidar/`, `/lib/hooks/use-map-persistence.ts`, `/app/api/map/reset/`

**No merge conflicts expected.** Phases can be parallelized across branches if ever needed; for a solo operator the order above is cleanest.

## Integration Points (Named)

| Integration | File(s) | New/Modified |
|-------------|---------|--------------|
| docker.sock → Node | `web/server.mjs`, `web/lib/server/docker-logs.ts` | NEW file + MODIFY server.mjs |
| docker-compose mount | `docker-compose.yml` → `web.volumes` | MODIFY |
| Logs WS path | `web/server.mjs` `/logs/stream/:name` | NEW handler in existing file |
| Logs route | `web/app/logs/page.tsx` | NEW |
| Logs store | `web/lib/store/logs-store.ts` | NEW |
| EKF yaw input | `config/ekf.yaml` `pose0` block | MODIFY |
| Map reset REST | `web/app/api/map/reset/route.ts` | NEW |
| MapBitmap transform | `web/app/lidar/page.tsx` + MapBitmap subcomponent | MODIFY |
| Map persistence | `web/lib/hooks/use-map-persistence.ts` | NEW |

## Anti-Patterns to Avoid

### Anti-Pattern 1: Separate logs-agent container
**Why wrong:** doubles the Node runtime, adds a network hop, duplicates WebSocket-proxy logic already in server.mjs.
**Do instead:** sidecar *inside* the web container via dockerode.

### Anti-Pattern 2: Dual-EKF refactor for yaw fusion
**Why wrong:** introduces a second TF publisher that fights slam_toolbox over `map → odom`; scope creep for a one-line yaw problem.
**Do instead:** single odom-EKF, add `/slam_toolbox/pose` as yaw-only `pose0`, disable IMU yaw.

### Anti-Pattern 3: Browser-only map reset behind the Eraser
**Why wrong:** clears localStorage but slam_toolbox's internal map re-hydrates the canvas within one publish — looks broken to the operator.
**Do instead:** server-side `/api/map/reset` that calls `/slam_toolbox/reset` service THEN clears localStorage.

### Anti-Pattern 4: Chunked localStorage for occupancy grid
**Why wrong:** complexity without benefit at the expected map sizes (< 500 KB).
**Do instead:** single blob under `mower.lidar.map.v1`; flag the 5 MB quota in PITFALLS for users mapping large areas.

### Anti-Pattern 5: Multiplexing N containers over one logs WebSocket
**Why wrong:** the operator views one container at a time; framing-with-source over a shared socket adds parsing without user-visible benefit.
**Do instead:** one WS per selected container, close-and-reopen on switch.

## Sources

- Existing project map: `.planning/codebase/ARCHITECTURE.md`, `INTEGRATIONS.md`, `STRUCTURE.md`
- `.planning/PROJECT.md` — v2.2 milestone scope, constraints, Key Decisions
- robot_localization docs (state-vector convention, `poseN_config` selection matrix)
- slam_toolbox docs (publishes `/slam_toolbox/pose` PoseWithCovarianceStamped; owns `map → odom` TF)
- dockerode (`container.logs({follow:true})` streaming API)

---
*Architecture research for: MowerBot v2.2 Ops & Fusion Polish*
*Researched: 2026-04-15*
