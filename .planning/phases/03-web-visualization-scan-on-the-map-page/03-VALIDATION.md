---
phase: 3
slug: web-visualization-scan-on-the-map-page
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-14
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated from `03-RESEARCH.md` §"Validation Architecture" and the two PLANs. Planner-filled 2026-04-14.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual + scripted probes (no test runner exists in `web/`) |
| **Config file** | none — phase is UI-visual + WebSocket-behavior; no unit harness planned |
| **Quick run command** | `cd web && npm run build` (type-check + lint gate) |
| **Full suite command** | `cd web && npm run build` + manual browser probes per matrix below |
| **Estimated runtime** | ~45 s build + ~5 min manual SC walk |

---

## Sampling Rate

- **After every task commit:** `cd web && npm run build` (must pass)
- **After Plan 01 Task 4 (CBOR retrofit gate):** 5-topic regression matrix against live mower (browser at `http://10.10.40.23:3000/`)
- **After Plan 02 Task 5 (feature + docs commits):** Full SC#1–SC#5 browser walk-through + Foxglove connection test
- **Before `/gsd-verify-work`:** build green + regression matrix green + all 5 SC verified live
- **Max feedback latency:** ~60 s (build) / ~5 min (manual browser + SSH walkthrough)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 (Commit A) | 1 | VIZ-02 | — | Probe `server.mjs × CBOR` before modifying code (RESEARCH P2) | manual probe + written verdict | `grep -E "^SERVER_MJS_CBOR_OK: (yes\|no)$" .planning/phases/03-web-visualization-scan-on-the-map-page/03-01-PROBE.md` | ⬜ | ⬜ pending |
| 3-01-02 | 01 (Commit A) | 1 | VIZ-02 | — | `subscribe()` threads `{compression, throttle_rate, queue_length}` into `ROSLIB.Topic`; all subscribed TOPICS entries carry `compression: "cbor"` | automated | `cd web && npm run build && grep -c 'compression: "cbor"' web/lib/ros/topics.ts` (expect 6) | ⬜ | ⬜ pending |
| 3-01-03 | 01 (Commit A) | 1 | VIZ-02 | — | `server.mjs` either has `isBinary` guard (if PROBE=no) or verification comment (if PROBE=yes) | automated | `node --check web/server.mjs && (grep -q "isBinary" web/server.mjs \|\| grep -q "Verified 2026-04-14: binary CBOR" web/server.mjs)` | ⬜ | ⬜ pending |
| 3-01-04 | 01 (Commit A) | 1 | VIZ-02 | — | 5-topic regression all-green under global CBOR in live browser, or rollback committed | manual probe (5-row matrix) + SSH `docker compose build web` | regression matrix pasted in 03-01-SUMMARY.md; commit message is exactly `feat(web/03-01): global CBOR retrofit ...` OR `docs(03-01): CBOR retrofit rolled back ...` | ⬜ | ⬜ pending |
| 3-02-01 | 02 (Commit B) | 2 | VIZ-01, VIZ-02 | — | `LaserScan` type + `useScanStore` + `TOPICS.SCAN` (with all 4 options per D-08) + `ros-store.ts` subscription wired | automated | `cd web && npm run build && grep -q 'export interface LaserScan' web/lib/types/ros-messages.ts && grep -q 'subscribe<LaserScan>("SCAN"' web/lib/store/ros-store.ts` | ⬜ | ⬜ pending |
| 3-02-02 | 02 (Commit B) | 2 | VIZ-05 | — | 768-byte viridis Uint8Array present with anchor colors within tolerance | automated | parse `web/lib/viridis.ts`, count numeric entries in the `new Uint8Array([...])` literal, expect 768 | ⬜ | ⬜ pending |
| 3-02-03 | 02 (Commit B) | 2 | VIZ-01, VIZ-03, VIZ-05 | — | `<ScanOverlay>` implements Y-flip, NaN/Infinity skip, 1500 ms stale threshold, 200 ms interval, viridis draw, badge, legend; mounted in `robot-map.tsx` | automated | `cd web && npm run build && grep -q 'STALE_THRESHOLD_MS = 1500' web/components/map/scan-overlay.tsx && grep -q 'cy - POINT_SIZE_PX' web/components/map/scan-overlay.tsx && grep -q '<ScanOverlay' web/components/map/robot-map.tsx` | ⬜ | ⬜ pending |
| 3-02-04 | 02 (Commit B) | 2 | VIZ-04 | — | Valid Foxglove layout JSON with `/scan`, `/odometry/filtered`, `/fix`; docs name the "Rosbridge (ROS 1 & 2)" connector (P8) | automated | `python3 -c "import json; json.load(open('web/foxglove/mowerbot.foxglove-layout.json'))" && grep -q "Rosbridge (ROS 1 & 2)" docs/foxglove-integration.md` | ⬜ | ⬜ pending |
| 3-02-05 | 02 (Commit B) | 2 | VIZ-01, VIZ-02, VIZ-03, VIZ-04, VIZ-05 | — | End-to-end SC#1–SC#5 live walkthrough (overlay, CBOR binary frame, stale flip ≤2s both directions, Foxglove 3 panels, viridis + legend) | manual probe | see 03-02-PLAN.md Task 5 — deploy + 5-SC walk | ⬜ | ⬜ pending |

---

## Wave 0 Requirements

- [x] No test harness install needed — `npm run build` is the only automated gate
- [x] SSH probe access confirmed: `ssh pi@10.10.40.23` (password auth authorized in MEMORY.md)

*No framework install — phase is UI-visual and relies on manual browser + SSH probes.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Plan Task |
|----------|-------------|------------|-------------------|-----------|
| `server.mjs × CBOR` probe verdict | VIZ-02 (P2) | Requires live rosbridge + browser interaction | 03-02-PLAN.md → 03-01-PLAN.md Task 1 (Node REPL + DevTools manual CBOR subscribe) | 3-01-01 |
| 5-topic regression matrix under global CBOR | VIZ-02 | DevTools runtime inspection per-store | 03-01-PLAN.md Task 4 regression table | 3-01-04 |
| Scan polar overlay renders around robot | VIZ-01, SC#1 | Visual-only behavior | Browser → `/map` → observe 360° overlay pinned to robot marker; asymmetric obstacle probe for Y-flip | 3-02-05 |
| CBOR binary WS frames + bounded buffer | VIZ-02, SC#2 | DevTools runtime inspection over 5 min with 2 tabs | `bufferedAmount` sampled 5× over 5 min, all < 10_000 | 3-02-05 |
| Stale badge flips red ≤1.5 s (worst-case ≤2.0 s) | VIZ-03, SC#3 | Requires live hardware toggle | `ssh pi@10.10.40.23 'docker stop lidar'` with stopwatch | 3-02-05 |
| Foxglove layout opens, 3 panels populate via Rosbridge connector | VIZ-04, SC#4 | External tool behavior | Open `web/foxglove/mowerbot.foxglove-layout.json` in Foxglove Studio → Rosbridge (ROS 1 & 2) → `ws://10.10.40.23:9090` | 3-02-05 |
| Viridis gradient (near=violet, far=yellow) + legend readable | VIZ-05, SC#5 | Visual design judgment | Browser → `/map` → visually confirm gradient direction + bottom-right 0 m → 8 m color bar | 3-02-05 |

---

## Validation Sign-Off

- [x] All tasks have manual probe steps or explicit `npm run build` gate
- [x] Sampling continuity: no 3 consecutive tasks without a verify step (every task has automated OR manual gate)
- [x] Wave 0 (none needed) acknowledged
- [x] No watch-mode flags
- [x] Feedback latency < 300 s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-complete; awaiting execution.
