---
phase: 6
slug: webui-container-logs-view
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `06-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node 22 built-in `node:test` (no new dev dep; no vitest/jest migration this phase) |
| **Config file** | none |
| **Quick run command** | `cd web && node --test __tests__/ 2>&1` |
| **Full suite command** | `cd web && node --test __tests__/ 2>&1` |
| **Estimated runtime** | <2 s (pure-function + file-scan tests) |

---

## Sampling Rate

- **After every task commit:** `cd web && node --test __tests__/ 2>&1`
- **After every plan wave:** full suite + `grep -c 'server.on("upgrade"' web/server.mjs` must return `1`
- **Before `/gsd-verify-work`:** full suite green + 5 ROADMAP.md observable behaviors manually confirmed + `docker inspect mower-web | jq '[.[0].Mounts[] | select(.Source=="/var/run/docker.sock")] | .[0].RW'` returns `false`
- **Max feedback latency:** 2 s

---

## Per-Task Verification Map

> Filled by planner during Plan step. Each task must reference a test in this table OR a Wave 0 entry below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD-W0-01 | TBD | 0 | LOGS-01..04 + regression | T-06-01 (docker.sock RW) / T-06-02 (second upgrade listener) | dockerode adapter only exposes `listContainers`/`getContainer`/`getEvents`; exactly one `server.on('upgrade')` | unit | `node --test web/__tests__/docker-adapter.test.mjs` | ❌ W0 | ⬜ pending |
| TBD-W0-02 | TBD | 0 | LOGS-02 | T-06-03 (demux skip → garbled output) | 8-byte-header stripped; stdout/stderr split | unit (fixture) | `node --test web/__tests__/demux.test.mjs` | ❌ W0 | ⬜ pending |
| TBD-W0-03 | TBD | 0 | LOGS-04 | — | `since=` preset → epoch seconds ±1 s | unit | `node --test web/__tests__/since-preset.test.mjs` | ❌ W0 | ⬜ pending |
| TBD-W0-04 | TBD | 0 | Regression | T-06-02 | single upgrade listener + both path branches present | unit (grep) | `node --test web/__tests__/server-upgrade.test.mjs` | ❌ W0 | ⬜ pending |
| TBD-MAN-01 | TBD | — | LOGS-03 | — | scroll up pauses auto-scroll; scroll to bottom resumes | manual UAT | (browser) | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `web/__tests__/server-upgrade.test.mjs` — grep-based regression gate: exactly one `server.on('upgrade'`, both `/rosbridge` and `/logs/stream/` path branches present
- [ ] `web/__tests__/docker-adapter.test.mjs` — method allowlist: only `listContainers`, `getContainer`, `getEvents` exported; `getContainer()` facade exposes only `inspect`, `logs`, `modem`
- [ ] `web/__tests__/demux.test.mjs` — synthetic 8-byte-header buffer fixture → minimal framer replica → stdout/stderr split assertion
- [ ] `web/__tests__/since-preset.test.mjs` — `parseSincePreset('5m')` returns `Math.floor(Date.now()/1000) - 300` within ±1 s
- [ ] `web/__tests__/` directory created; excluded in `tsconfig.json` so Next.js build skips it
- [ ] Framework install: **none** (`node:test` built into Node 22)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Auto-scroll pause on scroll-up, resume on scroll-to-bottom | LOGS-03 | DOM scroll behavior + visual pill state; browser-specific | Open `/logs`, select a busy container (e.g. `slam`), scroll up mid-stream → confirm "Neueste anzeigen" pill appears and auto-scroll stops. Click pill OR scroll to bottom → confirm auto-scroll resumes. |
| Live container-list update on `docker start/stop <svc>` | LOGS-01 | Requires actual container lifecycle event | SSH to mower, `docker stop mower-lidar`; `/logs` list row disappears within ~1 s. `docker start mower-lidar`; row reappears. |
| `since=` preset re-backfills and continues live-tail | LOGS-04 | End-to-end stream behavior | Open `/logs`, select `slam`, click `5m` chip → older lines visible, new lines continue to arrive. |
| `/rosbridge` regression — teleop still works with `/logs` open | ROADMAP P6 SC-5 | End-to-end dual-WS coexistence | Open `/logs` on one tab; open `/teleop` on another; nudge joystick → `/cmd_vel` flows, motors respond. No disconnects on either side for 5 min. |
| docker.sock mount is `:ro` | T-06-01 | Runtime config | `docker inspect mower-web` → confirm `Source=/var/run/docker.sock, RW=false` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2 s
- [ ] `nyquist_compliant: true` set in frontmatter after sign-off

**Approval:** pending
