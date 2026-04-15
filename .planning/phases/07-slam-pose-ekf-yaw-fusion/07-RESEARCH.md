# Phase 7: SLAM Pose → EKF Yaw Fusion — Research

**Researched:** 2026-04-15
**Domain:** Sensor fusion (robot_localization EKF) + ROS2 topic plumbing + Next.js dashboard badge
**Confidence:** HIGH (config edits, topic plumbing, Zustand+badge patterns), MEDIUM (slam_toolbox covariance actual values on hardware), LOW (slam_toolbox Humble `/pose` topic name resolution at runtime — MUST verify live)

## Summary

This phase is 95% a config edit to `config/ekf.yaml` plus a small web badge reusing patterns already proven in the codebase (v2.1 Phase 3 GPS-fix badge, v2.1 Phase 4 map store). The interesting decisions are all about covariance: (a) what slam_toolbox actually puts in the `Covariance` field of `PoseWithCovarianceStamped`, and (b) how robot_localization consumes that covariance — because robot_localization does NOT have a per-sensor "hardcode the measurement variance" knob. The only supported overrides are source-side (`yaw_covariance_scale` in slam_toolbox) or rejection-only (`pose0_rejection_threshold`, Mahalanobis). This directly affects how D-05 ("conservative hardcoded ~0.05 rad² start") is implemented — it cannot literally be hardcoded inside `ekf.yaml`; it must be achieved via `yaw_covariance_scale` in `slam_toolbox_params.yaml`.

There is also a terminology correction: prior context and CONTEXT.md refer to the topic as `/slam_toolbox/pose`, but slam_toolbox publishes on topic name `pose` (resolves to `/pose` at the ROS graph level, not `/slam_toolbox/pose`). This must be verified with `ros2 topic list` on the target before any EKF wiring — if the plan names the wrong topic, EKF will silently subscribe to a non-existent topic and the phase looks like a fusion problem when it's actually a topic-name problem.

**Primary recommendation:** Edit `config/ekf.yaml` per the delta in §Code Examples, set `yaw_covariance_scale` in `config/slam_toolbox_params.yaml` to materialize D-05's target ~0.05 rad² yaw variance, verify topic name at runtime before finalizing `pose0:` value, and ship the badge as a direct clone of the existing GPS-fix badge pattern in `web/components/layout/header.tsx`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Single odom-frame EKF. No dual-EKF refactor.
- **D-02:** Yaw-only fusion of `/slam_toolbox/pose` — `pose0_config` has exactly one `true` (the yaw-position index); all other 15 indices are `false`.
- **D-03:** `imu0_config` yaw-position index is flipped from `true` to `false` in the **same commit** as adding `pose0`. No staged rollout.
- **D-04:** `slam_toolbox` remains the sole publisher of `map→odom`. EKF must not publish into the map frame.
- **D-05:** **Conservative start, then tune.** Hardcode `pose0` yaw variance at the loose end (starting point: ~0.05 rad² ≈ 13° std dev) via EKF's covariance-override mechanism. Do NOT trust whatever `/slam_toolbox/pose` publishes in its `Covariance` field unexamined — research agent must confirm what slam_toolbox actually publishes and whether it's meaningful; if it's near-zero (overconfident), the hardcoded override is load-bearing.
- **D-06:** Tuning loop per the drift test — document final value, rejected values, reasoning in `config/ekf.yaml`; that documentation satisfies FUSE-04.
- **D-07:** Do NOT use aggressive initial variance (~0.001 rad²).
- **D-08:** Keep `imu0_config` yaw_vel = true (roll_vel, pitch_vel too).
- **D-09:** Disabling `yaw_vel` would force yaw-rate from `/slam_toolbox/pose` finite-differencing — rejected.
- **D-10:** `config/ekf.yaml` comment block must state yaw-vel-retention rationale explicitly.
- **D-11:** 3-state badge in the dashboard header (green "SLAM active" / yellow "SLAM stale" / red "SLAM lost"), thresholds 500 ms / 2 s, covariance-trace second condition if meaningful.
- **D-12:** Location: dashboard header, visible on every page, consumed via a new Zustand `slam-pose-store.ts` matching `gps-store.ts` shape.
- **D-13:** Stale-SLAM → badge red only; no runtime config change, no supervisor, no auto-fallback.
- **D-14:** No supervisor/watchdog — deferred to future safety milestone.
- **D-15:** `scripts/yaw-drift-test.sh` — bash, 60 s stationary, single-line PASS/FAIL, <1°.
- **D-16:** Single outdoor trial, mower on the ground, motors off, LiDAR seeing features, SLAM running.
- **D-17:** Script output pasted into `07-VERIFICATION.md`; script committed at `scripts/yaw-drift-test.sh`.

### Claude's Discretion

- Exact initial numerical value of `pose0` yaw variance within the 0.02–0.1 rad² band
- Whether the badge covariance-trace threshold ships "wired up" or as a TODO (depends on what slam_toolbox actually publishes — this research determines → **SHIP WIRED UP**; see D-05 discussion)
- Zustand store shape for `/slam_toolbox/pose` subscription (`slam-pose-store.ts` — freshness timestamp, last-pose, connection state)
- Badge visual rendering (icon from `lucide-react`, color tokens) — match GPS badge aesthetic
- Whether the bash script uses `ros2 topic echo --field` or python quaternion→yaw snippet
- Structure of the FUSE-04 comment block in `ekf.yaml`

### Deferred Ideas (OUT OF SCOPE)

- Supervisor node for auto-fallback (future safety milestone)
- Dual-EKF refactor (revisit only on divergence)
- Numeric drift-rate readout in UI (°/min diagnostic on future "Health" page)
- Client-side yaw-drift plot over time
- Consume slam_toolbox pose covariance as-is (rejected at D-05)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FUSE-01 | EKF consumes `/slam_toolbox/pose` (actual topic: `/pose`) as yaw-only `pose0`; `imu0` yaw index disabled simultaneously | §Code Examples "ekf.yaml delta" — both changes in same commit per D-03 |
| FUSE-02 | 60-s stationary yaw drift `<1°` in `/odometry/filtered` | §Code Examples "yaw-drift-test.sh" — python `tf_transformations` quaternion→yaw |
| FUSE-03 | 3-state heading-confidence badge in dashboard header | §Code Examples "slam-pose-store.ts" + header badge insertion pattern |
| FUSE-04 | Chosen covariance + disabled-IMU rationale documented in `config/ekf.yaml` comments | §Architecture Patterns "FUSE-04 comment block" + §Pitfalls "pose covariance is source-side not EKF-side" |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **ROS2 Humble** fixed — no migration to Jazzy/Iron. Confirmed compatible with robot_localization Humble and slam_toolbox `humble-2.6.10`.
- **New ROS nodes live in Docker with `network_mode: host` + `ipc: host` + `pid: host`** — not relevant this phase (no new containers; only `nav` and `web` reconfigs).
- **Next.js 16 / React 19 App Router** — new store/component follow existing patterns; no routing additions.
- **CycloneDDS, rosbridge, NaN sanitization layer are load-bearing** — preserve. Adding a rosbridge subscription to `/pose` is the same pattern as existing `/fix`, `/imu`, `/odometry/filtered` subs.
- **ESP32 ↔ Pi UART at 115200 on `/dev/ttyAMA0`** — untouched.
- **Before using Edit/Write** start work through a GSD command — this research runs under `/gsd-plan-phase 7` orchestration, compliant.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Subscribe to `/pose`, compute Kalman update, publish `/odometry/filtered` + `odom→base_link` TF | ROS2 service layer (`nav` container, `ekf_filter_node`) | — | robot_localization owns sensor fusion; single-node change |
| Publish `/pose` with meaningful covariance | ROS2 service layer (`slam` container, `slam_toolbox`) | — | Source-side covariance tuning via `yaw_covariance_scale` is the only supported mechanism (see §Pitfalls) |
| Subscribe to `/pose` for badge freshness, publish store state | Frontend client (browser, `web` container) | Frontend server (`server.mjs` rosbridge proxy) | Browser has the Zustand store; `server.mjs` is just a WS tunnel |
| Render 3-state badge | Frontend client (`web/components/layout/header.tsx`) | — | Global header component, visible on every page |
| Drift measurement script | CLI/shell (`scripts/yaw-drift-test.sh`) — runs on Pi | ROS2 CLI tools (`ros2 topic echo`) | Operator-invoked from SSH, outputs to VERIFICATION.md |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `robot_localization` | humble (already deployed) | EKF sensor fusion node that will consume `/pose` as `pose0` | Canonical ROS2 sensor fusion; already producing `/odometry/filtered`; `pose0` accepts `PoseWithCovarianceStamped` natively [CITED: docs.ros.org/en/melodic/api/robot_localization/html/state_estimation_nodes.html] |
| `slam_toolbox` | `humble-2.6.10` (already deployed in `slam` container) | Publishes `/pose` (PoseWithCovarianceStamped, map→base_link scan-matched) with `yaw_covariance_scale` tunable | Already owns `map→odom` TF; publishing `/pose` is default, no flag to flip [VERIFIED: `github.com/SteveMacenski/slam_toolbox` topic table] |
| `roslib` (JS) | 2.1.0 (already in `web/package.json`) | Browser-side ROS topic subscription for the badge | Already used for every other topic sub |
| `zustand` | 4.5 (already deployed) | `slam-pose-store.ts` state container | Matches `gps-store.ts`, `imu-store.ts`, `map-store.ts` pattern — zero deviation |
| `lucide-react` | (already deployed) | Badge icon (likely `Compass` or `Navigation` for "yaw") | Matches GPS badge (`MapPin`), connection badge (`Wifi`) aesthetic |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tf_transformations` (python) | already inside `nav` container via ROS2 | Quaternion → yaw conversion in drift script | Use inside a `python3 -c '...'` one-liner called from bash |
| `jq` | present on Pi (verify) | Parse `ros2 topic echo --json --once` output in bash | Optional alternative to python; choose whichever is cleaner |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `yaw_covariance_scale` in `slam_toolbox_params.yaml` | Thin republisher node that rewrites covariance before `pose0` consumes it | Republisher is more flexible (can decouple from slam_toolbox) but adds a container and a failure mode for zero gain |
| `pose0_rejection_threshold` for outlier handling | No threshold (consume all pose messages unconditionally) | Rejection threshold is orthogonal to variance — keep at a sensible default (~3.0 Mahalanobis) to drop wild scan-match failures |
| Single-EKF yaw-only `pose0` (D-01) | Dual-EKF (odom-frame + map-frame) | Rejected upstream at D-01; correct long-term architecture but a larger refactor |

**Installation:** No new packages. This phase is pure config + code edits.

**Version verification:** Not required — no new dependencies introduced.

## Architecture Patterns

### System Architecture Diagram

```
  ┌─────────────┐                       ┌──────────────┐
  │   LD19       │  /scan (10 Hz)       │ slam_toolbox │
  │   LiDAR      │ ───────────────────► │  (slam cont.)│
  └─────────────┘                       └──────────────┘
                                              │
                                              │ publishes:
                                              │   /map (latched)
                                              │   /pose (scan rate ~10 Hz,
                                              │          PoseWithCovarianceStamped,
                                              │          yaw_covariance_scale applied)
                                              │   TF: map → odom
                                              │
                                              ▼
  ┌─────────────┐         /imu          ┌──────────────┐
  │  MPU6050    │ ─────────────────────►│              │
  │  IMU        │  (yaw_vel etc; NO yaw)│ ekf_filter_  │       /odometry/filtered
  └─────────────┘                       │ node         │ ─────────────────────────►
                                        │ (nav cont.)  │       TF: odom → base_link
  ┌─────────────┐  /fix (via nav-       │              │
  │  UM980 GNSS │  sat_transform →      │ pose0 = /pose│
  │             │  /odometry/gps)       │ (YAW ONLY)   │
  └─────────────┘ ─────────────────────►│              │
                                        └──────────────┘
                                              │
                                              │ /odometry/filtered (rosbridge CBOR)
                                              │ /pose (NEW rosbridge sub)
                                              ▼
                                        ┌──────────────┐
                                        │ server.mjs   │
                                        │ (NaN scrub)  │
                                        └──────────────┘
                                              │ WebSocket /rosbridge
                                              ▼
                                        ┌──────────────────────────────────┐
                                        │  Browser (Next.js 16)            │
                                        │  • slam-pose-store.ts (NEW)      │
                                        │     tracks lastUpdate, covYaw     │
                                        │  • Header badge (green/yellow/red)│
                                        │  • existing GPS badge (kept)     │
                                        └──────────────────────────────────┘
```

Data-flow rules:
- `slam_toolbox` is the sole owner of `map→odom`. EKF must not set `world_frame: map`. (Preserved: current `ekf.yaml` has `world_frame: odom`, line 14.)
- `/pose` is absolute yaw in the `map` frame. `pose0_differential: false` is correct.
- IMU `yaw_vel` remains an EKF input (D-08). Yaw-rate stays direct-gyro.

### Recommended Project Structure

No structural change. Files touched:

```
config/
├── ekf.yaml                          # MODIFY: add pose0 block, flip imu0 yaw index, FUSE-04 comment block
├── slam_toolbox_params.yaml          # MODIFY: add yaw_covariance_scale (materializes D-05)
└── mower_nav_launch.py               # UNCHANGED (verify no launch change needed; see §Pitfalls #7)

scripts/
└── yaw-drift-test.sh                 # NEW: 60 s stationary drift measurement, bash + python one-liner

web/
├── components/layout/header.tsx      # MODIFY: add 3-state yaw badge next to existing GPS badge
├── lib/ros/topics.ts                 # MODIFY: add POSE entry
├── lib/ros/subscribers.ts            # UNCHANGED (generic subscribe<T> already handles it)
├── lib/store/ros-store.ts            # MODIFY: wire setupSubscriptions() to call new updateSlamPose
└── lib/store/slam-pose-store.ts      # NEW: freshness, covariance trace, connection state

.planning/phases/07-slam-pose-ekf-yaw-fusion/
└── 07-VERIFICATION.md                # NEW: drift-script output pasted per D-17
```

### Pattern 1: yaw-only `pose0` selection vector
**What:** 15-element boolean array; index 5 (the 6th position = yaw) is true, everything else false.
**When to use:** The canonical robot_localization way to consume only a subset of a sensor's state dimensions.
**Example:**
```yaml
# Source: https://github.com/cra-ros-pkg/robot_localization/blob/ros2/params/ekf.yaml (CITED)
# State-vector order: [x, y, z, roll, pitch, yaw, vx, vy, vz, vroll, vpitch, vyaw, ax, ay, az]
pose0: /pose
pose0_config: [false, false, false,   # x, y, z — slam_toolbox would publish these, but we don't want them
               false, false, true,    # roll, pitch, YAW ← only this
               false, false, false,   # vx, vy, vz
               false, false, false,   # vroll, vpitch, vyaw
               false, false, false]   # ax, ay, az
pose0_differential: false              # absolute yaw in map frame, not incremental
pose0_relative: false                  # not relative to initial reading
pose0_queue_size: 5
pose0_rejection_threshold: 3.0         # Mahalanobis; drops wild scan-match outliers
pose0_nodelay: true                    # lowest-latency delivery
```

### Pattern 2: 3-state freshness badge via Zustand
**What:** Store a `lastUpdate: number` timestamp in the store; derive badge color from `Date.now() - lastUpdate` in the component render.
**When to use:** Any topic where "is it alive" is the primary UI signal.
**Example:** See `web/components/dashboard/connection-badge.tsx` — already uses `now - X.lastUpdate < 3000` pattern. Copy exactly, parameterize thresholds to 500/2000 ms per D-11.

### Pattern 3: FUSE-04 comment block style
Recommend ADR-style heredoc comment above `pose0:` block. Must record: (a) chosen yaw variance value, (b) rejected values and why, (c) why `imu0` yaw position is disabled but yaw_vel retained. See §Code Examples for full text.

### Anti-Patterns to Avoid
- **Don't set `pose0: /slam_toolbox/pose`.** The actual topic is `/pose`. Using the wrong name → EKF silently subscribes to nothing, filter degenerates to IMU+GPS and looks like a fusion failure. [VERIFIED: slam_toolbox github + ros2.docs.org Humble slam_toolbox page]
- **Don't try to hardcode `pose0` measurement covariance in `ekf.yaml`.** robot_localization has no such parameter. Use `yaw_covariance_scale` in slam_toolbox instead (§Pitfalls #1).
- **Don't flip only one of (add `pose0`, disable `imu0` yaw).** Correlated-input divergence is the exact trap FUSE-01 exists to prevent (D-03).
- **Don't set `pose0_differential: true`.** That treats pose messages as deltas; wrong for absolute map-frame yaw.
- **Don't change `world_frame` from `odom` to `map`.** That would make EKF publish `map→odom`, creating a duplicate publisher with slam_toolbox (ROADMAP SC#4 failure).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Overriding `pose0` measurement variance inside EKF | Patch robot_localization source | `yaw_covariance_scale` parameter in `slam_toolbox_params.yaml` | The supported mechanism; no source patch = no rebuild |
| Quaternion → yaw in the drift script | Custom atan2 math in pure bash | `python3 -c "from tf_transformations import euler_from_quaternion; ..."` | tf_transformations is pre-installed in the nav container; bash floating-point is painful |
| Badge freshness checks | Per-component `setInterval` | React 1 Hz tick inside the component (`useEffect` + `setInterval(..., 500)`) that just calls `forceUpdate`; store stays minimal | Already the pattern used elsewhere (GPS stale at 5 s in `gps-status.tsx`) |
| Supervisor to auto-fallback | Custom ROS2 node | Nothing (deferred per D-14) | Out of scope; future safety milestone |

**Key insight:** Every "where do I override X" instinct for this phase should first ask: "Does robot_localization or slam_toolbox already expose a parameter for this?" Both packages are mature and expose the knobs; the research load is in knowing which knob, not writing new code.

## Runtime State Inventory

> This is not a rename/refactor. State inventory is trivially empty.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no database/collection names change | None |
| Live service config | None — no external services have hardcoded references to yaw topic | None |
| OS-registered state | None — no systemd/launchd/pm2 registrations | None |
| Secrets/env vars | None — no env var references the EKF inputs | None |
| Build artifacts | None — config files are volume-mounted into containers at runtime | Container restart after `ekf.yaml` edit (§Pitfalls #2) |

## Common Pitfalls

### Pitfall 1: robot_localization does NOT let you hardcode the measurement covariance of an incoming sensor
**What goes wrong:** You see `process_noise_covariance` and `initial_estimate_covariance` in `ekf.yaml`, you assume there's a `pose0_covariance` or similar knob. There isn't. robot_localization reads the covariance field from the incoming `PoseWithCovarianceStamped` message and uses it directly in the Kalman update.
**Why it happens:** Other sensor-fusion packages (e.g., MRPT, some navstack estimators) do expose per-sensor measurement-covariance overrides. robot_localization explicitly doesn't — the philosophy is "fix it at the source." [CITED: docs.ros.org/en/melodic/api/robot_localization/html/state_estimation_nodes.html — only `*_rejection_threshold` exists, not `*_covariance`]
**How to avoid:** Materialize D-05's "conservative ~0.05 rad²" target by setting `yaw_covariance_scale` in `config/slam_toolbox_params.yaml`. If slam_toolbox's native yaw covariance is ~0.001 rad², `yaw_covariance_scale: 50.0` scales it to ~0.05 rad². If it's ~0.01, use `5.0`. **This requires runtime inspection first:**
```bash
ros2 topic echo /pose --field pose.covariance --once
```
Read element [35] (the yaw-yaw term in the 6×6 flattened covariance matrix → row 5, col 5 → index 5*6+5 = 35). Compute scale = target / measured. Document in `ekf.yaml` comment per FUSE-04.
**Warning signs:** EKF yaw tracks `/pose` with zero lag (covariance too low → EKF 100% trusts SLAM) or never corrects (covariance too high → EKF ignores SLAM). [ASSUMED: these are classical Kalman symptoms — if actual mower behavior differs, tuning band must widen beyond 0.02–0.1 rad²]

### Pitfall 2: EKF does not hot-reload `ekf.yaml`
**What goes wrong:** You edit `config/ekf.yaml`, expect the running `ekf_filter_node` to pick it up. It doesn't — ROS2 params are read once at node launch.
**Why it happens:** `ros2 param` can dynamically update some parameters, but robot_localization's sensor-topic configuration is `DeclareParameter` at startup; changing `pose0` or `pose0_config` after launch is ignored (or causes undefined behavior).
**How to avoid:** After editing `ekf.yaml`, `docker compose restart nav`. Script output should include this step explicitly. The `nav` container restart is fast (~5 s) and doesn't affect slam, lidar, or web.
**Warning signs:** Drift script shows no improvement after edit + no container restart.

### Pitfall 3: Topic name is `/pose`, not `/slam_toolbox/pose`
**What goes wrong:** CONTEXT.md, STATE.md, and ROADMAP all say `/slam_toolbox/pose`. slam_toolbox actually publishes on the node-relative topic `pose`, which resolves to `/pose` absent a node namespace. Our slam container launches `slam_toolbox online_async_launch.py` with no namespace → topic is `/pose`.
**Why it happens:** Informal shorthand — people say "slam_toolbox's pose topic" and shorten to `/slam_toolbox/pose`. It reads natural but is wrong at the ROS graph.
**How to avoid:** Before touching `ekf.yaml`, run on the Pi:
```bash
docker exec mower-nav ros2 topic list | grep -i pose
docker exec mower-nav ros2 topic info /pose
```
Confirm `/pose` is present with type `geometry_msgs/msg/PoseWithCovarianceStamped`. Use whatever name is actually in the graph. **If it turns out to be `/slam_toolbox/pose` in our deployment** (some launch configurations do namespace it), use that instead — the config just needs to match reality.
**Warning signs:** `ros2 topic info /pose` errors with "no such topic"; or `ekf_filter_node` logs "waiting for /pose" indefinitely.

### Pitfall 4: slam_toolbox covariance may be near-identity, giving EKF false confidence
**What goes wrong:** [CITED: SteveMacenski/slam_toolbox] scan-match covariance is computed, but in feature-starved environments (bare wall, long corridor) scan-matching can return a locally-optimal fit with artificially low covariance. EKF sees low variance → fully trusts the yaw → locks onto a biased estimate.
**Why it happens:** Scan-match covariance reflects fit quality, not ground truth. The mower's first deploy is a back garden — feature-starved is plausible.
**How to avoid:** This is exactly why D-05 says "conservative start": set `yaw_covariance_scale` high (e.g. 10–50) so even a 0.001 rad² native value lands at 0.01–0.05 rad². Tune down only after the drift test passes and yaw tracking feels responsive under motion.
**Warning signs:** Stationary drift is <1° but yaw ratchets in small discrete steps (SLAM correcting a biased estimate each scan).

### Pitfall 5: Clock skew / timestamp mismatch between slam_toolbox and EKF
**What goes wrong:** slam_toolbox stamps `/pose` with scan acquisition time (~30–100 ms old). EKF may reject messages older than its last state.
**Why it happens:** Already documented in `.planning/research/PITFALLS.md` §Pitfall 6.
**How to avoid:** Ensure `use_sim_time: false` in both `slam_toolbox_params.yaml` (already set via launch arg) and `ekf.yaml` (not set → defaults to false). Measure once: `ros2 topic delay /pose` should be <100 ms. Verify `transform_timeout: 1.0` in slam_toolbox (already configured — line 37 of `slam_toolbox_params.yaml`) gives EKF enough slack.
**Warning signs:** `ros2 topic hz /pose` shows ~10 Hz but `/odometry/filtered` yaw doesn't track it.

### Pitfall 6: rosbridge type string for PoseWithCovarianceStamped
**What goes wrong:** TypeScript type entry in `topics.ts` uses wrong string, roslib silently fails to subscribe.
**How to avoid:** Use `"geometry_msgs/PoseWithCovarianceStamped"` (slash-separated, single-slash form — that's what rosbridge v2 expects for every other topic in `topics.ts`).

### Pitfall 7: navsat_transform startup order
**What goes wrong:** `navsat_transform_node` in the same launch file consumes `/imu` for initial heading. It expects yaw from IMU to exist. With imu0 yaw-position disabled at the EKF, is navsat_transform still OK?
**Answer:** Yes — navsat_transform subscribes directly to `/imu` (raw topic), not to the EKF output. It reads yaw from the MPU6050 `Imu` message's orientation quaternion. That upstream source is unchanged. EKF's imu0 yaw-position flip is orthogonal to navsat_transform's input path. **No launch-file change needed.** [VERIFIED: `config/mower_nav_launch.py` lines 28–31 — navsat remaps `imu` → `/imu`, independent of EKF.]

## Code Examples

### `config/ekf.yaml` delta (final shape)

```yaml
# ═══════════════════════════════════════════════════════════════════════════
# Phase 7 (v2.2 Ops & Fusion Polish) — SLAM Pose → EKF Yaw Fusion
# FUSE-04 documentation block. Planner: keep this comment on the committed file.
#
# WHY /pose IS NOW A pose0 INPUT:
#   IMU-only yaw (MPU6050 integrated) drifts unboundedly at rest. slam_toolbox's
#   scan-matched pose is absolute in the map frame — using it as an EKF yaw input
#   (yaw-only, pose0_config[5] = true) kills drift without introducing a second
#   map→odom TF publisher (slam_toolbox still owns map→odom; EKF still owns
#   odom→base_link). See STATE.md D-02..D-04.
#
# WHY imu0 yaw-POSITION INDEX IS FALSE BUT yaw_vel INDEX IS STILL TRUE:
#   The correlated-input divergence trap that motivated FUSE-01 is about two
#   sources of absolute yaw — IMU integrated yaw + SLAM scan-matched yaw. Those
#   are not independent measurements; fusing both biases the filter. Angular
#   velocity (yaw_vel) is a direct gyro measurement, NOT pose-derived; it is
#   independent of /pose. Keeping yaw_vel=true is load-bearing — without it,
#   yaw-rate estimation would have to come from finite-differencing /pose at
#   ~10 Hz, which is noisier and slower than a 30 Hz direct gyro. D-08..D-10.
#
# WHY pose0 YAW VARIANCE IS "LARGE":
#   slam_toolbox publishes scan-match covariance in PoseWithCovarianceStamped.
#   In feature-starved environments (back garden, long corridor) that covariance
#   can be artificially low even when the match is biased. Conservative start:
#   we scale slam_toolbox's native yaw covariance via its yaw_covariance_scale
#   parameter (in config/slam_toolbox_params.yaml) to land at approximately
#   0.05 rad² (~13° 1-sigma). See D-05..D-07. After the 60 s stationary test:
#     - if Δyaw < 1° with margin → ship as-is
#     - if Δyaw > 1° → tighten (smaller variance = more SLAM trust) + retest
#     - if yaw sluggish under motion → tighten or loosen IMU yaw_vel process noise
#   The FINAL chosen scale and the rejected values go below this block.
#
#   Chosen:   yaw_covariance_scale = <TBD after test> in slam_toolbox_params.yaml
#   Rejected: <TBD>   Reason: <TBD>
#   Rejected: <TBD>   Reason: <TBD>
#
# HARD CONSTRAINTS (do not change without reopening D-01..D-04):
#   - pose0_config has exactly ONE true (yaw). ALL other indices false.
#   - imu0_config yaw-POSITION (index 5) stays false.
#   - imu0_config yaw_vel (index 11) stays true.
#   - world_frame stays odom. EKF must not publish map→odom.
# ═══════════════════════════════════════════════════════════════════════════

ekf_filter_node:
  ros__parameters:
    frequency: 30.0
    sensor_timeout: 0.1
    two_d_mode: true
    publish_tf: true
    publish_acceleration: true
    map_frame: map
    odom_frame: odom
    base_link_frame: base_link
    world_frame: odom                  # MUST stay odom — slam_toolbox owns map→odom

    # IMU (MPU-6050, Topic: /imu) — roll/pitch/yaw POSITION now all false per FUSE-01
    imu0: /imu
    imu0_config: [false, false, false,    # x, y, z position — never from IMU
                  false, false, false,    # roll, pitch, YAW — YAW WAS true IN v2.1, NOW false (FUSE-01)
                  false, false, false,    # vx, vy, vz
                  true,  true,  true,     # roll_vel, pitch_vel, yaw_vel — retained per D-08
                  false, false, false]    # ax, ay, az — drift without encoders
    imu0_differential: false
    imu0_relative: false
    imu0_remove_gravitational_acceleration: true
    imu0_queue_size: 10

    # NEW: slam_toolbox scan-matched pose — YAW-ONLY — Phase 7 FUSE-01
    # Topic name verified at runtime: `ros2 topic info /pose` before commit.
    pose0: /pose
    pose0_config: [false, false, false,   # x, y, z — NO (slam x/y is out of scope; would create TF cycle)
                   false, false, true,    # roll, pitch, YAW ← ONLY THIS
                   false, false, false,   # vx, vy, vz
                   false, false, false,   # vroll, vpitch, vyaw
                   false, false, false]   # ax, ay, az
    pose0_differential: false
    pose0_relative: false
    pose0_queue_size: 5
    pose0_rejection_threshold: 3.0        # Mahalanobis — drops wild scan-match outliers
    pose0_nodelay: true

    # (odom0 block remains commented — blocked on firmware /odom publisher, HW-04)

    process_noise_covariance: [ … unchanged … ]
```

### `config/slam_toolbox_params.yaml` addendum

```yaml
slam_toolbox:
  ros__parameters:
    # … existing params unchanged …

    # Phase 7 FUSE-04 — scale scan-match yaw covariance upward before publishing on /pose.
    # EKF consumes this covariance directly (robot_localization has no per-sensor
    # measurement-variance override). Conservative start; tune per 07-VERIFICATION.md.
    yaw_covariance_scale: 10.0            # starting value — adjust after stationary drift test
    # position_covariance_scale left at default (1.0); x/y not fused by EKF this milestone.
```

### `scripts/yaw-drift-test.sh`

```bash
#!/usr/bin/env bash
# Phase 7 FUSE-02 — 60-second stationary yaw-drift measurement.
# Captures starting yaw, sleeps, captures ending yaw, reports Δ — PASS if <1°.
# Run from Pi host: `./scripts/yaw-drift-test.sh`
set -euo pipefail

TOPIC=/odometry/filtered
DURATION=${1:-60}

# Fail fast if EKF isn't publishing.
if ! docker exec mower-nav ros2 topic list 2>/dev/null | grep -q "^${TOPIC}$"; then
  echo "FAIL: ${TOPIC} not present — is mower-nav running?"
  exit 1
fi

# Read-quaternion → yaw helper (uses tf_transformations inside the nav container).
read_yaw() {
  docker exec mower-nav bash -c "
    source /opt/ros/humble/setup.bash &&
    ros2 topic echo --once --field pose.pose.orientation ${TOPIC} 2>/dev/null |
    python3 -c '
import sys, yaml
from tf_transformations import euler_from_quaternion
q = yaml.safe_load(sys.stdin)
_, _, yaw = euler_from_quaternion([q[\"x\"], q[\"y\"], q[\"z\"], q[\"w\"]])
print(yaw)
'"
}

echo "Capturing starting yaw on ${TOPIC}…"
YAW_START=$(read_yaw)
echo "  start yaw: ${YAW_START} rad"
echo "Sleeping ${DURATION}s (keep the mower absolutely still)…"
sleep "$DURATION"
YAW_END=$(read_yaw)
echo "  end yaw:   ${YAW_END} rad"

# Δ in degrees, unwrapped across ±π.
DELTA_DEG=$(python3 -c "
import math
a = float('${YAW_START}'); b = float('${YAW_END}')
d = b - a
while d > math.pi:  d -= 2*math.pi
while d < -math.pi: d += 2*math.pi
print(f'{abs(math.degrees(d)):.3f}')
")

THRESH=1.000
if python3 -c "import sys; sys.exit(0 if float('${DELTA_DEG}') < ${THRESH} else 1)"; then
  echo "PASS — Δyaw = ${DELTA_DEG}° over ${DURATION}s (< ${THRESH}°)"
  exit 0
else
  echo "FAIL — Δyaw = ${DELTA_DEG}° over ${DURATION}s (≥ ${THRESH}°)"
  exit 2
fi
```

### `web/lib/ros/topics.ts` addition

```ts
// Source: web/lib/ros/topics.ts (existing pattern)
POSE: {
  name: "/pose",  // VERIFY with `ros2 topic list` before merge; CONTEXT.md's /slam_toolbox/pose is incorrect
  messageType: "geometry_msgs/PoseWithCovarianceStamped",
  compression: "cbor",
  throttleMs: 200,  // ~5 Hz UI update; source publishes at scan rate ~10 Hz
},
```

### `web/lib/store/slam-pose-store.ts` (NEW)

```ts
// Source: mirrors web/lib/store/gps-store.ts + web/lib/store/odometry-store.ts
"use client";

import { create } from "zustand";

// Covariance trace threshold for "healthy" — derived after runtime inspection per D-05.
// Start with a forgiving value; tighten once we know what slam_toolbox actually publishes.
const HEALTHY_COV_TRACE_MAX = 0.2;  // rad² — sum of roll/pitch/yaw variances

interface SlamPoseMsg {
  header: { stamp: { sec: number; nanosec: number } };
  pose: {
    pose: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
    covariance: number[];  // length 36; row-major 6×6
  };
}

interface SlamPoseState {
  x: number;
  y: number;
  yaw: number;                 // radians, from quaternion
  covYaw: number;              // covariance[35] (yaw-yaw term)
  covTrace: number;            // roll+pitch+yaw variance sum (diag 21+28+35)
  lastUpdate: number;          // Date.now() timestamp
  hasEverReceived: boolean;

  updatePose: (msg: SlamPoseMsg) => void;
}

function quaternionYaw(q: { x: number; y: number; z: number; w: number }): number {
  // z-axis rotation from quaternion (yaw in XY plane).
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export const useSlamPoseStore = create<SlamPoseState>((set) => ({
  x: 0,
  y: 0,
  yaw: 0,
  covYaw: -1,
  covTrace: -1,
  lastUpdate: 0,
  hasEverReceived: false,

  updatePose: (msg: SlamPoseMsg) => {
    const cov = msg.pose.covariance ?? [];
    set({
      x: msg.pose.pose.position.x,
      y: msg.pose.pose.position.y,
      yaw: quaternionYaw(msg.pose.pose.orientation),
      covYaw: cov[35] ?? -1,
      covTrace: (cov[21] ?? 0) + (cov[28] ?? 0) + (cov[35] ?? 0),
      lastUpdate: Date.now(),
      hasEverReceived: true,
    });
  },
}));

export { HEALTHY_COV_TRACE_MAX };
```

### Header badge insertion (additive to `web/components/layout/header.tsx`)

```tsx
// Source: web/components/layout/header.tsx — mirrors existing GPS-fix badge
import { useSlamPoseStore, HEALTHY_COV_TRACE_MAX } from "@/lib/store/slam-pose-store";
import { Compass } from "lucide-react";

// Inside Header(), next to the existing GPS badge:
function YawBadge() {
  const { lastUpdate, hasEverReceived, covTrace } = useSlamPoseStore();
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const age = now - lastUpdate;

  let state: "green" | "yellow" | "red";
  let label: string;
  if (!hasEverReceived || age > 2000) {
    state = "red"; label = "SLAM lost";
  } else if (age > 500 || (covTrace > 0 && covTrace > HEALTHY_COV_TRACE_MAX)) {
    state = "yellow"; label = "SLAM stale";
  } else {
    state = "green"; label = "SLAM active";
  }

  const variant = { green: "success", yellow: "warning", red: "error" }[state] as const;
  return (
    <Badge variant={variant} className="flex items-center gap-1">
      <Compass className="h-3 w-3" />
      Yaw · {label}
    </Badge>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| IMU-only yaw fused into odom-frame EKF | SLAM scan-matched `/pose` yaw fused as `pose0` (yaw-only), IMU yaw-position disabled | v2.2 Phase 7 | Yaw stops drifting at rest; map-anchor work in Phase 8 becomes testable |
| Hardcoded sensor covariance in source code (pre-ROS2 packages) | Source-side covariance tuning via sensor driver params (`yaw_covariance_scale`) | ROS2 convention | robot_localization stays generic; each sensor owns its covariance story |

**Deprecated/outdated:**
- Attempting to override `pose0` measurement covariance inside `ekf.yaml` — no such parameter exists in robot_localization Humble. [CITED: docs.ros.org state_estimation_nodes]
- Subscribing EKF to SLAM x/y — rejected at REQUIREMENTS Out-of-Scope (TF cycle).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | slam_toolbox publishes `/pose` (absolute, not `/slam_toolbox/pose`) in our specific launch configuration | §Pitfalls #3, §Code Examples `pose0: /pose` | Planner must insert a "verify topic name" step into Wave 0 that runs `ros2 topic list \| grep -i pose` on the Pi; if the deployed topic name differs, use the actual name. Non-destructive but must be checked before merge. |
| A2 | slam_toolbox's published `/pose` covariance is generally low (~0.001–0.01 rad² yaw) for feature-rich environments but can be artificially low in feature-starved ones | §Pitfalls #4 | Drives D-05's "conservative start" — if covariance is actually already 0.1 rad² natively, `yaw_covariance_scale: 1.0` is already fine and 10.0 would be too loose. Runtime echo before committing the scale value handles this. |
| A3 | `tf_transformations` is installed in the nav container | §Code Examples drift script | If missing, script fails at first invocation. Alternative: inline atan2 formula (already in `slam-pose-store.ts`). Fallback documented. |
| A4 | `navsat_transform_node` doesn't need reconfiguration when imu0 yaw-position flips false in EKF | §Pitfalls #7 | navsat reads `/imu` directly, not EKF output → safe. Only risk: if a future refactor remaps `imu` inside navsat, heading-lock behavior may change. Non-issue for Phase 7 as written. |
| A5 | Stationary drift <1°/60s is achievable at all with ~0.05 rad² starting variance in our back-garden LiDAR conditions | §Pitfalls #4, D-05 | If scan-matching is too noisy to get below 1° regardless, D-06's tuning loop has an escape hatch (tighten variance); if still impossible, it's a feature-density problem, not a fusion problem, and escalates out of phase scope. |

## Open Questions

1. **Actual `/pose` covariance values on our deployment**
   - What we know: slam_toolbox publishes a covariance matrix; scale parameter exists
   - What's unclear: the native numerical values on our Pi 4 + LD19 + back garden
   - Recommendation: Planner inserts "Wave 0: runtime inspection" task — `docker exec mower-nav ros2 topic echo /pose --field pose.covariance --once`, record result in 07-VERIFICATION.md, then set `yaw_covariance_scale` to hit 0.05 rad² target

2. **Confirm `/pose` topic name on live deployment**
   - What we know: slam_toolbox docs say `pose` unnamespaced; STACK.md independently says `/pose`; CONTEXT.md says `/slam_toolbox/pose`
   - What's unclear: whether our specific launch command adds any namespace
   - Recommendation: Planner adds a mandatory "verify topic name" step before the `ekf.yaml` edit — trivial to resolve, catastrophic if skipped

3. **Covariance trace threshold for badge yellow state**
   - What we know: D-11 says yellow if covariance degraded
   - What's unclear: numerical threshold until we see actual values
   - Recommendation: Ship `HEALTHY_COV_TRACE_MAX = 0.2` as placeholder; tune in VERIFICATION.md section with real data; document the chosen value in `slam-pose-store.ts` comment

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Running `mower-slam` container publishing `/pose` | `pose0` subscription, drift test, badge | ✓ (from v2.1 Phase 4) | slam_toolbox `humble-2.6.10` | None — phase is blocked without it; verify pre-flight with `docker ps` |
| Running `mower-nav` container with robot_localization | EKF consumption of `pose0` | ✓ | robot_localization Humble | None |
| Running `mower-rosbridge` container | Browser `/pose` subscription | ✓ | rosbridge_server Humble | None |
| `tf_transformations` python package in nav container | Drift script quaternion math | ✓ (verify with `docker exec mower-nav python3 -c "import tf_transformations"`) | — | Inline atan2 math (already in slam-pose-store.ts) |
| `docker compose restart nav` capability | Apply ekf.yaml edits | ✓ (user has SSH access per MEMORY.md, 10.10.40.23) | — | None |
| Physical outdoor access to mower | D-16 single outdoor trial | ✓ (user has hands-on hardware per MEMORY.md) | — | None — fundamental requirement |

**Missing dependencies with no fallback:** None blocking — all required runtime pieces shipped in v2.1.

**Missing dependencies with fallback:** `tf_transformations` — fallback documented in A3.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None existing (per `.planning/codebase/TESTING.md`) — validation is hardware-in-the-loop + bash script + runtime ROS topic inspection |
| Config file | None — direct shell commands |
| Quick run command | `./scripts/yaw-drift-test.sh 10` (10-s smoke) |
| Full suite command | `./scripts/yaw-drift-test.sh 60` (full D-15 criterion) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FUSE-01 | `pose0` live, `imu0` yaw-position false | integration (runtime ROS topic check) | `docker exec mower-nav ros2 param get /ekf_filter_node pose0` (returns `/pose`); `ros2 topic info /odometry/filtered` responsive | ❌ Wave 0 (ekf.yaml edit) |
| FUSE-01 | Exactly one map→odom publisher | integration | `docker exec mower-nav ros2 run tf2_ros tf2_echo map odom` → source is slam_toolbox; `ros2 topic info /tf \| grep Publisher` lists slam only | — |
| FUSE-02 | Δyaw < 1° / 60s stationary | smoke (scripted, hardware-in-loop) | `./scripts/yaw-drift-test.sh 60` — exit 0 = PASS | ❌ Wave 0 (script does not exist yet) |
| FUSE-03 | 3-state badge reflects SLAM state | manual-only (browser UX) | Load `/`, verify badge color reacts to `docker stop mower-slam` (red within 2 s) and `docker start mower-slam` (green within ~3 s) | — |
| FUSE-04 | ekf.yaml comments present and load-bearing | static (grep) | `grep -q "WHY pose0 YAW VARIANCE" config/ekf.yaml && grep -q "Chosen:" config/ekf.yaml` | — |

### Sampling Rate
- **Per task commit:** `./scripts/yaw-drift-test.sh 10` — fast sanity (10 s) that EKF still publishes sane yaw after each edit
- **Per wave merge:** `./scripts/yaw-drift-test.sh 60` + browser badge check + `ros2 run tf2_ros tf2_echo map odom` sanity
- **Phase gate:** Full 60-s test passes with margin (<0.5° preferred); badge transitions observed for all 3 states; FUSE-04 grep confirms comment block landed

### Wave 0 Gaps
- [ ] `scripts/yaw-drift-test.sh` — creates FUSE-02's scripted validator (does not exist today)
- [ ] Runtime-check sub-task: `docker exec mower-nav ros2 topic echo /pose --field pose.covariance --once` — run BEFORE editing `ekf.yaml`/`slam_toolbox_params.yaml`; result recorded in VERIFICATION.md and determines numerical `yaw_covariance_scale` value
- [ ] Runtime-check sub-task: `ros2 topic list | grep pose` to confirm topic name before `pose0:` value lands in `ekf.yaml`

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (trusted LAN, v2.1 baseline) |
| V3 Session Management | no | — |
| V4 Access Control | no | — (no new API endpoints, no new write paths) |
| V5 Input Validation | yes | Message shape validated implicitly by roslib/rosbridge; store update skips absent covariance indices safely |
| V6 Cryptography | no | — |

### Known Threat Patterns for {stack}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed `/pose` message (NaN in orientation or covariance) | Tampering / DoS | NaN scrubber in `subscribers.ts` already handles NaN → null at roslib level (text frames + CBOR path per v2.1 Phase 3) |
| Operator misreads "SLAM lost" as working | Repudiation / UX | Badge red is a dedicated, loud signal; no false-negative path |
| EKF subscribed to wrong topic → yaw silently drifting | (correctness, not security) | Planner-mandated `ros2 topic info` verification before merge |

**No new attack surface in this phase.** Phase 7 adds no new API routes, no new writable endpoints, no new ports, no new external integrations. The only data-plane addition is a rosbridge subscription to an already-running ROS topic on the trusted LAN.

## Sources

### Primary (HIGH confidence)
- `.planning/research/ARCHITECTURE.md` lines 100–170 — v2.2 milestone research already investigated this exact fusion (project-verified)
- `.planning/research/STACK.md` lines 80–100 — `/pose` topic name, covariance scale params, version compatibility
- `.planning/research/PITFALLS.md` §Pitfall 6 — clock skew / timestamp mismatch already documented
- [slam_toolbox Humble docs topic table](https://docs.ros.org/en/humble/p/slam_toolbox/) — topic `pose` (unnamespaced) — `PoseWithCovarianceStamped` — `yaw_covariance_scale` / `position_covariance_scale` params
- [SteveMacenski/slam_toolbox GitHub README](https://github.com/SteveMacenski/slam_toolbox) — pose publisher covariance semantics
- `config/ekf.yaml`, `config/slam_toolbox_params.yaml`, `config/mower_nav_launch.py`, `web/components/layout/header.tsx`, `web/lib/store/gps-store.ts`, `web/lib/ros/topics.ts`, `web/lib/store/ros-store.ts`, `docker-compose.yml` — in-repo canonical patterns

### Secondary (MEDIUM confidence)
- [robot_localization state_estimation_nodes docs (Melodic — API unchanged through Humble)](https://docs.ros.org/en/melodic/api/robot_localization/html/state_estimation_nodes.html) — `poseN_rejection_threshold` only; no covariance-override parameter
- [cra-ros-pkg/robot_localization ekf.yaml example](https://github.com/cra-ros-pkg/robot_localization/blob/ros2/params/ekf.yaml) — 15-element config array order canonical

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Exact `/pose` covariance values on our specific deployment — assumed, runtime-verify in Wave 0

## Metadata

**Confidence breakdown:**
- Standard stack & file touch list: HIGH — every library already in the repo; every pattern already shipped in v2.1
- `pose0` + `imu0` yaml delta: HIGH — directly from robot_localization docs + in-project research from v2.2 research phase
- slam_toolbox `/pose` topic name: MEDIUM — docs say unnamespaced but deployments vary; one `ros2 topic list` check in Wave 0 closes this
- `yaw_covariance_scale` as the correct D-05 mechanism: HIGH — confirmed by crossing robot_localization docs (no override parameter) with slam_toolbox docs (parameter exists and does this exact thing)
- Badge Zustand pattern: HIGH — direct clone of `gps-store.ts` + `connection-badge.tsx`
- Drift script design: MEDIUM — bash + python one-liner is standard; only uncertainty is `tf_transformations` availability inside the container (A3)

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days; stack and versions are stable — Humble EOL is May 2027, slam_toolbox release cadence is slow)

## RESEARCH COMPLETE

**Phase:** 7 — SLAM Pose → EKF Yaw Fusion
**Confidence:** HIGH for config edits and UI plumbing; MEDIUM for two runtime values (actual `/pose` covariance magnitude, final `yaw_covariance_scale`) that resolve to planner Wave 0 tasks, not blockers.

### Key Findings

- **The single most important correction:** robot_localization does **not** expose a per-sensor measurement-covariance override. D-05's "hardcode pose0 yaw variance at ~0.05 rad²" must be implemented via `yaw_covariance_scale` in `config/slam_toolbox_params.yaml`, not in `config/ekf.yaml`. Planner must add this file to the edit set.
- **Topic name correction:** slam_toolbox publishes on topic `pose` (absolute `/pose`), not `/slam_toolbox/pose` as CONTEXT.md states. Planner must insert a Wave 0 runtime check (`ros2 topic list | grep pose`) before `ekf.yaml` edit to lock in the correct name.
- **Container restart required:** `ekf_filter_node` doesn't hot-reload params — `docker compose restart nav` is part of the edit flow, not optional.
- **No launch-file change needed:** navsat_transform reads `/imu` directly, independent of EKF's imu0 yaw-position flip. `config/mower_nav_launch.py` is untouched.
- **Badge pattern is a direct clone:** `web/components/layout/header.tsx` already has the GPS-fix badge alongside the connection button — insert a second badge right next to it, backed by a new Zustand store cloning `gps-store.ts` shape with just `lastUpdate` + `covTrace` + `covYaw` fields.

### File Created
`.planning/phases/07-slam-pose-ekf-yaw-fusion/07-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Every library already deployed; no new deps |
| Architecture | HIGH | Single-EKF + source-side covariance scaling is canonical per docs |
| Pitfalls | HIGH | 7 named pitfalls, cross-verified with prior in-repo research |
| Runtime values (cov, topic name) | MEDIUM | Require live inspection — planner Wave 0 tasks |

### Open Questions
- Actual `/pose` covariance magnitude on our deployment → resolves at Wave 0 runtime inspection
- Exact `yaw_covariance_scale` numerical value → resolves after drift test iteration
- Exact covariance-trace threshold for badge yellow state → resolves after first live run

### Ready for Planning
Planner can now create PLAN.md files. Recommended wave structure: **Wave 0** runtime inspection (topic name, native covariance) + script scaffold → **Wave 1** `ekf.yaml` + `slam_toolbox_params.yaml` edits + container restart + drift test → **Wave 2** web badge (`topics.ts` + `slam-pose-store.ts` + `header.tsx` + `ros-store.ts` wiring) + VERIFICATION.md.
