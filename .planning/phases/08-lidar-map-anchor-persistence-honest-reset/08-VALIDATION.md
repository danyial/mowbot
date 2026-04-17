---
phase: 8
slug: lidar-map-anchor-persistence-honest-reset
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Sourced from `08-RESEARCH.md §Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` (matches Phase 6 pattern in `web/__tests__/*.test.mjs`) |
| **Config file** | None — `web/package.json` declares `"test": "node --test __tests__/"` |
| **Quick run command** | `cd web && npm run test -- __tests__/map-epoch.test.mjs` |
| **Full suite command** | `cd web && npm run test` |
| **Smoke (runtime, hardware)** | `curl -s http://10.10.40.23:3000/api/map/epoch \| jq .` ; `curl -s -X POST http://10.10.40.23:3000/api/map/reset \| jq .` |
| **Estimated runtime** | ~2 s unit/integration suite; +~5 s hardware smoke per call |

---

## Sampling Rate

- **After every task commit:** `cd web && npm run test` (full unit+integration suite, <2s)
- **After every plan wave:** `cd web && npm run lint && npm run test` + manual runtime smoke (`curl /api/map/epoch`, `curl -X POST /api/map/reset`)
- **Before `/gsd-verify-work`:** Full suite green + live hardware drive: mower forward 2 m, verify grid stays anchored visually + cursor tracks; reload `/lidar`, verify grid rehydrates; click Eraser, verify map wipes and F5 shows empty grid — no stale resurrection
- **Max feedback latency:** 2 s (unit) — well under 30 s threshold

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 0 | MAP-04 | — | preserve docker.sock:ro | runtime | `docker exec mower-slam ros2 service call /slam_toolbox/serialize_map slam_toolbox/srv/SerializePoseGraph "{filename: '/data/empty'}" && ls -la data/empty.posegraph data/empty.data` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 0 | MAP-04 | — | N/A | unit | `cd web && npm run test -- __tests__/map-epoch.test.mjs` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 0 | MAP-01 | — | N/A | unit | `cd web && npm run test -- __tests__/map-frame-pose.test.mjs` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 0 | MAP-03 | — | N/A | unit | `cd web && npm run test -- __tests__/map-store-rehydrate.test.mjs` | ❌ W0 | ⬜ pending |
| 08-01-05 | 01 | 0 | MAP-04 | — | N/A | unit | `cd web && npm run test -- __tests__/map-reset-route.test.mjs` (uses stubbed roslib + stubbed fs) | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | MAP-03 | — | N/A | static | `grep -E "GET|POST" web/app/api/map/{epoch,reset}/route.ts` returns both files non-empty | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 1 | MAP-04 | V5 | malformed body rejected | static + integration | `npm run test -- __tests__/map-reset-route.test.mjs` | ❌ W0 | ⬜ pending |
| 08-02-03 | 02 | 1 | MAP-04 | — | atomic write | unit | `npm run test -- __tests__/map-epoch.test.mjs` (asserts temp+rename pattern, no torn-read window) | ❌ W0 | ⬜ pending |
| 08-02-04 | 02 | 1 | — | — | server.mjs unchanged regression gate | static | `cd web && npm run test -- __tests__/server-upgrade.test.mjs` (existing from Phase 6 — must stay green) | ✅ | ⬜ pending |
| 08-03-01 | 03 | 2 | MAP-01 | — | N/A | static | `grep -E "mapFramePose" web/components/lidar/{map-bitmap,scan-canvas}.tsx` finds prop chain | ❌ W0 | ⬜ pending |
| 08-03-02 | 03 | 2 | MAP-02 | — | N/A | static + manual | `grep "RobotCursor\|cursor" web/components/lidar/scan-canvas.tsx` + manual visual check | ❌ W0 | ⬜ pending |
| 08-03-03 | 03 | 2 | MAP-03 | — | N/A | unit | `cd web && npm run test` full suite green | ❌ W0 | ⬜ pending |
| 08-03-04 | 03 | 2 | MAP-04 | — | no false-success | manual | Eraser click happy path + service failure (stop mower-slam first) — banner appears | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `data/empty.posegraph` + `data/empty.data` — generated once via `serialize_map` on a freshly-restarted slam container; committed (or stored in `mower-data` volume)
- [ ] `web/__tests__/map-epoch.test.mjs` — atomic write, missing-file init, increment, no-torn-read assertion
- [ ] `web/__tests__/map-frame-pose.test.mjs` — composite pose math (slam anchor + odom delta with yaw composition); ±1e-6 tolerance
- [ ] `web/__tests__/map-store-rehydrate.test.mjs` — jsdom-backed store rehydrate from localStorage; setEpoch cleans stale keys; QuotaExceededError → `persistenceDisabled: true`
- [ ] `web/__tests__/map-reset-route.test.mjs` — three integration paths (happy, service-stage, mapTimeout); stubbed roslib client + stubbed fs

*Framework install: none — `node --test` is built-in.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Grid stays world-fixed under moving robot | MAP-01 | Requires physical motion + visual confirmation | Drive mower forward 2 m on `/lidar` open in browser; verify grid origin holds against real walls (not sliding with the robot) |
| Robot cursor tracks live pose | MAP-02 | Visual / interactive | Verify orange circle + heading line moves with robot; heading correctly points along motion |
| F5 rehydrate | MAP-03 | Browser navigation timing | Drive 1 m, reload `/lidar`, expect grid to appear within ~200ms (from localStorage) before next `/map` arrives |
| Eraser honesty — service failure path | MAP-04 | Requires `docker stop mower-slam` first | Stop slam container, click Eraser → expect inline red banner with concrete error + Retry button; click Retry after `docker start mower-slam` → expect success |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (5 test files + empty posegraph)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (full suite ~2s)
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 commits land

**Approval:** pending
