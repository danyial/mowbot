---
phase: 3
slug: web-visualization-scan-on-the-map-page
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated from `03-RESEARCH.md` §"Validation Architecture". Planner refines.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual + scripted probes (no test runner exists in `web/`) |
| **Config file** | none — phase is UI-visual + WebSocket-behavior; no unit harness planned |
| **Quick run command** | `cd web && npm run build` (type-check + lint gate) |
| **Full suite command** | `cd web && npm run build && npm run lint` + manual browser probes per matrix below |
| **Estimated runtime** | ~45 s build + ~2 min manual probe cycle |

---

## Sampling Rate

- **After every task commit:** `cd web && npm run build` (must pass)
- **After Commit A (CBOR retrofit):** Run the 12-row regression matrix against live mower (`ssh pi@10.10.40.23`, browser to `http://mower.local:3000`)
- **After Commit B (scan overlay):** Full SC#1–SC#5 browser walk-through
- **Before `/gsd-verify-work`:** Build green + regression matrix green + all SC verified live
- **Max feedback latency:** ~60 s (build) / ~5 min (manual browser walk)

---

## Per-Task Verification Map

*Planner fills this from PLAN.md task list. Skeleton below — each task gets one row.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-XX | 01 (Commit A) | 1 | VIZ-02 | — | CBOR flag on `ROSLIB.Topic` doesn't break existing subs | manual probe | browser DevTools Network + store assertions | ⬜ | ⬜ pending |
| 3-02-XX | 02 (Commit B) | 2 | VIZ-01, VIZ-03, VIZ-04, VIZ-05 | — | `<ScanOverlay>` renders live points + stale badge flips | manual probe | browser visual + `docker stop lidar` flip test | ⬜ | ⬜ pending |

---

## Wave 0 Requirements

- [ ] No test harness install needed — `npm run build` + `npm run lint` are the only gates
- [ ] Verify SSH probe script exists to dump `ros2 topic hz /scan` on Pi (for manual SC#1 verification)

*No framework install — phase is UI-visual and relies on manual browser probes.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scan polar overlay renders around robot | VIZ-01, SC#1 | Visual-only behavior | Browser → `/map` → observe 360° scan overlay pinned to robot marker |
| CBOR in use, WebSocket buffer stable | VIZ-02, SC#2 | DevTools runtime inspection | Chrome DevTools → Network → WS → confirm binary frames; monitor `bufferedAmount` over 5 min with 2 tabs |
| Stale badge flips red ≤1.5 s after `lidar` stop | VIZ-03, SC#3 | Requires live hardware toggle | `ssh pi@10.10.40.23 'docker stop lidar'` → watch badge color change; `docker start lidar` → flips back |
| Foxglove layout opens, panels populate | VIZ-04, SC#4 | External tool behavior | Open `web/foxglove/mowerbot.foxglove-layout.json` in Foxglove Studio connected to `ws://mower.local:9090` → `/scan`, `/odom`, `/fix` panels show data |
| Viridis gradient + legend readable | VIZ-05, SC#5 | Visual design judgment | Browser → `/map` → visually confirm gradient (near=violet, far=yellow) + bottom-right color-bar legend |
| `server.mjs` × CBOR binary frames don't corrupt | (research pitfall P2) | Only visible as "subscriber X stopped working" symptom | Commit A regression matrix (12 rows) — each existing store populates under CBOR; if any fails, narrow scope per D-07 |

---

## Validation Sign-Off

- [ ] All tasks have manual probe steps or explicit `npm run build` gate
- [ ] Sampling continuity: no 3 consecutive tasks without a verify step
- [ ] Wave 0 (none needed) acknowledged
- [ ] No watch-mode flags
- [ ] Feedback latency < 300 s
- [ ] `nyquist_compliant: true` set in frontmatter after planner fills per-task map

**Approval:** pending
