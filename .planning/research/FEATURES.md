# Feature Research

**Domain:** Robotics operator UI — container observability + SLAM/EKF sensor fusion + live map visualization
**Researched:** 2026-04-15
**Milestone:** MowerBot v2.2 Ops & Fusion Polish
**Confidence:** HIGH for container-logs UX (well-established pattern via Dozzle/Portainer/LazyDocker); HIGH for robot_localization yaw-fusion configuration (official docs unambiguous); MEDIUM for map-anchoring UX (strong convention in Foxglove/RViz, but project-specific tradeoffs around localStorage rehydration)

## Scope Framing

This is a **subsequent milestone** (v2.2) adding three orthogonal capabilities to an already-shipped MowerBot v2.1. Feature analysis is organized by the three feature *areas* the milestone targets, not by a generic product landscape. Within each area: table-stakes, differentiators, anti-features.

The three areas are architecturally independent (different files, different containers, different runtime paths) but share one latent dependency: all three become more valuable once a trustworthy robot pose exists end-to-end. The milestone itself is what delivers that trust (fusion area), so the ordering matters for the roadmap.

---

## Area 1: WebUI Container-Logs View

**Reference products surveyed:** Dozzle, Portainer, LazyDocker, `docker logs -f`, Kubernetes Dashboard, k9s, Foxglove Studio "Diagnostics" panel.

The entire product category is "developer/operator leans on this when something is broken." The design criterion is *time-to-first-useful-line* — can the operator, in <5 seconds after loading `/logs`, see why a container is unhealthy? Everything else is secondary.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Container list with live status (running / exited / restarting) | Every log viewer (Dozzle, Portainer, k9s) opens to a list. Operator needs to pick a container before reading logs. | LOW | `dockerode.listContainers({ all: true })`; poll or subscribe to Docker events. Display `service` name from compose labels (`com.docker.compose.service`), not the mangled container name. |
| Live tail / follow mode (append new lines as they arrive) | This IS the product. Without follow-mode it's just `docker logs` in a browser. | MEDIUM | `dockerode.getContainer(id).logs({ follow: true, stdout: true, stderr: true, tail: 200 })` returns a stream. Pipe over WebSocket. Demux stdout/stderr via 8-byte header frames — dockerode provides `modem.demuxStream()`. |
| Initial backfill (last N lines on connect) | Operator lands on a container and needs context, not just what happens *next*. Dozzle defaults to last 300; `docker logs --tail 300 -f` is the idiomatic baseline. | LOW | Same stream call with `tail: 300`. Stream returns history first then switches to live. |
| Timestamp display (toggleable) | Every tool shows this. Correlating across containers requires timestamps. | LOW | Docker daemon prepends RFC3339Nano timestamps when `timestamps: true`. Render client-side with a toggle (on by default is fine). |
| Auto-scroll-to-bottom with "pause on scroll-up" | The universal UX: scrolling up pauses auto-scroll so the operator can read, scrolling back to bottom resumes. Dozzle, Portainer, browser devtools all do this. Violating it infuriates users. | MEDIUM | Detect `scrollTop + clientHeight >= scrollHeight - threshold` to decide "at bottom." Track a `pinnedToBottom` ref. Show a "jump to latest" button when paused. |
| Multi-container list → single-container viewer navigation | Operator clicks `slam` in the list, gets `slam` logs. Round trip. | LOW | Just routing: `/logs/[container]`. |
| Works offline-to-mower (no internet needed) | Mower is a local-network device; cloud log services are a non-starter. | LOW | Same WebSocket-via-`server.mjs` pattern as `/rosbridge`. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Service-name labels from compose (not container IDs) | Operator thinks `slam`, `gnss`, `nav` — not `mowerbot-slam-1`. Dozzle matches by pattern; we know exactly (all our containers come from one compose file). | LOW | Read `com.docker.compose.service` label; show as primary name with container ID in a muted tooltip. |
| Log-level highlighting for ROS2 log format (`[INFO]`, `[WARN]`, `[ERROR]`) | ROS2 lines have a standard prefix pattern. Coloring WARN/ERROR lines turns a wall of text into a glance-check. | LOW | Regex `/\[(INFO|WARN|ERROR|FATAL|DEBUG)\]/` client-side; Tailwind classes. Strictly cosmetic — no parsing required. |
| Client-side text filter / grep (substring, case-insensitive) | Operator wants to find `slam` mentions in `nav` output. Dozzle+Portainer both have this. | LOW | JavaScript `String.includes()` over the rendered line buffer. Filter is local — doesn't need to re-stream from daemon. |
| "Since" timestamp filter (e.g. "last 5 min") | Problem "just started" — operator wants to scope to the incident window. Standard in Docker CLI (`--since 5m`). | LOW | Add `since: Date.now() - 5*60*1000` to dockerode options. Re-open the stream on change. |
| Log download / copy-all button | Operator wants to paste lines into a todo/bug report. Friction-reducing. | LOW | `Blob` from the rendered text, `a.download`. No server work. |
| Container-lifecycle affordances (restart / stop) | Powerful — lets operator recover from a known-bad state from the same page where they diagnosed it. But adds danger. | MEDIUM | `dockerode.getContainer(id).restart()` / `.stop()`. Requires write-socket access (not read-only). Decision point: this breaks the "read-only socket" principle in PROJECT.md's target-features description. Recommend **anti-feature for v2.2** (see below); revisit if pain observed. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Container start/stop/restart buttons | "I can see the logs, why can't I also bounce the container?" | Requires read-write `/var/run/docker.sock` → privilege escalation equivalent to root on the host. PROJECT.md explicitly specifies `docker.sock` **read-only**. One accidental click restarts `rosbridge` mid-test session. | Keep socket read-only; use `ssh` to mower for lifecycle actions. Revisit only if an operator pain session demonstrates need. |
| Shell-into-container (Dozzle's exec feature) | Dozzle has it; it's convenient. | Same privilege issue + complicates auth model (no auth exists today — see PROJECT.md constraints; home-network trust is assumed). Adds WebSocket multiplexing complexity. | Defer. `docker compose exec` from ssh is fine for now. |
| Persistent log storage / search across time | "What did `slam` log yesterday?" | Dozzle explicitly doesn't do this and says so loudly — it's a *real-time viewer*. Storing logs means log-rotation, disk-pressure, retention policy, query UI — a separate product. Pi 4 is not the place for this. | If needed, configure Docker daemon's JSON log driver with rotation; read files directly. Out of scope for v2.2. |
| DuckDB / SQL query over logs (Dozzle v10 feature) | Cool; useful for large deployments. | 10 containers on a Pi do not need SQL. Adds dependency weight, a query UI, parser complexity. YAGNI. | Client-side substring filter covers 95% of mower debugging. |
| Alerting / notifications on log patterns | "Alert me when `rosbridge` prints ERROR." | Notification plumbing (Slack/Discord/email/webhook) = scope creep. Observer is literally sitting at the browser. | Browser title flash or a toast when filtered errors appear — if needed. Keep local-only. |
| Multi-container tail merge ("show me slam + nav + rosbridge interleaved") | Correlating across services is real. | Correct interleaving requires cross-container timestamp-sorted merging; backpressure per container; UX for N>2 streams. LazyDocker kind of does this and it's finicky. | Two browser tabs side-by-side. Revisit in v2.3 if the 2-tab workflow hurts. |
| Foxglove-style log panel integration | Foxglove has `rosout` panel that reads `/rosout` topic. | `/rosout` ≠ Docker stdout/stderr. Firmware/infra (micro-ros-agent restart, rosbridge crash) emits to Docker logs, not `/rosout`. Different layer. | These two are complementary, not substitutes. Foxglove stays for ROS-layer debug; `/logs` covers infra layer. |

---

## Area 2: SLAM Pose → EKF Yaw Fusion

**Reference:** `robot_localization` EKF docs; `slam_toolbox` README; `nav2` setup guides; standard Nav2 + robot_localization + slam_toolbox stack (the canonical ROS2 outdoor/indoor navigation pattern).

This is a **silent-correctness feature**: the user-visible symptom is "the SLAM map stops drifting when the robot sits still and stops sliding when the robot moves." There is no new UI, no new button. The success signal is that existing `/lidar` visualization *looks right* during motion — specifically the v2.1 gap called out in PROJECT.md's Key Decisions: *"Map-scan alignment under motion deferred — Gated on stable yaw source."*

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| EKF subscribes to a scan-matched pose as an input | This is the whole point of the milestone. Standard `robot_localization` pattern: add a `pose0`/`pose1` input in `ekf.yaml`, subscribe via `pose0: /slam_toolbox/pose` (or equivalent), configure the 15-bool vector. | MEDIUM | `slam_toolbox` publishes scan-matched pose; needs to be confirmed by topic inspection on-hardware (async_slam_toolbox_node typically publishes `/slam_toolbox/pose` as `geometry_msgs/PoseWithCovarianceStamped`). Recommended yaw-only config: `[false,false,false, false,false,true, false,false,false, false,false,false, false,false,false]` — absolute yaw, no xy, no velocities. |
| Covariance tuned so SLAM yaw dominates IMU yaw at rest | Without this, the EKF weights both inputs ~equally and IMU's gyro-bias drift still leaks through. Covariance is the knob. | MEDIUM | SLAM yaw covariance: small (e.g. 0.01 rad²); IMU yaw/yaw-rate covariance: larger than current. Requires measuring IMU noise floor during a static baseline test — not just guessing. |
| TF tree remains unique — exactly one publisher per transform | `slam_toolbox` publishes `map→odom`. EKF publishes `odom→base_link`. Neither should publish the other's transform. Double-publishing causes "erratic behavior" (per `robot_localization` maintainers). | MEDIUM | Verify `slam_toolbox` params `publish_tf: true`; verify `ekf` params `publish_tf: true`; verify no overlap. |
| Works with existing EKF sources (IMU + GPS) | This is an addition, not a replacement. Current fusion of IMU + GPS must continue. | LOW | Add new `pose0` source to existing config; don't remove `imu0` or `odom0`/`gps` inputs. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Differential mode for yaw (`pose0_differential: true`) | Feeds yaw *change* rather than absolute yaw — avoids coordinate-frame mismatch if `slam_toolbox` yaw is in `map` frame while EKF outputs in `odom`. Safer default when TF topology is in flux. | LOW | One yaml flag. Tradeoff: differential mode can't correct accumulated error; absolute mode can but needs frame-matching. For v2.2 start with **absolute** since we control both ends of the pipeline; fall back to differential if frame-mismatch observed. |
| Operator-visible heading confidence indicator on dashboard | Silent-correctness features frustrate operators (*"did the fix land?"*). A small badge on the dashboard showing heading variance / fusion mode answers the question. | LOW | Subscribe to `/odometry/filtered` covariance matrix; display yaw variance as a colored badge. Cheap insurance. |
| Map-scan alignment regression test (automated) | Convergence is hard to eyeball. A test that drives a canned `cmd_vel` pattern and checks scan-vs-map alignment delta would catch regressions. | HIGH | Requires physical drivetrain — **deferred in PROJECT.md** (HW-04, HW-05 gated on motors electrically connected). Flag for a future milestone; do not block v2.2 on it. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Replace IMU entirely with SLAM pose | "If SLAM is better, why keep the IMU?" | IMU provides high-rate (30 Hz) angular velocity; SLAM publishes at scan rate (~10 Hz) and depends on stationary features. Inside featureless space (open lawn) scan-matching degrades; IMU is the fallback. They're complementary. | Keep both. EKF handles the complementary-filter job. |
| Use `slam_toolbox` position (xy) as EKF input, not just yaw | "It's already scan-matched and drift-bounded — use it all." | SLAM xy is in `map` frame and gets corrected via loop closure (jumps). Feeding jumps into EKF creates pose discontinuities that break `cmd_vel` controllers. Standard practice: use `map→odom` TF correction, not direct xy input. | Yaw-only fusion. RTK-GNSS remains the xy source. |
| Switch `slam_toolbox` to sync mode for loop closure | "Loop closure would eliminate drift entirely." | PROJECT.md explicitly defers this: *"Loop closure in slam_toolbox (sync mode) — async mode is the right tradeoff for a live-map dashboard."* Sync mode stalls the map update loop, ruining live UX. | Accept long-trajectory drift. The yaw-fusion fix addresses the *rest-state* and *short-motion* drift that matters for map-scan alignment. |
| Build a custom scan-matcher | "`slam_toolbox` might not be the right fit." | It's the standard. Competence-building > reinvention for a hobby robot. | Use `slam_toolbox` output as-is. |
| Safety watchdog enabled in this milestone | "Now that yaw is better, we can gate `cmd_vel`." | PROJECT.md Out of Scope: *"re-evaluate once heading-fusion stabilizes yaw."* Activating the watchdog before the fusion is observed in the field would false-trigger. | Defer to post-v2.2 after operator validates the map stops drifting. |

---

## Area 3: `/lidar` Residuals + Persistence + Honest Reset

**Reference:** Foxglove Studio "3D" panel, RViz2 "Map" + "LaserScan" displays, Google Maps / Leaflet panning behavior, slam_toolbox's serialization format, standard browser localStorage idioms.

The v2.1 `/lidar` page renders the occupancy-grid bitmap centered-and-static; when the robot moves, the scan visibly translates away from the rendered map (see PROJECT.md Key Decisions: *"Map-scan alignment under motion deferred"*). This area fixes that plus adds refresh-resilience and a clear "start over" operator action.

**Core UX convention in RViz and Foxglove:** the map is anchored in world frame; the robot moves through it. When the operator wants to follow the robot, they enable "follow target" mode which re-centers the camera on `base_link` — but the map geometry itself stays anchored. The *camera* moves, not the *map*.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Map-anchored rendering: occupancy grid offset by `-map→base_link` translation | Otherwise "the robot is always at screen center" means the grid visibly slides under the robot instead of the robot moving through a stationary grid. That's the bug symptom driving this feature. | MEDIUM | Subscribe to `map→base_link` TF (via `/tf` topic with rosbridge). In `<MapBitmap>` render, translate the canvas origin by `(-x, -y)` scaled by map resolution. Scan overlay stays at the canvas center. Result: as the robot drives east, the grid scrolls west, scan stays centered. |
| Scan and map visually aligned during motion | Operator's only way to tell whether localization is working. If they slide relative to each other, nothing downstream is trustworthy. | MEDIUM | Falls out of the residual-subtraction fix above *and* the Area 2 yaw fusion. This is the integration test for both. |
| localStorage persistence of the last-received occupancy grid | Browser refresh currently drops the rendered map (Zustand store is memory-only). Reload → blank map → wait 10s for next `/map` publication → meanwhile scan has no context. Bad UX. | MEDIUM | OccupancyGrid is `int8[width*height]` + metadata. For a 500×500 grid (~250KB) store a compressed version (gzip via CompressionStream API) keyed by session. On mount, rehydrate if present, then let next `/map` message overwrite. Size watch: localStorage per-origin quota ~5–10 MB; log a warning if approaching. |
| Server-side "honest reset" endpoint wired to existing Eraser UI | Current Eraser UI is client-only — it clears the rendered canvas but doesn't reset SLAM. Operator thinks they're starting fresh; they're not. "Honest reset" = actually calls `slam_toolbox` service to clear internal state. | MEDIUM | `slam_toolbox` provides `/slam_toolbox/clear` or similar service. Expose via a new `server.mjs` HTTP endpoint `POST /api/slam/reset` that calls the ROS service through rosbridge (rosbridge exposes `callService`). Eraser button wires to that endpoint *and* clears the canvas *and* clears localStorage. |
| Refresh-safe: reload leaves operator in the same visual state | Lost work is the cardinal sin of operator UIs. | LOW | Combination of localStorage rehydration (grid) + reconnect-on-mount (scan + TF) gets this for free. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| "Follow robot" toggle (camera recenters on `base_link`) vs "free pan" mode | Operator walking around the yard watching the phone wants auto-follow. Operator debugging at a desk wants to pan freely. Both personas exist. | LOW | Toggle in existing pan/zoom controls. In follow mode, the canvas re-centers each frame; in free mode, pan offset is user-controlled (current v2.1 behavior). |
| Visual "robot cursor" sprite (triangle/arrow at `base_link` origin) | Operator needs to see *where* the robot is on the persisted map, not just the latest scan. Standard in RViz, Foxglove, every nav viewer. | LOW | Draw after the map bitmap, before the scan. Orient by yaw from TF. |
| Map staleness badge ("grid last updated N seconds ago") | If `slam_toolbox` crashes, the grid silently stops updating while the scan keeps coming. Operator wouldn't know. | LOW | Timestamp on last `/map` message; render age. Same pattern as v2.1 scan stale-badge — reuse the component. |
| "Session" concept for localStorage (multiple saved maps) | Operator runs the mower twice — keep both maps? | MEDIUM | Out of scope for v2.2 (single-session persistence is enough). Flag for post-MVP. |
| Pre-populate fresh load with last-known pose + grid | So "look at my mower" after a crash opens to a meaningful state. | LOW | Same localStorage mechanism extended to store last TF pose. Stale but informative. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| IndexedDB for grid storage instead of localStorage | "IndexedDB scales better." | Overkill for one 250KB grid. IndexedDB is async-only, adds Promise plumbing, requires a schema migration strategy. YAGNI. | localStorage + compression; switch only if size becomes a problem (it won't for 2D grids at this resolution). |
| Save/load named map files from disk (server-side) | "Like RViz does." | Requires filesystem layout, server-side endpoints for list/read/write, UX for selecting, migration when grid parameters change. That's a separate feature class. | `slam_toolbox` has its own `serialize_map` / `deserialize_map` services for this — use those directly from the browser if ever needed. |
| Grid overlay on top of the satellite map on `/map` page | "Why two map pages?" | Grid is in `map` frame (origin = SLAM session start); satellite is in `earth` frame (lat/lon). Aligning them requires a stable earth→map transform (the navsat_transform output) AND survey-accurate first-fix. Current RTK fix under trees is not reliable enough. | Keep separate: `/map` = GPS/missions, `/lidar` = SLAM grid + scan. Per PROJECT.md constraint. |
| Auto-clear localStorage on schema change | "In case `/map` metadata format changes." | `/map` is `nav_msgs/OccupancyGrid`, a stable ROS message. Won't change. | Don't add code that doesn't fix an observed problem. |
| `ros3djs` / `ros2djs` for rendering | "Standard ROS web library." | PROJECT.md Out of Scope: *"ros3djs / ros2djs in the web viz — Canvas 2D stays the rendering primitive."* Plus ros3djs is unmaintained w/ React-version issues (per v2.1 Key Decisions). | Keep Canvas 2D. |
| Client-side SLAM (run scan-matching in the browser) | Absurd but tempting for "edge-compute the UI." | No. Scan-matching stays on the Pi next to the sensor. | N/A. |
| Auto-reset SLAM on disconnect | "If rosbridge dies, start fresh on reconnect." | Destroys the operator's mental model. They walked away for 30 seconds; they come back and the map's gone. | Honest reset stays manual, behind the Eraser button. |

---

## Feature Dependencies

```
Area 3: /lidar residuals
    └── requires ── TF subscription for map→base_link in browser
                         └── requires ── /tf topic already bridged by rosbridge (existing, v2.1)

Area 3: honest reset
    └── requires ── server.mjs proxying rosbridge (existing)
    └── requires ── slam_toolbox clear-state service (existing in slam_toolbox, untested from browser)

Area 3: visible-correct alignment during motion
    └── enhanced-by ── Area 2 yaw fusion (same symptom; two halves of the fix)

Area 2: SLAM pose → EKF yaw
    └── requires ── slam_toolbox publishing scan-matched pose (existing, v2.1)
    └── requires ── EKF yaml config changes (existing config file, v2.1)

Area 1: Container logs
    └── requires ── docker.sock mounted read-only into web container (new)
    └── requires ── server.mjs extended with WebSocket proxy analogous to /rosbridge (new path; existing proxy pattern)

Area 1 and Area 2 and Area 3 are architecturally independent.
Area 3's "alignment under motion" success-criterion is enhanced by Area 2 landing first.
```

### Dependency Notes

- **Area 3 `/lidar` residuals depend on TF in the browser:** `/tf` and `/tf_static` are standard rosbridge topics; v2.1 already has rosbridge wired. Likely already flowing but untested from the browser side — verify during phase planning.
- **Area 3's honest-reset depends on a slam_toolbox service name:** needs on-hardware confirmation of the exact service (`/slam_toolbox/reset`, `/slam_toolbox/clear_queue`, etc. — varies by slam_toolbox version).
- **Area 2 enhances Area 3's visual success:** if yaw is still drifty at rest, the "map scrolls under the robot" fix will *still* look wrong (scan will rotate relative to grid). Suggest roadmap ordering Area 2 → Area 3, or at minimum validate Area 3 after Area 2 is in.
- **Area 1 is independent:** it touches different code paths entirely (`server.mjs` + new route `/logs` + new sidecar logic); can ship in parallel.
- **No architectural conflicts** between the three areas. No shared state, no competing TF publishers, no port conflicts.

---

## MVP Definition (for v2.2)

This *is* the MVP for the milestone. The three areas together are the "ops & fusion polish" package.

### Launch With (v2.2)

- [ ] **Container list + live-tail viewer** with follow-mode, initial backfill, timestamp toggle, auto-scroll-with-pause, service-name labels, log-level coloring, client-side filter — the table-stakes set for Area 1
- [ ] **Read-only docker.sock sidecar + server.mjs WebSocket proxy** — the infra that makes Area 1 go
- [ ] **EKF yaml updated with yaw-only SLAM pose input** and covariances tuned so SLAM yaw dominates IMU yaw at rest
- [ ] **Heading-confidence badge on dashboard** — small but critical for operator trust in the silent-correctness fix
- [ ] **`<MapBitmap>` residual rendering** — grid offset by `-map→base_link` so scan stays visually locked to grid under motion
- [ ] **localStorage persistence** for the last occupancy grid, rehydrated on page mount
- [ ] **Honest-reset endpoint** in `server.mjs` calling `slam_toolbox` clear service; Eraser button wires to it
- [ ] **Robot cursor sprite** on `/lidar` showing `base_link` pose — trivially cheap and critical for legibility

### Add After Validation (v2.3 or late-v2.2 stretch)

- [ ] **"Since" filter and log download** on `/logs` — strong differentiators, low cost; add if Area 1 lands with time to spare
- [ ] **Map staleness badge** (mirrors v2.1 scan stale-badge pattern) — low cost
- [ ] **Follow-robot toggle** on `/lidar` — low cost but requires operator session to know which default they want

### Future Consideration (post-v2.2)

- [ ] **Map-scan-alignment automated regression test** — blocked on drivetrain connected (HW-04/HW-05 in PROJECT.md Deferred)
- [ ] **Safety watchdog** (`/cmd_vel` gating) — blocked on heading-fusion validation in the field
- [ ] **Multi-session map library** — defer until a single session's UX is mature
- [ ] **Container-lifecycle buttons** on `/logs` — only if operator pain-session demonstrates need
- [ ] **Multi-container merged tail** — if 2-tab workaround proves painful

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Container list + live-tail w/ follow-mode | HIGH | MEDIUM | P1 |
| Initial backfill + timestamps + auto-scroll-with-pause | HIGH | LOW | P1 |
| Service-name labels + log-level coloring | MEDIUM | LOW | P1 |
| Client-side text filter | MEDIUM | LOW | P1 |
| EKF yaml yaw-only SLAM input | HIGH | MEDIUM | P1 |
| Covariance tuning | HIGH | MEDIUM | P1 |
| Heading-confidence badge | MEDIUM | LOW | P1 |
| `<MapBitmap>` residual subtraction | HIGH | MEDIUM | P1 |
| localStorage grid persistence | HIGH | MEDIUM | P1 |
| Honest-reset endpoint + Eraser wiring | HIGH | MEDIUM | P1 |
| Robot cursor sprite | MEDIUM | LOW | P1 |
| "Since" filter + log download | LOW | LOW | P2 |
| Map staleness badge | MEDIUM | LOW | P2 |
| Follow-robot toggle | MEDIUM | LOW | P2 |
| Container-lifecycle buttons | LOW (risky) | MEDIUM | P3 (anti) |
| Multi-container merged tail | LOW | HIGH | P3 |
| DuckDB / SQL over logs | LOW | HIGH | P3 (anti) |
| Session map library | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v2.2
- P2: Should have, add when time permits in v2.2
- P3: Nice to have, future consideration or explicitly anti-feature

---

## Reference Product Analysis

| Feature | Dozzle | Portainer | LazyDocker | MowerBot `/logs` |
|---------|--------|-----------|------------|------------------|
| Live tail | Yes | Yes | Yes (TUI) | Yes (P1) |
| Initial backfill | Yes (300 lines) | Yes | Yes | Yes, 300 lines (P1) |
| Regex/fuzzy search | Yes | Basic | Basic | Substring only (P1); no regex |
| SQL/DuckDB | Yes (v10+) | No | No | No (anti-feature) |
| Container lifecycle | Yes | Yes | Yes | No (anti-feature: read-only socket) |
| Shell exec | Yes | Yes | Yes | No (anti-feature) |
| Multi-container merge | No | No | Kind of | No (P3) |
| Alerting/webhooks | Yes | Limited | No | No (out of scope) |
| Auth | Optional | Required | N/A | None (trusted local net per PROJECT.md) |

| Feature | RViz2 | Foxglove Studio | MowerBot `/lidar` v2.2 |
|---------|-------|-----------------|------------------------|
| Map anchored, robot moves | Yes | Yes | Yes (P1, this milestone) |
| Follow-robot camera mode | Yes (toggle) | Yes (toggle) | Yes (P2) |
| Robot cursor sprite | Yes (configurable) | Yes (configurable) | Yes (P1) |
| Persisted state across restart | Via saved config file | Yes (layout file) | Yes, localStorage (P1) |
| Clear/reset map | Via slam_toolbox service call | Via slam_toolbox service call | Yes, Eraser button → server endpoint (P1) |
| Scan over grid overlay | Yes | Yes | Yes (v2.1) |
| Custom scan colormap | Yes | Yes | Yes, viridis (v2.1) |

| Feature | ros2_control + AMCL | Autoware EKF localizer | MowerBot v2.2 fusion |
|---------|---------------------|------------------------|----------------------|
| Yaw-only pose fusion | Standard pattern | Standard pattern | Yes (P1) |
| Differential-mode yaw | Optional | Optional | Absolute first; fall back if needed |
| Covariance-tuned dominance | Required | Required | Yes (P1) |
| Visual convergence feedback | RViz covariance ellipse | Autoware dashboard | Dashboard heading badge (P1) |

---

## Sources

- [Dozzle — Realtime log viewer for containers (GitHub)](https://github.com/amir20/dozzle) — UX reference for Area 1 table-stakes and differentiators. Verified features: live tail, search, DuckDB, shell exec. HIGH confidence.
- [Dozzle docs — What is Dozzle?](https://dozzle.dev/guide/what-is-dozzle) — explicit statement "does not store log files; real-time only" informing the "no persistent storage" anti-feature.
- [Dozzle real-time log viewer overview (Better Stack)](https://betterstack.com/community/guides/scaling-docker/dozzle-docker/) — follow-mode / search / live-tail UX conventions.
- [robot_localization — Nav2 setup guide (Smoothing Odometry)](https://docs.nav2.org/setup_guides/odom/setup_robot_localization.html) — canonical pattern for yaw-only pose input to EKF. HIGH confidence.
- [robot_localization ekf.yaml example (GitHub, cra-ros-pkg)](https://github.com/cra-ros-pkg/robot_localization/blob/ros2/params/ekf.yaml) — 15-bool input vector semantics (x,y,z,roll,pitch,yaw, velocities, accels) used in yaw-only config.
- [robot_localization package overview (ROS Index)](https://index.ros.org/p/robot_localization/) — confirms `PoseWithCovarianceStamped` as a supported input message type.
- [How to combine slam_toolbox and robot_localization using Nav2 (ROS answers)](https://answers.ros.org/question/413730/how-to-combine-slam_toolbox-and-robot_localization-using-nav2/) — confirms "don't publish same transform from both" rule driving the TF-tree uniqueness table-stake. MEDIUM confidence (community answer, but aligned with official docs).
- [Fusion of poses only (robot_localization issue #409)](https://github.com/cra-ros-pkg/robot_localization/issues/409) — maintainer confirmation of erratic behavior when duplicate TF publishers exist.
- [Sensor Fusion and Robot Localization Using ROS 2 Jazzy (automaticaddison)](https://automaticaddison.com/sensor-fusion-and-robot-localization-using-ros-2-jazzy/) — practitioner walkthrough; informed covariance-tuning guidance.
- MowerBot `.planning/PROJECT.md` — constraints (read-only docker.sock; Canvas 2D primitive; deferred sync-mode loop closure; deferred safety watchdog).
- MowerBot `.planning/codebase/ARCHITECTURE.md` — existing server.mjs proxy pattern (the template for Area 1 log-stream proxy).

---

*Feature research for: MowerBot v2.2 Ops & Fusion Polish*
*Researched: 2026-04-15*
