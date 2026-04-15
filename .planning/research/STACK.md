# Stack Research — MowerBot v2.2 Ops & Fusion Polish

**Domain:** ROS2 Humble robotics + Next.js ops dashboard — additive changes only
**Researched:** 2026-04-15
**Confidence:** HIGH (all core claims verified against Context7 / official docs)

## Scope

This milestone adds three concrete features to an **already-working** stack. The existing stack (ROS2 Humble + CycloneDDS + micro-ROS, 9 Docker services, Next.js 16 + React 19 + rosbridge + `server.mjs` proxy + Canvas 2D rendering) is **not re-researched** — this document covers only the *new* capabilities needed for:

1. `/logs` WebUI — live container logs via Docker socket
2. SLAM → EKF yaw fusion — `slam_toolbox` `/pose` into `robot_localization`
3. `/lidar` residuals + persistence + honest reset — Canvas-2D transform, client storage, server endpoint

## Recommended Additions

### Core Additions

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `dockerode` | `^4.0.10` (npm, 2026-03 release) | Node client for Docker Engine API over `/var/run/docker.sock`; streams container logs with built-in multiplexed-stream demuxing (`container.modem.demuxStream`) | Dominant, actively maintained (~1.9 M weekly downloads vs 103 K for `node-docker-api`). Direct UNIX-socket support, promise + callback interfaces, `{follow:true}` returns a live Node `Readable` that slots straight into `ws.send()`. Verified via Context7 `/apocas/dockerode`. |
| `slam_toolbox` pose publisher (already deployed in v2.1) | `humble-2.6.10` | Publishes `geometry_msgs/msg/PoseWithCovarianceStamped` on topic **`/pose`** (map → base_link pose from scan match) with tunable `yaw_covariance_scale` / `position_covariance_scale` params | Already running in the `slam` container. Verified against official docs: `/pose` is published in all modes (async, sync, localization) with a `pose_pub_` member. No new package install. |
| `robot_localization` EKF `pose0` source | `humble` (already deployed in `nav` container) | Consume `/pose` as a yaw measurement — `pose0: /pose`, `pose0_config: [F,F,F,F,F,T, …]` (yaw-only), `pose0_differential: false`, `pose0_relative: false` | Already running. Config-only change in `config/ekf.yaml`. SLAM covariance feeds directly into Kalman gain — the principled way to replace drifting IMU-only yaw. |
| IndexedDB (via `idb-keyval`) | `idb-keyval ^6.2.1` | Persist occupancy-grid bitmap + metadata across page reloads | `localStorage` is capped at ~5 MiB per origin and is synchronous — an OccupancyGrid at 2048×2048 int8 (4 MiB raw, ~6 MiB base64) can blow the quota. IndexedDB handles binary Blobs/Uint8Arrays natively and has GB-scale quotas. `idb-keyval` is a 600-byte wrapper; no schema ceremony for a single-key use case. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ws` | `^8.18` (already in `web/`) | WebSocket server inside `server.mjs` for the `/logs` upgrade path | Same library already proxies `/rosbridge`. Reuse the same upgrade-dispatch pattern — path-based routing on `req.url`. No new dep. |
| `xterm.js` (`@xterm/xterm`) | `^5.5` | Terminal-grade log viewer in the browser (ANSI color, reflow, copy, search) | Optional polish. Most ROS2 container logs are colorized (ros2 logging uses ANSI). Plain `<pre>` works for MVP; upgrade to xterm if ANSI rendering is requested. |
| `@xterm/addon-fit` + `@xterm/addon-search` | `^0.10` / `^0.15` | Terminal sizing + search-in-buffer | Only if xterm is adopted. |
| `idb-keyval` | `^6.2.1` | Tiny IndexedDB wrapper — `get`/`set`/`del` | Avoid hand-rolling `indexedDB.open`. One dep, zero schema work. |

### Tooling / Infra Changes

| Change | Purpose | Notes |
|--------|---------|-------|
| `docker-compose.yml` — `web` service | Mount `/var/run/docker.sock:/var/run/docker.sock:ro` | **Read-only bind**. Docker daemon does not enforce read-only semantics on the API — `ro` on the bind mount only blocks `write(2)` on the socket inode, which Docker doesn't use. True read-only requires an auth proxy (see "What NOT to Use" below) or accepting the trust boundary. For a single-user home-network mower behind the existing trusted-LAN assumption, the bind-mount is acceptable. |
| `server.mjs` | Add second WebSocket upgrade handler for `/logs?container=<id>` | Mirror of existing `/rosbridge` path. Validate `container` against dockerode's `listContainers()` allow-list before opening the log stream. |
| `config/ekf.yaml` | Add `pose0`, `pose0_config`, `pose0_differential`, `pose0_rejection_threshold` | No package bump. Restart `nav` container. |
| `slam_toolbox` params | Tune `yaw_covariance_scale` (e.g. 1.0 → 0.5 to trust yaw more; 2.0 to trust less) and `position_covariance_scale` (high value to neuter x/y contribution — we keep GPS as absolute position) | Config-only. Kept separate from `pose0_config` masking so both tuning knobs are discoverable. |

## Installation

```bash
# web/ — add to package.json dependencies
cd web
npm install dockerode@^4.0.10 idb-keyval@^6.2.1
# Optional terminal viewer (defer until MVP lands):
# npm install @xterm/xterm@^5.5 @xterm/addon-fit@^0.10 @xterm/addon-search@^0.15

# No pip / rosdep installs — robot_localization and slam_toolbox are already in the stack.
```

`docker-compose.yml` additions for the `web` service:

```yaml
services:
  web:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro   # NEW
    # ipc/pid already inherited from x-ros-common; no change
```

## Integration Points Into Existing Stack

### 1. `/logs` view

- **Browser** → WS connect to `wss://mower.local:3000/logs?container=<name>` (same origin, no CORS)
- **`server.mjs`** → second `server.on('upgrade')` branch matching `url.pathname === '/logs'`. On upgrade:
  1. Validate `container` query param against `docker.listContainers({all:false})` — reject unknown IDs with 1008 close code.
  2. `docker.getContainer(id).logs({stdout:true, stderr:true, follow:true, tail:500, timestamps:true}, cb)`.
  3. Pipe through `container.modem.demuxStream(stream, stdoutSink, stderrSink)` where each sink calls `ws.send(JSON.stringify({stream:'stdout'|'stderr', line}))`.
  4. On `ws.close`, call `stream.destroy()` to release the upstream.
- **Next.js** → new route `web/app/logs/page.tsx` + `web/components/logs/LogViewer.tsx`. Fetch container list via a small REST endpoint (`app/api/containers/route.ts` → dockerode `listContainers`) — cheaper than exposing it on the WS channel.
- **State:** ephemeral, no Zustand store needed. Local `useRef` circular buffer (cap 10 K lines).
- **Do not** route through rosbridge; these are orthogonal transports.

### 2. SLAM → EKF yaw fusion

- **Topic:** `slam_toolbox` publishes `geometry_msgs/msg/PoseWithCovarianceStamped` on `/pose` (verified in `docs.ros.org/en/humble/p/slam_toolbox/`). Frame is `map`.
- **EKF config (`config/ekf.yaml`):**
  ```yaml
  pose0: /pose
  pose0_config: [false, false, false,   # x, y, z
                 false, false, true,    # roll, pitch, YAW  ← only yaw
                 false, false, false,
                 false, false, false,
                 false, false, false]
  pose0_differential: false
  pose0_relative: false
  pose0_queue_size: 5
  pose0_rejection_threshold: 5.0   # Mahalanobis; tune after first bag
  pose0_nodelay: false
  ```
- **TF tree implication:** `slam_toolbox` already owns `map → odom`. Fusing `/pose` yaw into the EKF is **not** a competing authority over `map → odom` — EKF publishes `odom → base_link`. The two remain disjoint. Confirm `world_frame: odom`, `map_frame: map`, `odom_frame: odom` in `ekf.yaml` (standard dual-EKF is optional; single EKF with pose0-as-yaw is sufficient for this milestone).
- **Tuning lever:** adjust `slam_toolbox`'s `yaw_covariance_scale` (default 1.0) — the EKF consumes the published covariance directly. Start at 1.0; if yaw is jittery raise to 2.0–3.0.
- **Gotcha:** until firmware publishes `/odom`, EKF's `odom0` input is missing → EKF degenerates toward pose-only updates. This is acceptable *while stationary* (yaw becomes trustworthy) but motion will still bleed into x/y. Documented debt carried from v2.1.

### 3. `/lidar` residuals + persistence + reset

- **Residuals (Canvas 2D transform):** `<MapBitmap>` currently draws the grid at fixed canvas coordinates. Change: read `map → base_link` TF (via existing `tf2_web_republisher` or a direct `/tf` subscription already in the stack), and translate the canvas origin by `-(robot.x, robot.y) * pixelsPerMeter` before `drawImage`. Pattern:
  ```ts
  ctx.save();
  ctx.translate(canvasCenterX - robot.x * ppm, canvasCenterY + robot.y * ppm);
  ctx.drawImage(mapBitmap, 0, 0);
  ctx.restore();
  ```
  Grid now anchored to `map` frame; robot glyph stays centered; grid visibly scrolls beneath it.
- **Persistence (IndexedDB via `idb-keyval`):**
  - Store: `set('mower:lastMap', { width, height, resolution, origin, data: Uint8Array })` on every `/map` update (debounce to 1 Hz — OccupancyGrid can be MB-scale).
  - Rehydrate: on mount, `get('mower:lastMap')` → hand to `<MapBitmap>` as initial state before first live `/map` arrives. Avoids the "blank canvas until SLAM ticks" UX.
  - **Do not** use `localStorage`: 5 MiB cap, synchronous, string-only. A 2048×2048 grid is already 4 MiB raw / ~6 MiB base64 — will throw `QuotaExceededError` on real maps. Verified against MDN Storage API docs.
- **Honest reset:** new Next.js route `POST /api/slam/reset` → calls `slam_toolbox`'s existing `serialize_map` / `clear_map` service via rosbridge from the server side (or shells out to `ros2 service call /slam_toolbox/clear_changes std_srvs/srv/Empty`). Also deletes the IndexedDB key. Wired to the Eraser button. "Honest" = state truly cleared on the robot, not just visually on the client.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `dockerode` | `node-docker-api` | Never for this project — in beta, 1/18 the downloads, same underlying modem, less battle-tested. |
| `dockerode` | Raw `http` over `/var/run/docker.sock` | Only if avoiding a dep is critical. You'd re-implement multiplexed-stream framing (8-byte header: stream-type + length). Not worth the ~200 LoC and bug surface. |
| `dockerode` direct | [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy) in front | Use if you want defense-in-depth: HAProxy-based allow-list of Docker API endpoints (e.g. `CONTAINERS=1`, block `POST`). Sound for hardening but adds a service. Defer to a later hardening milestone. |
| IndexedDB via `idb-keyval` | `localStorage` | Only for sub-MB data. OccupancyGrid is explicitly too big. Rejected. |
| IndexedDB via `idb-keyval` | Raw `indexedDB` API | Only if you already have an IDB abstraction. `idb-keyval` is 600 bytes — not worth rolling open/txn/cursor boilerplate for a single KV. |
| IndexedDB via `idb-keyval` | `dexie.js` | Overkill for one key. Adopt if future milestones need indexes/queries (mission history, bag snippets). |
| `slam_toolbox` `/pose` → EKF `pose0` | AMCL + `/amcl_pose` | AMCL is for localization in a **prior** map. We're running SLAM. Wrong tool for the lifecycle. |
| `slam_toolbox` `/pose` → EKF | Fire `/tf` `map→odom` at EKF indirectly | EKF doesn't consume `/tf` as a measurement — it *produces* TF. Direct `pose0` subscription is correct. |
| xterm.js | `react-console-emulator` / `<pre>` | Start with `<pre>` + `overflow-y:auto`. Upgrade to xterm.js only if ANSI color is requested — the additional bundle is ~200 KB. |

## What NOT to Use / Change

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Swapping `rosbridge` for something else | Works, CBOR+NaN-scrub pipeline is load-bearing and validated | Keep `rosbridge`. Add `/logs` as a **separate** WS path in `server.mjs`. |
| `ros3djs` / `ros2djs` | Unmaintained, React-hostile (v2.1 decision still holds) | Canvas 2D, already in place. |
| Migrating to ROS2 Jazzy/Iron | v2.2 scope is ops polish, not platform migration; constraint locked in PROJECT.md | Stay on Humble. |
| Adding a new DDS-speaking container for logs | Docker logs are a container-runtime concern, not a robotics concern | Sidecar pattern in `server.mjs` via dockerode. |
| Exposing `docker.sock` directly to the browser (e.g. through a port) | Trivial privilege escalation | `server.mjs` sidecar with explicit allow-list of containers + operations (read-only log streaming only). |
| `node-docker-api` | Beta, low usage, no advantage | `dockerode`. |
| `localStorage` for the OccupancyGrid | 5 MiB quota, synchronous, string-only | IndexedDB via `idb-keyval`. |
| Writing back `/map` from the browser (client-authoritative reset) | State lies about reality on the robot | Server-side `/api/slam/reset` calls the real service. |
| Subscribing to `/pose` from the browser for the Canvas transform | `/pose` is the SLAM output; fine for the transform, but realize it updates at scan rate (~10 Hz), not render rate. Use it, but interpolate/cache the last pose in the render loop. | OK to subscribe — just don't gate rendering on new messages. |
| Second EKF instance just for SLAM | Unneeded complexity — one EKF with `pose0` is the documented pattern | Single EKF, `pose0` added. |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `dockerode@^4.0.10` | Node 18+ (web container runs Node 22 Alpine) | Verified. Uses `@grpc/grpc-js` for BuildKit features we don't need; they're lazy-loaded. |
| `dockerode@^4` | Docker Engine 20.10+ (Pi OS Bookworm ships 24.x) | Remote API v1.41+, well supported. |
| `idb-keyval@^6` | All evergreen browsers; React 19 agnostic | Pure ES module. |
| `slam_toolbox humble-2.6.10` | `robot_localization` humble | `/pose` is `geometry_msgs/msg/PoseWithCovarianceStamped` — exactly the type `pose0` expects. |
| `robot_localization` (Humble) | Existing `ekf.yaml` format | Adding `pose*` params is fully backward-compatible with the current `imu0` / `odom0` config. |

## Confidence Breakdown

| Claim | Level | Basis |
|-------|-------|-------|
| `dockerode` 4.0.10 is current, streams demux work | HIGH | Context7 `/apocas/dockerode` + npm registry verified 2026-03 release |
| `slam_toolbox` publishes `PoseWithCovarianceStamped` on `/pose` with covariance scale knobs | HIGH | Official docs `docs.ros.org/en/humble/p/slam_toolbox/` |
| `robot_localization` `pose0` accepts `PoseWithCovarianceStamped`, config array format | HIGH | Official docs (state_estimation_nodes) + `cra-ros-pkg/robot_localization` example yaml |
| `localStorage` ~5 MiB limit insufficient; IndexedDB appropriate | HIGH | MDN Storage quotas docs |
| `docker.sock:ro` does not actually sandbox the API | HIGH | Well-known Docker semantics — bind-mount `ro` only affects inode writes, not socket protocol |
| Canvas-2D translate-before-drawImage is the standard pattern for map-anchored rendering | HIGH | Canvas2D spec; equivalent to the v2.1 `<MapBitmap>` existing transform |

## Sources

- Context7: `/apocas/dockerode` — log stream follow + demux pattern
- [dockerode on npm](https://www.npmjs.com/package/dockerode) — v4.0.10, weekly DL
- [dockerode vs node-docker-api trends (npmtrends)](https://npmtrends.com/dockerode-vs-node-docker-api)
- [slam_toolbox Humble 2.6.10 docs](https://docs.ros.org/en/humble/p/slam_toolbox/) — `/pose` topic, `yaw_covariance_scale`
- [SteveMacenski/slam_toolbox GitHub](https://github.com/SteveMacenski/slam_toolbox) — `pose_pub_` source
- [robot_localization state_estimation_nodes docs](https://docs.ros.org/en/melodic/api/robot_localization/html/state_estimation_nodes.html) — pose0 semantics, config array
- [cra-ros-pkg/robot_localization ekf.yaml example](https://github.com/cra-ros-pkg/robot_localization/blob/ros2/params/ekf.yaml) — config patterns
- [MDN Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) — localStorage 5 MiB cap, IndexedDB quota model
- [web.dev Storage for the web](https://web.dev/articles/storage-for-the-web) — persistence semantics
- [Tecnativa docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) — reference for future hardening (not adopted this milestone)

---
*Stack research for: MowerBot v2.2 Ops & Fusion Polish — additive only*
*Researched: 2026-04-15*
