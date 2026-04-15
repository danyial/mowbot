# Requirements: MowerBot v2.2 Ops & Fusion Polish

**Milestone:** v2.2 — Ops & Fusion Polish
**Core value gate:** Operator can (1) see every container's live logs in-browser, (2) trust the SLAM map's rotational alignment under motion, (3) walk away, reload, and find the same map they had — or honestly reset it to fresh.

---

## v2.2 Requirements

### Container Logs (LOGS)

- [ ] **LOGS-01**: Operator can see a live list of mower Docker containers in the `/logs` route, auto-refreshing as containers start/stop
- [ ] **LOGS-02**: Operator can select a container and see a live-tailing log stream with an initial backfill of recent lines
- [ ] **LOGS-03**: Log viewer auto-scrolls to the bottom on new lines, and pauses auto-scroll when the operator scrolls up to read older lines
- [ ] **LOGS-04**: Operator can filter the log stream by a time window (e.g., last 5 min, last 1 h) applied as a `since=` server-side filter

### SLAM → EKF Yaw Fusion (FUSE)

- [ ] **FUSE-01**: `robot_localization` EKF consumes `/slam_toolbox/pose` as a yaw-only `pose0` input; `imu0` yaw index is disabled simultaneously to avoid correlated-input divergence
- [ ] **FUSE-02**: Stationary yaw drift is measurably reduced — a 60-second stationary drift test on real hardware shows `<1°` yaw drift in `/odometry/filtered`
- [ ] **FUSE-03**: Operator sees a heading-confidence badge (or equivalent indicator) in the web UI confirming that SLAM-backed yaw fusion is active and healthy
- [ ] **FUSE-04**: Chosen covariance scaling values for `/slam_toolbox/pose` (and disabled-IMU rationale) are documented in `config/ekf.yaml` comments or an adjacent note

### `/lidar` Map Polish (MAP)

- [ ] **MAP-01**: Occupancy-grid bitmap on `/lidar` is anchored in the map frame — the grid remains fixed in world while the robot moves across it (subtract `map→base_link` translation in `<MapBitmap>`)
- [ ] **MAP-02**: A robot-cursor icon is rendered on `/lidar` at the current `base_link` pose in the map frame, updating live with TF
- [ ] **MAP-03**: Occupancy-grid state persists to `localStorage` with an epoch key; on page load the grid is rehydrated from storage if its epoch matches the server's current map epoch
- [ ] **MAP-04**: The Eraser button calls a server-side `/api/map/reset` endpoint that invokes the `slam_toolbox` reset service and bumps the map epoch; both server map and client `localStorage` end up cleared (no stale resurrection on F5)

---

## Deferred (Carried from v2.1 — not in v2.2 scope)

- **HW-04** `/odom` regression echo — blocked on firmware publishing `/odom`
- **HW-05** 5V rail transient under motor+LiDAR load — blocked on drivetrain electrically connected
- **9 human-UAT walkthroughs from v2.1** — require physical mower access, tracked in original phase `VERIFICATION.md`s

## Future Requirements (post-v2.2)

- Dual-EKF refactor (odom-frame EKF + map-frame EKF) — if single-EKF yaw-only `pose0` shows edge-case divergence
- Safety auto-stop watchdog gating `/cmd_vel` on `/scan` — unblocked once yaw is trustworthy
- Full Nav2 autonomous waypoint navigation — depends on stable fused localization
- IndexedDB migration for occupancy-grid persistence — only if real yard maps exceed `localStorage` quota
- Log-viewer differentiators: download log, ANSI rendering, level-highlight, multi-container multiplex
- `slam_toolbox` map serialization/deserialization (`serialize_map` / `deserialize_map`) for cross-session map library

## Out of Scope (Explicit Exclusions)

- **Container lifecycle buttons (start/stop/restart) in `/logs`** — reason: requires writable `docker.sock`, breaks the read-only security boundary that makes `/logs` safe on a trusted-LAN device. Logs view is *observability*, not *control*.
- **Shell-exec into containers from the browser** — reason: same security boundary; out of scope for a mower dashboard.
- **SLAM x/y fusion into EKF** — reason: `slam_toolbox` owns `map→odom`; feeding SLAM x/y into the EKF that publishes `odom→base_link` creates a TF cycle. Yaw-only is the right slice.
- **Dual-EKF refactor** — reason: single-EKF yaw-only `pose0` is sufficient per robot_localization docs; dual-EKF is only justified if divergence is observed in v2.2 testing.
- **Browser-only map reset (no server call)** — reason: slam_toolbox's internal map would immediately re-publish, misleading the operator.
- **Multi-container merged log tail** — reason: chronological interleaving is ambiguous across containers; per-container tail is clearer and simpler.
- **IndexedDB for occupancy-grid persistence** — reason: measured grid sizes fit comfortably within `localStorage`'s 5 MB quota; added complexity not justified for v2.2.
- **`ros3djs` / `ros2djs`** — reason: Canvas 2D remains the rendering primitive per PROJECT.md.

---

## Traceability

Filled by `/gsd-new-milestone` roadmapper.

| REQ-ID | Phase | Status |
|--------|-------|--------|
| LOGS-01 | — | pending |
| LOGS-02 | — | pending |
| LOGS-03 | — | pending |
| LOGS-04 | — | pending |
| FUSE-01 | — | pending |
| FUSE-02 | — | pending |
| FUSE-03 | — | pending |
| FUSE-04 | — | pending |
| MAP-01 | — | pending |
| MAP-02 | — | pending |
| MAP-03 | — | pending |
| MAP-04 | — | pending |
