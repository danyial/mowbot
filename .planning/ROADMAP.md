# Roadmap: MowerBot

## Milestones

- ✅ **v2.1 LD19 LiDAR Integration** — Phases 0–4 (shipped 2026-04-15) — see [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md)
- 🚧 **v2.2 Ops & Fusion Polish** — Phases 6–8 (in progress)

## Phases

<details>
<summary>✅ v2.1 LD19 LiDAR Integration (Phases 0–4) — SHIPPED 2026-04-15</summary>

- [x] Phase 0: GSD Brownfield Adoption (1/1 plans) — completed 2026-04-14
- [x] Phase 1: Hardware & UART Routing (1/1 plans) — completed 2026-04-14 (HW-04/HW-05 deferred)
- [x] Phase 2: LiDAR Driver & `/scan` Publication (1/1 plans) — completed 2026-04-14
- [x] Phase 3: Web Visualization — `/scan` on the Map Page (2/2 plans) — completed 2026-04-14 (Core Value gate reached; 4 human walkthroughs deferred)
- [x] Phase 4: Live Mapping with slam_toolbox (2/2 plans) — completed 2026-04-14 (5 human walkthroughs deferred)

Full details: [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md)
Audit: [milestones/v2.1-MILESTONE-AUDIT.md](milestones/v2.1-MILESTONE-AUDIT.md)

</details>

### 🚧 v2.2 Ops & Fusion Polish

Three phases, strictly ordered by data dependency. Phase 6 (logs) ships first as a debugging force-multiplier for Phases 7 and 8. Phase 7 (yaw fusion) must land before Phase 8 so the `/lidar` map-anchor can be validated against a trusted `map→base_link` under motion.

- [ ] **Phase 6: WebUI Container-Logs View** — Operator can live-tail any container's logs from the browser, filtered by time window
- [ ] **Phase 7: SLAM Pose → EKF Yaw Fusion** — EKF consumes `/slam_toolbox/pose` as yaw-only input; stationary yaw drift <1° / 60 s
- [ ] **Phase 8: `/lidar` Map-Anchor + Persistence + Honest Reset** — Occupancy grid anchored in map frame, persists across reloads, Eraser honestly resets both server and client state

## Phase Details

### Phase 6: WebUI Container-Logs View
**Goal**: Operator can live-tail any mower container's logs from the browser, independent of SSH, with a time-window filter.
**Depends on**: Nothing (fully independent — ships first as debug force-multiplier for Phases 7 & 8)
**Requirements**: LOGS-01, LOGS-02, LOGS-03, LOGS-04
**Success Criteria** (what must be TRUE):
  1. Operator opens `/logs` and sees the current list of mower Docker containers, updating live as containers start/stop
  2. Operator selects a container and immediately sees a backfill of recent lines followed by live-tailing output
  3. Log viewer auto-scrolls to newest lines by default, and pauses auto-scroll when the operator scrolls up — resumes when they scroll back to the bottom
  4. Operator applies a `since=` time window (e.g. last 5 min, last 1 h) and the stream re-backfills from that moment
  5. `/rosbridge` continues to work uninterrupted while `/logs` is open in another tab (single-upgrade-handler regression gate)

**Plans**: 3 plans
- [x] 06-01-PLAN.md — Wave 0 test scaffolding + deps (dockerode, ansi-to-html)
- [x] 06-02-PLAN.md — Backend: docker-adapter, /api/logs/containers, server.mjs /logs/stream branch, docker.sock:ro mount
- [ ] 06-03-PLAN.md — Frontend: /logs route, LogViewer, ContainerList, preset chips, nav integration, human-verify
**UI hint**: yes

### Phase 7: SLAM Pose → EKF Yaw Fusion
**Goal**: Robot's fused yaw is trustworthy at rest and under motion — EKF consumes `/slam_toolbox/pose` as a yaw-only source, with IMU yaw disabled to avoid correlated-input divergence.
**Depends on**: Phase 6 (for in-browser log observability during EKF bring-up — nice-to-have, not hard-blocking)
**Requirements**: FUSE-01, FUSE-02, FUSE-03, FUSE-04
**Success Criteria** (what must be TRUE):
  1. `robot_localization` is consuming `/slam_toolbox/pose` as `pose0` with the yaw index enabled and all other state-vector indices disabled; `imu0` yaw is simultaneously disabled
  2. On real hardware, a 60-second stationary test shows `<1°` yaw drift in `/odometry/filtered`
  3. Operator sees a heading-confidence badge (or equivalent indicator) in the web UI confirming SLAM-backed yaw fusion is active and healthy
  4. Exactly one node publishes the `map→odom` transform (slam_toolbox); no TF cycle or duplicate publisher is present
  5. Chosen covariance scaling for `/slam_toolbox/pose` and the rationale for disabling IMU yaw are documented in `config/ekf.yaml` comments (or an adjacent note)

**Plans**: TBD
**UI hint**: yes

### Phase 8: `/lidar` Map-Anchor + Persistence + Honest Reset
**Goal**: Operator can trust what they see on `/lidar` — the occupancy grid is world-fixed under the moving robot, survives page reloads, and the Eraser honestly clears both server and client state (no stale resurrection).
**Depends on**: Phase 7 (rotational correctness of the map-anchor is only testable against a trusted `map→base_link`)
**Requirements**: MAP-01, MAP-02, MAP-03, MAP-04
**Success Criteria** (what must be TRUE):
  1. On `/lidar`, driving the robot makes the occupancy grid scroll under a world-fixed reference while the grid itself stays geometrically aligned to real walls (map-frame anchor, not odom-frame)
  2. A robot-cursor icon is rendered on `/lidar` at the current `base_link` pose in the map frame, updating live as TF updates
  3. Operator reloads `/lidar` (F5) and the previously-rendered occupancy grid rehydrates instantly from localStorage, then is superseded by the next live `/map` message if its epoch still matches the server's
  4. Operator clicks Eraser → the server-side `/api/map/reset` endpoint calls the `slam_toolbox` reset service, bumps the map epoch, and the client clears localStorage; a subsequent F5 shows a fresh empty grid (no stale-map resurrection)
  5. If the reset endpoint cannot verify the slam node is alive and the reset succeeded, it returns a structured failure and the UI surfaces it (no false-success toast)

**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 0. GSD Brownfield Adoption | v2.1 | 1/1 | Complete | 2026-04-14 |
| 1. Hardware & UART Routing | v2.1 | 1/1 | Complete (HW-04/05 deferred) | 2026-04-14 |
| 2. LiDAR Driver & `/scan` | v2.1 | 1/1 | Complete | 2026-04-14 |
| 3. Web Visualization | v2.1 | 2/2 | Complete (human UAT deferred) | 2026-04-14 |
| 4. Live Mapping with slam_toolbox | v2.1 | 2/2 | Complete (human UAT deferred) | 2026-04-14 |
| 6. WebUI Container-Logs View | v2.2 | 0/- | Not started | — |
| 7. SLAM → EKF Yaw Fusion | v2.2 | 0/- | Not started | — |
| 8. `/lidar` Map-Anchor + Persistence + Reset | v2.2 | 0/- | Not started | — |

---
*Shipped milestone: v2.1 — 2026-04-15*
*Active milestone: v2.2 Ops & Fusion Polish — roadmap created 2026-04-15*
