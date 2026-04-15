# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2.1 — LD19 LiDAR Integration

**Shipped:** 2026-04-15
**Phases:** 5 | **Plans:** 7 | **Tasks:** 24

### What Was Built

- GSD brownfield adoption of an already-working MowerBot codebase, with `.planning/codebase/` map preserved and annotated git tag `gsd-baseline-v0` as the forensic baseline anchor
- LD19 2D LiDAR integrated hardware-up: dedicated PL011 UART via `dtoverlay=uart3`, `/dev/ttyLIDAR` udev symlink, pigtail wiring (no HAT respin)
- Containerized `ldlidar_stl_ros2` Docker service publishing `sensor_msgs/LaserScan` on `/scan` at ~10 Hz with SensorDataQoS and `base_link→laser_frame` static TF
- End-to-end CBOR rosbridge pipeline with typed-array-aware NaN scrubber; Canvas 2D polar scan overlay on `/map` with viridis coloring + stale-badge; Foxglove layout
- Live SLAM mapping added beyond original scope: `slam_toolbox` container publishing `/map` OccupancyGrid + `map→odom` TF, rendered as bitmap under scan on `/lidar` with zoom/pan/reset UX
- `foxglove_bridge` sidecar on `:8765` to sidestep rosbridge's `float[]` serializer CPU-loop bug

### What Worked

- **Two-commit phase structure** (Commit A = risky infra retrofit with regression gate, Commit B = new feature) — enabled isolated rollback; used successfully for Phase 2 (`x-ros-common` ipc+pid retrofit) and Phase 3 (global CBOR retrofit)
- **Pinning by driver SHA, not `:latest`** — `ldlidar_stl_ros2` pinned at `bf668a8`, `slam_toolbox` at `humble-2.6.10`; zero surprises from upstream churn
- **Build-time grep assertions for sed-patches** — caught silent no-ops when source files would have reflowed
- **Starting with the smallest end-to-end slice** (Phase 3 Core Value gate = `/scan` visible in browser) — kept scope discipline and proved the pipeline before adding SLAM
- **Human-verification callouts in VERIFICATION.md `status: human_needed`** with explicit "why_human" reasoning — honest about what code verification can't prove
- **Brownfield codebase mapping before planning** — `.planning/codebase/` gave every phase confident constraints on what to preserve

### What Was Inefficient

- **Phase 1 & Phase 2 never got a formal VERIFICATION.md** — phase work completed and downstream Phase 3 proved the pipeline, but the audit step was skipped, creating 3-source-matrix noise at milestone close
- **REQUIREMENTS.md checkboxes went out of sync** with actual phase state; requires explicit hygiene pass during close or a tooling hook
- **The milestone-complete CLI's accomplishment extraction pulled garbage** (section-header lines like "[Rule 3 — Blocking]" treated as accomplishments) — had to rewrite MILESTONES.md by hand
- **Two phases added mid-milestone** (Phase 4 live mapping, Foxglove bridge quick) expanded scope meaningfully; worked out fine here because hardware + pipeline were already stable, but a riskier project would have been better served deferring
- **HW-04 / HW-05 dependency on drivetrain-not-connected** wasn't surfaced during Phase 1 planning; caught at verification and deferred honestly, but would have been cleaner as a Phase 1 precondition

### Patterns Established

- **`x-ros-common` YAML anchor** for cross-container DDS shmem: `network_mode: host` + `ipc: host` + `pid: host` + `CYCLONEDDS_URI` — all new ROS2 services inherit this
- **Typed-array exemption in rosbridge NaN scrubber** (`ArrayBuffer.isView` check) — Float32Array payloads pass through unmodified, enabling CBOR binary topics
- **Two-layer stale detection** (message freshness at 1500 ms threshold + badge reflected in UI) — reusable for future sensor overlays
- **Quick tasks (`/gsd-quick`) for polish + bug-fixes after main phase work** — `260414-w8p` standalone page, `260415-9ww` deeper zoom, `260415-fqf` cleanup, `260415-ln2` foxglove-bridge all shipped as individual commits without rolling up into a plan
- **Decimal phase numbering deferred** — sequential 0, 1, 2, 3, 4 worked cleanly for a linear dependency chain

### Key Lessons

1. **Generate VERIFICATION.md even for "obvious" phases** — skipping it created documentation debt at milestone close and forced manual reconstruction of what actually shipped
2. **Commit messages alone are not summaries** — the milestone CLI can't extract good accomplishments from header-style prose; structure SUMMARY.md with explicit one-liner / accomplishment fields
3. **For binary ROS topics (LaserScan, OccupancyGrid), CBOR + typed-array NaN exemption is the correct pattern** — NaN-scrub passes verbatim, compression is free, browser gets a raw Float32Array
4. **Hardware dependencies cascade further than expected** — `/odom` gap (firmware) blocks HW-04 verification, 5V rail measurement, EKF yaw stability, and map-scan alignment; treat firmware readiness as a first-class milestone input next time
5. **When a pipeline works end-to-end programmatically, human walkthroughs can be absorbed into regular test-session rhythm** — don't block milestone close on physical mower availability

### Cost Observations

- Model mix: predominantly sonnet for plan + execute; opus only for research + synthesis; haiku unused
- Notable: Phase 4 (added mid-milestone) was completed in a single session; `x-ros-common` retrofit regression gate paid for itself within Phase 2 by catching no breakage before the new service shipped

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v2.1 | 5 | 7 | First milestone under GSD; brownfield adoption pattern established; two-commit risky-retrofit structure adopted |

### Cumulative Quality

| Milestone | Programmatic Verifications | Human UAT Deferred | Deferred Requirements |
|-----------|----------------------------|--------------------|-----------------------|
| v2.1 | 3/5 phases (Phase 0, 3, 4) | 9 walkthroughs | 2 (HW-04, HW-05) |

### Top Lessons (Verified Across Milestones)

1. *(Awaiting v2.2 for cross-milestone validation)*
