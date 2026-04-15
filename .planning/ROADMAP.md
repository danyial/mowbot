# Roadmap: MowerBot

## Milestones

- ✅ **v2.1 LD19 LiDAR Integration** — Phases 0–4 (shipped 2026-04-15) — see [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md)

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

### 🚧 v2.2 Ops & Fusion Polish (Planned)

Three-phase follow-on: in-dashboard container logs, SLAM→EKF yaw fusion, `/lidar` residuals (map-anchor, persistence, honest server-side reset).

- [ ] Phase 5: WebUI Container-Logs View
- [ ] Phase 6: SLAM Pose → EKF Yaw Fusion
- [ ] Phase 7: `/lidar` Residuals (map-anchor, localStorage, server-side reset)

Requirements will be written during `/gsd-new-milestone`.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 0. GSD Brownfield Adoption | v2.1 | 1/1 | Complete | 2026-04-14 |
| 1. Hardware & UART Routing | v2.1 | 1/1 | Complete (HW-04/05 deferred) | 2026-04-14 |
| 2. LiDAR Driver & `/scan` | v2.1 | 1/1 | Complete | 2026-04-14 |
| 3. Web Visualization | v2.1 | 2/2 | Complete (human UAT deferred) | 2026-04-14 |
| 4. Live Mapping with slam_toolbox | v2.1 | 2/2 | Complete (human UAT deferred) | 2026-04-14 |
| 5. WebUI Container-Logs View | v2.2 | 0/- | Planned | — |
| 6. SLAM → EKF Yaw Fusion | v2.2 | 0/- | Planned | — |
| 7. `/lidar` Residuals | v2.2 | 0/- | Planned | — |

---
*Shipped milestone: v2.1 — 2026-04-15*
*Next milestone: v2.2 Ops & Fusion Polish (run `/gsd-new-milestone`)*
