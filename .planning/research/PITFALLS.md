# Pitfalls Research

**Domain:** Ops observability (dockerode log streaming) + EKF sensor fusion (slam_toolbox → robot_localization) + client-side persistence (localStorage OccupancyGrid) for an existing CycloneDDS + Next.js + Docker Compose robotics stack
**Researched:** 2026-04-15
**Confidence:** HIGH (stack + failure modes directly observed in v2.1 codebase; fusion pitfalls verified against robot_localization + slam_toolbox docs)

## Critical Pitfalls

### Pitfall 1: `docker.sock` mounted writable → container root-equivalent on host

**What goes wrong:**
The logs-agent container is given `/var/run/docker.sock:/var/run/docker.sock` without `:ro`. Anyone who can exec a command inside that container — or who can exploit a dockerode endpoint exposed through the Next.js proxy — can now `POST /containers/create` with a privileged+host-mount payload and obtain root on the Pi. This is not a theoretical CVE; it is the documented "equivalent of giving root access" pattern.

**Why it happens:**
Default Docker tutorials show `-v /var/run/docker.sock:/var/run/docker.sock` without the `:ro` suffix. dockerode's log/events/list methods are all read operations, so developers don't realise their mount is still write-capable. The WebSocket proxy in `server.mjs` may also forward arbitrary path queries if not explicitly allowlisted.

**How to avoid:**
1. Mount read-only: `/var/run/docker.sock:/var/run/docker.sock:ro`.
2. Run the sidecar with a non-root user in-container (`user: "1000:999"` where 999 = host `docker` group gid) — never as `root`.
3. Allowlist dockerode methods server-side: the WS proxy only proxies `list`, `logs`, `inspect`. No `create`, `exec`, `start`, `kill`, `commit`, `build`, `prune`. Enforce at the Node layer, not via Docker API permissions (the daemon has no per-endpoint ACL).
4. Do NOT expose the logs-agent port to the LAN — keep it on loopback and route through `server.mjs`, same pattern as rosbridge.
5. Document in `docker-compose.yml` comments that the sock is RO and why.

**Warning signs:**
- `docker inspect logs-agent | jq '.[0].Mounts'` shows `"RW": true` on the sock mount.
- The sidecar Dockerfile has no `USER` directive.
- `server.mjs` forwards `message.event` or `path` from client unchanged into dockerode calls.

**Phase to address:** Phase 1 (logs-agent scaffold). Verification must happen before the agent container is ever started on the Pi.

---

### Pitfall 2: dockerode log-stream demux skipped → binary garbage in the UI

**What goes wrong:**
Calling `container.logs({ follow: true, stdout: true, stderr: true })` on a container started WITHOUT a TTY returns a multiplexed stream: each chunk has an 8-byte header `[STREAM_TYPE, 0, 0, 0, SIZE_u32_BE]` followed by payload bytes. Piping that directly to the browser renders control characters, spurious glyphs, and mis-split lines. It also silently mis-tags stderr as stdout, which the operator will trust when debugging.

**Why it happens:**
The dockerode README example uses a TTY-enabled container (`Tty: true`), where logs stream as raw bytes with no header — it "just works" in the demo. Production ROS2 containers in this stack do NOT allocate a TTY (nothing in `docker-compose.yml` sets `tty: true`), so the multiplexed framing kicks in and the example breaks.

**How to avoid:**
1. Detect per-container TTY via `container.inspect()` → `Config.Tty`. Cache per session.
2. If `Tty === false`: use `container.modem.demuxStream(stream, stdoutPT, stderrPT)` with two `PassThrough` streams, tag each line `{stream: "stdout"|"stderr", text, ts}` before forwarding over the WS.
3. If `Tty === true`: forward raw bytes, tag everything as stdout.
4. Unit-test the demuxer with a known fixture (8-byte header + payload) — do not trust live containers.

**Warning signs:**
- First 8 chars of each log line look like garbage (`\x01\x00\x00\x00...`).
- stderr lines (e.g. ROS `[ERROR]`) show up colored as stdout in the UI.
- Line boundaries split mid-word on long log lines.

**Phase to address:** Phase 1 (logs-agent). Demuxer must have a unit test before any live container is wired.

---

### Pitfall 3: Container lifecycle drift breaks the log stream silently

**What goes wrong:**
Operator restarts a container (e.g. `docker restart slam`) to test recovery. The log WebSocket was attached to the old container ID. Docker emits `close` on the stream but the browser keeps showing the last frame. New log output goes nowhere. Worse: the container list in the sidebar is stale, so when the container reappears with a new ID, the user clicks the ghost entry and sees "container not found" from dockerode.

**Why it happens:**
dockerode log streams are bound to a container *ID*, not *name*. After restart the ID changes. The sidecar is not subscribed to `/events` so it has no lifecycle signal. The UI treats the WS closing as a network error and retries against a dead ID.

**How to avoid:**
1. Sidecar subscribes to `docker.getEvents({filters: {type: ['container'], event: ['start','die','destroy','rename']}})` on startup; broadcasts `container_list_changed` messages to all clients.
2. Client container list is keyed by `Names[0]` (human-readable), resolved to ID at subscribe time.
3. On log-stream `close`/`error`, auto-resolve name → new ID and re-subscribe once; back-off after 3 attempts.
4. Surface lifecycle transitions inline in the log view: `[2026-04-15T10:12:03Z] container restarted — reconnected to new instance`.

**Warning signs:**
- UI container list does not update when user runs `docker compose restart <svc>` from SSH.
- Log view "freezes" after a manual restart — no error, no new lines.
- `netstat` shows accumulated half-closed connections to the sock.

**Phase to address:** Phase 1 (logs-agent). Must be covered by the operator UAT walkthrough that includes `docker compose restart slam`.

---

### Pitfall 4: Feeding SLAM yaw + IMU yaw into EKF as independent sources → filter divergence

**What goes wrong:**
Operator adds `slam_toolbox` pose as a new EKF input alongside the existing IMU. Both are configured with `yaw` set to `true` and low covariance. For a short period the filter looks great — yaw lock is tight at rest. Then during motion, the EKF starts oscillating or slowly diverges. Odometry filtered yaw diverges 20-40° from reality over a minute. Root cause: the slam_toolbox scan-match pose is itself derived (in part) from the prior EKF pose via `/tf`, and the IMU is also in that chain. The "two" measurements are correlated — a classic Kalman filter assumption violation.

**Why it happens:**
`robot_localization` assumes measurement sources are statistically independent. slam_toolbox uses `odom` frame (which the EKF publishes) as its prior for scan-matching, so its "measurement" is a function of the very state the EKF is estimating. Feeding it back as an independent yaw source double-counts information and inflates confidence incorrectly.

**How to avoid:**
1. **Do not fuse slam_toolbox pose directly into the same EKF that publishes the `odom→base_link` transform slam_toolbox consumes.** That is a closed loop.
2. Architecture option A (recommended): Run a **second** EKF instance that publishes `map→odom` by fusing `slam_toolbox` output + GPS, while the existing EKF continues to publish `odom→base_link` from IMU (+ future wheel odom). This is the canonical `robot_localization` two-EKF pattern (see `ekf.yaml` examples in rl docs).
3. Architecture option B: Use slam_toolbox's `/slam_toolbox/toolbox_msgs/ScanMatchingStatus` + pose as **differential** input (`_differential: true`) not absolute — only the yaw *delta* between scan-match updates, which breaks the correlation chain.
4. Set covariance realistically: slam_toolbox reports no covariance by default; picking a tiny number because "scans are accurate" is a trap. Start with `0.05 rad²` (~12° 1σ) for yaw and tune down only if the filter stays stable.
5. Never set `imu0_yaw: true` AND `pose0_yaw: true` simultaneously at low covariance without verifying the scan-match pose is not derived from the IMU's own estimate.

**Warning signs:**
- `/odometry/filtered` yaw and raw IMU yaw diverge monotonically when the robot is stationary.
- EKF covariance reported in `/diagnostics` shrinks below what the inputs warrant (over-confident filter).
- Log messages from `ekf_node`: `"Transform from X to Y was unavailable for the time requested"` — often a symptom of a TF cycle triggered by the new fusion.

**Phase to address:** Phase 2 (SLAM→EKF yaw fusion). Gate is a 60-second stationary test: yaw drift <1° RMS between filtered odom and ground-truth compass reading.

---

### Pitfall 5: TF cycle between slam_toolbox and the new EKF

**What goes wrong:**
Both the EKF and slam_toolbox publish `map→odom`. `tf2` silently accepts whichever broadcaster arrives last; downstream consumers (rviz, web) see pose jumps at every update cycle. Or, worse: slam_toolbox publishes `map→odom`, the new second EKF *also* publishes `map→odom`, and the first EKF consumes the composite frame to produce `odom→base_link` — creating a feedback loop that appears in logs as `TF_OLD_DATA` and `Lookup would require extrapolation into the future`.

**Why it happens:**
The `robot_localization` two-EKF pattern requires *exactly one* node to publish each transform. Default slam_toolbox config publishes `map→odom`; default `ekf_node` in `world_frame: map` mode also publishes `map→odom`. Copy-pasting example configs from different tutorials lands you here.

**How to avoid:**
1. Decide the map-frame owner ONCE. For v2.2: **slam_toolbox owns `map→odom`**. The second EKF, if added, must run in `world_frame: odom` mode (not `map`) and must NOT publish `map→odom`.
2. In slam_toolbox config: confirm `transform_publish_period: 0.05` and `mode: mapping`.
3. Add a startup assertion: grep `ros2 run tf2_tools view_frames` output for exactly one publisher of `map→odom`.
4. Document ownership in `config/ekf.yaml` as a header comment.

**Warning signs:**
- `ros2 topic echo /tf` shows duplicate `map→odom` transforms with different timestamps from different nodes.
- `view_frames.pdf` shows a cycle.
- rviz pose arrow visibly jitters at EKF publish rate even when robot is still.

**Phase to address:** Phase 2 (SLAM→EKF yaw fusion). Add `view_frames.pdf` inspection to the phase acceptance test.

---

### Pitfall 6: Clock skew / timestamp mismatch between slam_toolbox and EKF

**What goes wrong:**
slam_toolbox stamps its pose output with the scan's acquisition time (which on LD19 is ~30-100 ms old by the time matching finishes). EKF expects recent timestamps; if slam_toolbox pose arrives older than the EKF's last state, the filter either rejects the input (quiet failure, no yaw correction applied) or silently rewinds and replays — expensive and wrong. With `use_sim_time` misconfigured across containers, the skew can be seconds, not ms.

**Why it happens:**
Container-isolated clocks, ROS's `use_sim_time` defaults, async slam_toolbox processing latency, and the LD19 driver's own buffering stack up. The CycloneDDS-over-shmem transport hides network latency but not processing latency.

**How to avoid:**
1. All containers: `use_sim_time: false` unless a rosbag is playing. Assert at container start.
2. Measure pipeline latency explicitly: `ros2 topic delay /slam_toolbox/pose` — must stay <100 ms.
3. Configure EKF `transform_time_offset: 0.0` and `transform_timeout: 0.1`. If EKF logs `... message received is older than ...`, slow the EKF publish rate to match slam_toolbox cadence (typically 5 Hz for SLAM vs 30 Hz for EKF).
4. NTP sync on the Pi itself — `chronyc tracking` offset <10 ms.

**Warning signs:**
- `ros2 topic hz /slam_toolbox/pose` shows nominal rate but EKF yaw never visibly corrects.
- EKF log: `filter is X seconds ahead of transform`.
- `ros2 topic delay` shows >200 ms on slam pose.

**Phase to address:** Phase 2 (SLAM→EKF yaw fusion). Add latency measurement to phase success gate.

---

### Pitfall 7: localStorage OccupancyGrid blows past quota → silent write failures

**What goes wrong:**
A 20m × 20m map at 5 cm resolution = 400×400 = 160k cells. Stored naively as a JSON array of int8: ~500 KB per snapshot. Store every update and you hit the ~5-10 MB origin quota within 10-20 updates. `localStorage.setItem` throws `QuotaExceededError`, which — if swallowed — means the map silently stops persisting. On reload the operator sees an old map that doesn't match current reality, and has no indication why.

**Why it happens:**
Browser localStorage quotas vary (Chrome: 10 MB/origin; Safari mobile: 5 MB; private mode: 0-5 MB). OccupancyGrid naive serialization is fat. Developers write `try { setItem } catch {}` or don't wrap at all.

**How to avoid:**
1. Encode the grid as a Uint8Array then base64 (or better: pack two cells per byte since occupancy is -1/0..100 → fits in 7 bits, but int8-as-raw-bytes → base64 is simpler and ~1.33× expansion).
2. Store ONE current snapshot under a single key (`mower.lidar.map.v1`), not a history.
3. Debounce writes: max 1 write per 2 seconds. The map doesn't change that fast to operator eye.
4. Wrap `setItem` in try/catch; on `QuotaExceededError`: delete the key, retry once, then surface a toast: "Map persistence disabled — quota exceeded. Using in-memory only."
5. Also store `metadata` (resolution, origin, width, height, timestamp) as a separate small key so you can validate on load.

**Warning signs:**
- Map persistence works for the first few minutes, then stops with no visible error.
- `localStorage.length` stays constant while `JSON.stringify(localStorage).length` grows.
- DevTools Application tab shows single entry approaching 5 MB.

**Phase to address:** Phase 3 (`/lidar` map-anchor + persistence). Add a quota-exceeded simulation test: artificially fill localStorage to 4.5 MB and verify graceful degradation.

---

### Pitfall 8: Stale persisted map resurrects after "honest reset" → operator distrust

**What goes wrong:**
Operator clicks Eraser. Server-side slam_toolbox receives reset request and clears its map. Dashboard shows fresh empty grid. Operator reloads the page (F5). The browser restores the OLD persisted map from localStorage, and the next `/map` update merges with it. Now the operator sees a Frankenstein map that mixes pre-reset and post-reset scans. They lose trust in the reset button — the core UX promise of "honest reset" is broken.

**Why it happens:**
Server-side state and client-side localStorage are separate sources of truth. The reset endpoint only clears the server. The client assumes localStorage is always authoritative on load.

**How to avoid:**
1. Reset flow must be two-phase: client calls server `/api/map/reset` → on success, client ALSO clears `localStorage.removeItem('mower.lidar.map.v1')` before re-subscribing.
2. Include a **map epoch/reset counter** in OccupancyGrid metadata (store next to map in localStorage). Server publishes current epoch in a latched topic (`/mower/map_epoch`) or via an HTTP endpoint. On client mount: fetch current epoch; if persisted epoch ≠ current → discard persisted map and start fresh.
3. The server-side reset must bump the epoch.
4. Show epoch in the UI footer as a small "map #N" indicator so drift is visible.

**Warning signs:**
- Map "remembers" obstacles after reset.
- Page reload after reset shows different map than fresh load.
- No way to distinguish a stale snapshot from a fresh one in the UI.

**Phase to address:** Phase 3 (`/lidar` map-anchor + persistence + reset). The epoch mechanism must be designed before the reset endpoint, not after.

---

### Pitfall 9: `server.mjs` `/logs` WS proxy shadows or breaks `/rosbridge` upgrade

**What goes wrong:**
Developer adds a second `server.on('upgrade', ...)` handler for `/logs`. Node's HTTP server fires all upgrade handlers for every upgrade request; whichever handler calls `socket.destroy()` or writes a response first wins. If both handlers inspect `req.url` without early-return, or if registration order accidentally reverses, `/rosbridge` connections start closing immediately and the whole dashboard goes dark.

**Why it happens:**
The current `server.mjs` pattern uses a single upgrade handler with a path check. Adding a second `server.on('upgrade', ...)` doesn't replace — it appends. Both handlers run. The existing NaN-sanitizing proxy is load-bearing; the v2.1 regression tests already flagged this exact pattern as fragile.

**How to avoid:**
1. **Single upgrade handler** with path dispatch — do not add a second `server.on('upgrade')` listener. Extend the existing handler in `server.mjs`.
2. Dispatch by exact path match: `if (pathname === '/rosbridge') { ... } else if (pathname === '/logs') { ... } else { socket.destroy(); }`.
3. Explicitly `return` after each branch to prevent fall-through.
4. Add a regression test: after deploy, open both `/rosbridge` and `/logs` concurrently from two browser tabs — verify both stream independently for 60 seconds.

**Warning signs:**
- After adding `/logs`, the dashboard's rosbridge disconnect toast starts firing.
- `server.mjs` logs show both handlers logging the same upgrade request.
- `netstat` shows doubled connections per client.

**Phase to address:** Phase 1 (logs-agent + WS proxy wiring). Must include the concurrent-connection regression test.

---

### Pitfall 10: Canvas 2D map-anchor subtracts wrong frame → grid slides wrong direction

**What goes wrong:**
The `<MapBitmap>` component is supposed to render the OccupancyGrid anchored to the world so the robot moves across it. Developer subtracts `odom→base_link` translation instead of `map→base_link`. When GPS jumps (SLAM corrects pose via loop closure or GPS fusion), the grid jumps with the robot instead of staying world-fixed. Or: developer uses only the X/Y translation and ignores the map's own `info.origin` offset (OccupancyGrid is stored in grid coords, not world coords).

**Why it happens:**
Three coordinate frames are involved (`map`, `odom`, `base_link`) and the OccupancyGrid has its own `info.origin` (usually non-zero). It's easy to pick the wrong pair. `/tf` also offers both, and the available store may cache whichever was most recently updated.

**How to avoid:**
1. Document the transform chain in `<MapBitmap>` with a comment block: world pixel = `(base_link_in_map.x - map.info.origin.x) / map.info.resolution`.
2. Use `map→base_link` explicitly (compose `map→odom` ∘ `odom→base_link` via `tf2`/`roslibjs` — or subscribe to the composed transform if slam_toolbox publishes it).
3. At high zoom, use `Math.round` for pixel alignment but keep float offsets for sub-pixel translation (transform the canvas context, not the raw pixel coordinates). Otherwise the grid wobbles at pixel boundaries.
4. Guard against `NaN`/`undefined` in the transform — map must only render when BOTH transforms are available.

**Warning signs:**
- Grid visibly jumps when GPS fix acquires/loses.
- Grid is offset by a fixed amount that equals `map.info.origin`.
- At 10× zoom, grid lines shimmer by 1 pixel per frame.

**Phase to address:** Phase 3 (`/lidar` map-anchor). Add a visual UAT: drive a straight line indoors; grid must stay geometrically straight relative to walls.

---

### Pitfall 11: Float precision drift when robot is far from world origin

**What goes wrong:**
RTK GPS reports position in UTM meters — commonly 400,000-600,000 m easting. Canvas 2D uses float32 internally for transforms. At 500,000 m with 5 cm resolution, you're at the edge of float32 precision (~6 digits), and pixel positions start quantizing. The rendered map appears to "breathe" — walls shift by ±1 px as the numeric representation flips between two nearest floats.

**Why it happens:**
slam_toolbox's `map` frame origin often coincides with the first GPS fix, which is a large UTM value. The renderer uses that directly.

**How to avoid:**
1. Rebase rendering coordinates: pick a local origin at map initialization (first fix) and subtract before passing to Canvas transforms. Keep the large values only for GPS math, not for pixels.
2. Use `ctx.setTransform(a, b, c, d, e, f)` with doubles (JS numbers are float64) — do NOT precompute into a Float32Array.
3. The local-origin offset is part of the persisted map metadata.

**Warning signs:**
- Map visibly shimmers at high zoom when stationary.
- Small (<10 cm) displacement rendered as 0 px movement.

**Phase to address:** Phase 3 (`/lidar` map-anchor). Add a far-from-origin test: simulate an OccupancyGrid with origin at (500000, 5500000) and verify 1 cm steps render as exactly one 5 cm / resolution-fraction pixel movement.

---

### Pitfall 12: Honest reset endpoint that silently fails client-side

**What goes wrong:**
Reset endpoint returns 200 after calling `ros2 service call /slam_toolbox/reset std_srvs/srv/Empty`. Client shows success toast. But slam_toolbox container is in a crash-loop (OOM from map size), so the "reset" went to a dead node. New scans never rebuild because there's no running slam instance. UI shows empty grid forever; operator assumes the feature is broken.

**Why it happens:**
Fire-and-forget reset without verifying the service actually executed. ROS services can time out / fail silently when the target node is down.

**How to avoid:**
1. Reset endpoint must: (a) verify slam node is alive (`ros2 node list | grep slam`), (b) call the service with an explicit 5 s timeout, (c) verify post-reset that map dimensions reset (subscribe-once to `/map` and check width×height shrank), (d) return structured `{ok: true, epoch: N+1}` or `{ok: false, reason: "..."}` to the client.
2. Client surfaces failure reason in the toast — never assume success on 200.
3. Include the new epoch in the response so the client can validate.

**Warning signs:**
- Reset button "works" but map doesn't clear.
- No log line from slam_toolbox container after reset call.

**Phase to address:** Phase 3 (`/lidar` reset endpoint).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Mount docker.sock RW instead of RO in the logs sidecar | One fewer config line to get logs working | Full host compromise path; violates least-privilege | Never |
| Skip log-stream demuxing ("it looks mostly fine") | Saves ~50 LOC of PassThrough + header parsing | Garbled stderr at critical moments; operators miss errors | Never — demux is mandatory for non-TTY containers |
| Fuse SLAM pose directly into the existing single EKF with low covariance | One config change, yaw locks immediately | Filter divergence under motion; correlated-input bug is hard to diagnose | Never — use two-EKF pattern or differential mode |
| Store raw JSON OccupancyGrid array in localStorage | Trivial serialization code | Blow the quota in minutes; silent persistence failure | Prototype only; not for operator-facing build |
| `server.on('upgrade', ...)` twice — once per path | Cleanest looking code per-handler | Shadow the rosbridge handler; dashboard blackout | Never — single dispatcher is required |
| Reset endpoint that returns 200 without verification | 5 LOC simpler | Operator trust breaks the first time slam is down | Never for a feature called "honest reset" |
| Subtract `odom→base_link` instead of `map→base_link` for the map anchor | Works fine indoors on short runs | Grid jumps on GPS fix/loss; breaks the whole point of a map frame | Prototype only |
| No map epoch on persisted map | Skip one key in localStorage | Stale-map-after-reset UX confusion; silent data corruption | Never for persisted state |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| dockerode ↔ Docker daemon | Assume `logs()` returns plain text | Always `inspect()` first, demux if `Tty === false` |
| dockerode ↔ container lifecycle | Bind log stream to container ID and forget | Subscribe to `/events`, re-resolve name→ID on restart |
| robot_localization ↔ slam_toolbox | Treat slam pose as independent measurement alongside IMU | Use two-EKF pattern (map-EKF + odom-EKF) or `_differential: true` |
| slam_toolbox ↔ TF tree | Let two nodes publish `map→odom` | Exactly one owner; v2.2 = slam_toolbox; assert via `view_frames` |
| CycloneDDS shmem ↔ new container | Forget to include `x-ros-common` anchor (`ipc: host`, `pid: host`) | All new containers (logs-agent excepted — not a ROS node) inherit `<<: *ros-common` |
| rosbridge ↔ `/map` OccupancyGrid | Assume int8 array round-trips through NaN scrubber fine | CBOR + typed-array exemption already in place; do not break it by adding a new scrubber pass |
| localStorage ↔ SSR | Access `localStorage` during Next.js server render | Guard with `typeof window !== 'undefined'`; load persisted map in `useEffect` |
| `server.mjs` upgrade ↔ new WS routes | Register a second listener | Extend the existing path-dispatching handler |
| Docker `network_mode: host` ↔ sidecar | Assume sidecar can be on default bridge network | For consistency and rosbridge-style loopback routing, keep sidecar on `host` too |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Every log line triggers a React re-render | Log view lags, CPU pegs on container with chatty output | Buffer 50-100 ms of lines and batch-render; virtualized list (react-window) | >20 lines/sec |
| localStorage write on every `/map` update | Map publish at 1 Hz → 1 write/sec → main-thread jank | Debounce to ≥2 s; use `requestIdleCallback` | Any sustained mapping session |
| OccupancyGrid JSON.stringify on every render | Render stalls, `setItem` blocks | Memoize serialized form; only re-encode on data change | Grids >200×200 cells |
| Canvas redraw on every scan | GPU-bound, battery drain on mobile | `requestAnimationFrame` + dirty-rect; only redraw changed tiles | Scan rate >5 Hz |
| EKF runs at IMU rate (100 Hz) with SLAM at 5 Hz | EKF mostly predicts, rarely corrects; wasted CPU | Match EKF `frequency` to the slower useful source (~30 Hz) | Always — default configs are wrong for this hardware |
| Sidecar holds all log history in memory | Sidecar OOMs after hours with chatty slam logs | Ring buffer per container (last N lines, N≈2000); stream-only past that | After a few hours of operation |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| docker.sock mounted RW | Container escape → host root | `:ro` mount + method allowlist in sidecar |
| Sidecar exposed on LAN port | Anyone on WiFi can tail logs / crash containers | Bind to `127.0.0.1`, proxy through `server.mjs` |
| No auth on `/logs` WS | Anyone reaching `:3000` tails production logs | Inherit whatever auth model `/rosbridge` uses; if none (current state), document as trusted-LAN assumption and add to OOS |
| Log output includes secrets | NTRIP credentials, WiFi keys echoed to browser | Redact `ntrip.env` contents at sidecar level before forwarding; regex on `password=`, `token=`, etc. |
| Reset endpoint unauthenticated | Anyone on LAN can wipe the live map mid-mission | Same trusted-LAN caveat; at minimum require a POST (not GET) with CSRF-style origin check |
| `dockerode.exec` accidentally exposed | Remote shell on Pi | Allowlist `list`/`logs`/`inspect` only; reject all other dockerode methods at the proxy |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Log view auto-scrolls even when user scrolled up to read | User loses their place every new log line | Pause auto-scroll when scrollTop < scrollHeight - clientHeight; resume when user scrolls to bottom |
| No visual distinction between stdout and stderr | Operator misses errors in a flood of info logs | Color stderr red/amber; filter toggle |
| Map persistence hidden behind F5 surprise | Fresh-start expectation violated | Visible "persisted from <timestamp>" badge on load; Discard button |
| "Reset" button with no confirmation | Accidental click wipes the map | Modal with "Reset map — this cannot be undone" + 3s cooldown |
| Epoch changes silently | Operator doesn't know their view is on a new generation | Footer badge: "Map #N" — increments visibly on reset |
| Container restart resets scrollback | Debug context lost right when you need it | Sidecar buffers last N lines per container; replay on reconnect |
| SLAM yaw fusion makes map "look better" but actually drifts | Operator trusts visually-stable map more than raw pose | Show EKF yaw confidence indicator alongside; surface divergence vs IMU when it exceeds threshold |

## "Looks Done But Isn't" Checklist

- [ ] **Logs view:** Often missing stderr demuxing — verify by running a container that writes to stderr only (`sh -c 'echo foo 1>&2'`) and confirming the line shows up colored as stderr.
- [ ] **Logs view:** Often missing container-restart handling — verify by `docker compose restart slam` mid-stream and confirming reconnect + lifecycle banner.
- [ ] **Logs view:** Often missing auth/redaction — verify by grepping streamed output for `NTRIP_PASSWORD`, WiFi PSKs, any token from `.env`.
- [ ] **docker.sock:** Often mounted RW by accident — verify with `docker inspect logs-agent | jq '.[0].Mounts[] | select(.Source=="/var/run/docker.sock")'`.
- [ ] **SLAM→EKF fusion:** Often missing stationary-drift test — verify <1° yaw drift over 60 s at rest.
- [ ] **SLAM→EKF fusion:** Often missing TF cycle check — verify `ros2 run tf2_tools view_frames` shows exactly one publisher of `map→odom`.
- [ ] **SLAM→EKF fusion:** Often missing latency gate — verify `ros2 topic delay /slam_toolbox/pose` <100 ms.
- [ ] **Map anchor:** Often missing high-zoom shimmer test — verify stationary grid doesn't wobble at 10× zoom.
- [ ] **Map anchor:** Often missing far-from-origin test — verify rendering correctness with UTM-scale coordinates.
- [ ] **Map persistence:** Often missing quota-exceeded handling — verify with localStorage pre-filled to 4.5 MB.
- [ ] **Map persistence:** Often missing epoch validation — verify reload-after-reset discards stale map.
- [ ] **Honest reset:** Often missing verification — verify response is `{ok: false, ...}` when slam node is stopped before reset is called.
- [ ] **Honest reset:** Often missing client-side localStorage clear — verify reset + F5 shows fresh map, not persisted one.
- [ ] **server.mjs:** Often missing concurrent-path regression test — verify `/rosbridge` + `/logs` both stable under load for 60 s.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| docker.sock mount RW discovered post-deploy | LOW | Edit `docker-compose.yml`, add `:ro`, `docker compose up -d logs-agent` |
| Demux bug shipping garbled logs | LOW | Add demuxer, redeploy sidecar only; no data loss |
| EKF divergence after fusion enable | MEDIUM | `git revert` the EKF config change; restart nav container; re-design as two-EKF pattern before re-enabling |
| TF cycle breaks pose downstream | MEDIUM | Identify dual publisher via `view_frames`, disable the unintended one, restart |
| localStorage quota filled in the wild | LOW | Client-side: `localStorage.clear()` in DevTools; ship fix with debounce + encoding |
| Stale map resurrection post-reset | LOW | One-time: manually clear localStorage key; ship epoch mechanism |
| `server.mjs` upgrade handler regression kills dashboard | HIGH (production down) | Revert `server.mjs`, restart web container; fix in a branch with regression test before re-deploy |
| Canvas far-from-origin shimmer | LOW | Add local-origin rebase; map re-renders correctly next frame |
| Reset returns 200 on dead slam | LOW | Patch endpoint to verify liveness; ship |

## Pitfall-to-Phase Mapping

Phases below assume the active milestone structure will split into (roughly):
**Phase 1: Logs Infrastructure** (sidecar, dockerode, WS proxy, /logs UI)
**Phase 2: SLAM→EKF Yaw Fusion** (ekf config, two-EKF or differential pattern, TF hygiene)
**Phase 3: Map Anchor + Persistence + Honest Reset** (`<MapBitmap>` transform, localStorage + epoch, reset endpoint)

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. docker.sock RW exposure | Phase 1 | `docker inspect` shows RO; compose file lints for `:ro` suffix |
| 2. Log demux skipped | Phase 1 | Unit test on fixture + live stderr-only container test |
| 3. Container lifecycle drift | Phase 1 | Operator UAT: restart slam mid-stream; banner appears, reconnect happens |
| 4. SLAM+IMU correlated inputs | Phase 2 | 60 s stationary yaw drift <1°; 5 min driven-square heading error <5° |
| 5. TF cycle on `map→odom` | Phase 2 | `view_frames` shows exactly one publisher; rviz pose doesn't jitter |
| 6. Clock skew / latency | Phase 2 | `ros2 topic delay` <100 ms; `chronyc tracking` offset <10 ms |
| 7. localStorage quota | Phase 3 | Simulated-full-quota test shows graceful degradation + toast |
| 8. Stale-map resurrection | Phase 3 | Reset + F5 shows fresh grid; epoch badge increments |
| 9. server.mjs WS conflict | Phase 1 | Concurrent `/rosbridge` + `/logs` stable 60 s |
| 10. Wrong-frame map anchor | Phase 3 | Indoor straight-line UAT: grid stays geometrically aligned to walls |
| 11. Float precision drift | Phase 3 | Far-from-origin synthetic test |
| 12. Honest-reset silent failure | Phase 3 | Slam-stopped test returns `{ok: false}`; UI shows error |

### Cross-Phase Ordering Rationale

**Phase 2 (yaw fusion) should land before Phase 3 (`/lidar` map-anchor under motion).** Without trusted yaw, the `map→base_link` transform the map-anchor subtracts is wrong during motion, which would mask Pitfall 10 (wrong-frame subtraction): an operator testing the anchor would see drift and incorrectly blame the renderer. Phase 2 first → Phase 3 tests the renderer against a stable transform.

**Phase 1 (logs) is independent** and can run in parallel with 2 and 3. In fact, getting `/logs` up first is strategically valuable: debugging Phase 2 fusion divergence and Phase 3 reset failures is dramatically easier with a browser-accessible log view.

Recommended order: **Phase 1 → Phase 2 → Phase 3**, with Phase 1 and 2 potentially overlapping if implementation bandwidth allows.

## Sources

- `docker-compose.yml` + `.planning/codebase/ARCHITECTURE.md` + `.planning/codebase/CONCERNS.md` (existing stack constraints)
- `.planning/PROJECT.md` v2.2 active requirements and deferred v2.1 gaps
- Docker Engine API reference: `/containers/{id}/logs` multiplex framing (8-byte header), `/events` endpoint semantics
- dockerode README — `demuxStream()` pattern for non-TTY containers
- `robot_localization` documentation — two-EKF pattern (`ekf_filter_node_odom` + `ekf_filter_node_map`), `_differential` semantics, covariance tuning guidance (Tom Moore, OSR/Clearpath)
- slam_toolbox README — async vs sync mode, `transform_publish_period`, `map→odom` ownership
- ROS2 `tf2` documentation — single-publisher rule per transform; `view_frames` for cycle detection
- MDN localStorage quota notes (5-10 MB per origin, varies by browser; `QuotaExceededError` semantics)
- Docker security docs — "Giving non-root access" warning about `docker.sock` (specifically: sock mount = root-equivalent)
- Known MowerBot v2.1 load-bearing patterns: CycloneDDS shmem with `ipc:host`+`pid:host`, CBOR + typed-array exemption, NaN scrubber, `server.mjs` single-upgrade-handler pattern

---
*Pitfalls research for: MowerBot v2.2 Ops & Fusion Polish (logs-agent + SLAM yaw fusion + map-anchor/persistence/reset)*
*Researched: 2026-04-15*
