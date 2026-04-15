---
phase: 06-webui-container-logs-view
verified: 2026-04-15T20:45:00Z
status: passed
score: 5/5
overrides_applied: 0
---

# Phase 6: WebUI Container-Logs View — Verification Report

**Phase Goal:** Operator can live-tail any mower container's logs from the browser, independent of SSH, with a time-window filter.
**Verified:** 2026-04-15T20:45:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator opens `/logs` and sees the current list of mower Docker containers, updating live as containers start/stop | VERIFIED | `ContainerList` hydrates from `GET /api/logs/containers` on mount; `EventSource('/api/logs/events')` SSE channel pushes `{action:start\|die\|destroy}` diffs — no polling (`grep -c setInterval container-list.tsx` → 0). Human-verify on Pi confirmed 10 containers returned; die/start events received within ~4 s of real `docker stop/start`. |
| 2 | Operator selects a container and immediately sees a backfill of recent lines followed by live-tailing output | VERIFIED | `LogViewer` opens `ws(s)://<host>/logs/stream/<id>?since=<preset>&tail=200` via 500→5000 ms backoff WS client. Human-verify on Pi: 20 clean `{ts,stream,line}` JSON frames from `mower-slam` in 3 s, both `stdout` and `stderr` streams present, no raw 8-byte header bytes leaked (demux pipeline clean). |
| 3 | Log viewer auto-scrolls to newest lines by default, and pauses auto-scroll when the operator scrolls up — resumes when scrolling back to bottom | VERIFIED | `scrollHeight - 24` pause threshold present in `log-viewer.tsx` (grep count 1). "Neueste anzeigen" resume pill present (grep match found). `role="log"` + `aria-live="polite"` on scroll container. Human-verify programmatic test: scroll up 600 px triggered pill; clicking pill restored `atBottom=true`. |
| 4 | Operator applies a `since=` time window and the stream re-backfills from that moment | VERIFIED | `SincePresetChips` renders 6 preset buttons (1m/5m/15m/1h/6h/24h) + ghost "Alle" clear. Selecting a chip closes current WS and opens new connection with `since=<preset>`. Human-verify: clicking `5m` set `aria-pressed=true`, scrollHeight shrank 5555→1678 px. Server-side `parseSincePreset` unit-tested (all 6 presets ±1 s, null passthrough, bogus→null) — 3/3 green. |
| 5 | `/rosbridge` continues to work uninterrupted while `/logs` is open in another tab (single-upgrade-handler regression gate) | VERIFIED | `grep -c 'server.on("upgrade"' web/server.mjs` → 1 (invariant held through all 3 plans). Wave 0 regression test `server-upgrade.test.mjs` passes as part of the 11/11 green suite. Human-verify on Pi: concurrent `ws://localhost:3000/logs/stream/mower-slam` + `ws://localhost:3000/rosbridge` both reported OPEN. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `web/__tests__/server-upgrade.test.mjs` | Regression gate: single upgrade listener + both path branches | VERIFIED | File exists, 3/3 subtests GREEN |
| `web/__tests__/docker-adapter.test.mjs` | Allowlist test: only listContainers/getContainer/getEvents + facade shape | VERIFIED | File exists, 2/2 subtests GREEN |
| `web/__tests__/demux.test.mjs` | 8-byte-header demux fixture tests | VERIFIED | File exists, 3/3 subtests GREEN |
| `web/__tests__/since-preset.test.mjs` | Pure function test for epoch-second presets | VERIFIED | File exists, 3/3 subtests GREEN |
| `web/lib/types/logs.ts` | ContainerSummary, LogFrame, SincePreset types | VERIFIED | File exists |
| `web/lib/server/demux.mjs` | Stateless 8-byte Docker frame demuxer | VERIFIED | 47 lines, substantive — `demuxBuffer` implementation with header parsing |
| `web/lib/server/since-preset.mjs` | Preset → epoch-seconds converter | VERIFIED | 25 lines, substantive — exports `parseSincePreset` |
| `web/lib/server/docker-adapter.mjs` | Dockerode wrapper with method allowlist | VERIFIED | 82 lines, substantive — exports exactly `{listContainers, getContainer, getEvents}` |
| `web/app/api/logs/containers/route.ts` | GET → ContainerSummary[] or 503 | VERIFIED | 22 lines, substantive — dynamic route, no-cache |
| `web/app/api/logs/events/route.ts` | SSE lifecycle feed with backoff reconnect | VERIFIED | 125 lines, substantive — exponential backoff, 5 event types |
| `web/app/logs/page.tsx` | Client-only page, dynamic import ssr:false | VERIFIED | 27 lines, `ssr: false` confirmed via grep |
| `web/components/logs/log-viewer.tsx` | Two-pane viewer with WS, ANSI, scroll, ring buffer | VERIFIED | 375 lines, substantive — all behavioral markers present |
| `web/components/logs/container-list.tsx` | Left pane with EventSource live updates | VERIFIED | 213 lines, substantive — no setInterval, EventSource + fetch wired |
| `web/components/logs/since-preset-chips.tsx` | 6 preset chips + Alle clear | VERIFIED | 62 lines, substantive — all 6 presets, aria-pressed |
| `web/components/logs/connection-badge.tsx` | Live/reconnecting/stopped badge | VERIFIED | 47 lines, substantive |
| `web/lib/store/logs-store.ts` | Zustand store: selectedContainerId, sincePreset, connectionState | VERIFIED | 30 lines, no persist/localStorage |
| `web/components/layout/sidebar.tsx` | /logs nav entry with ScrollText icon | VERIFIED | ScrollText count=2, "/logs" count=1 |
| `web/components/layout/mobile-nav.tsx` | /logs entry in mobile bottom nav | VERIFIED | "/logs" count=1 |
| `web/types/ansi-to-html.d.ts` | Local type shim for ansi-to-html | VERIFIED | File exists (no official @types package) |
| `web/next.config.mjs` | serverExternalPackages for dockerode tree | VERIFIED | "dockerode" present — Turbopack build fix |
| `docker-compose.yml` | web service: docker.sock :ro + COMPOSE_PROJECT_NAME | VERIFIED | `:ro` mount confirmed, `COMPOSE_PROJECT_NAME=mowbot` set |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `log-viewer.tsx` | `ws://.../logs/stream/<id>` | `ws(s)://${window.location.host}/logs/stream/${id}?since=...&tail=200` | WIRED | grep `/logs/stream/` in log-viewer.tsx → count 2 |
| `container-list.tsx` | `/api/logs/containers` | one-shot fetch on mount | WIRED | grep `/api/logs/containers` → count 2 |
| `container-list.tsx` | `/api/logs/events` | EventSource subscription | WIRED | EventSource count=3, `/api/logs/events` count=2 |
| `log-viewer.tsx` | `ansi-to-html` | `new Convert({escapeXML:true, stream:true})` | WIRED | `escapeXML` count=1 in log-viewer.tsx |
| `sidebar.tsx` | `/logs route` | navItems entry with ScrollText icon | WIRED | ScrollText + "/logs" confirmed in sidebar |
| `server.mjs` | `/logs/stream/<id>` WS branch | `else if (pathname.startsWith("/logs/stream/"))` inside single upgrade handler | WIRED | `/logs/stream/` count=3, single upgrade listener count=1 |
| `docker-compose.yml` | `docker.sock` | `:ro` bind mount on web service only | WIRED | Mount confirmed; human-verify on Pi: `RW=False Mode=ro` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `container-list.tsx` | containers list | `GET /api/logs/containers` → dockerode `listContainers()` → Docker daemon | Yes — filtered by Compose project label from live daemon | FLOWING |
| `log-viewer.tsx` | lines ring buffer | WS `/logs/stream/<id>` → `server.mjs` → `docker-adapter.mjs` `getContainer().logs()` → Docker daemon | Yes — real container log stream with TTY/demux detection | FLOWING |
| `container-list.tsx` | live updates | SSE `/api/logs/events` → dockerode `getEvents()` → Docker event stream | Yes — real Docker event stream with action types | FLOWING |

### Behavioral Spot-Checks

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| Wave 0 regression test suite | `cd web && node --test __tests__/*.mjs` | 11/11 pass, 0 fail, exit 0 | PASS |
| Single upgrade listener invariant | `grep -c 'server.on("upgrade"' web/server.mjs` | 1 | PASS |
| No polling in ContainerList | `grep -c 'setInterval' web/components/logs/container-list.tsx` | 0 | PASS |
| ANSI XSS mitigation | `grep -c 'escapeXML' web/components/logs/log-viewer.tsx` | 1 | PASS |
| TypeScript clean build | `cd web && npx tsc --noEmit` | 0 errors | PASS |
| 10k ring buffer cap | `grep -c '10000' web/components/logs/log-viewer.tsx` | 2 (constant + comment) | PASS |
| Scroll pause threshold | `grep -c 'scrollHeight - 24' web/components/logs/log-viewer.tsx` | 1 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LOGS-01 | 06-01, 06-02, 06-03 | Live container list auto-refreshing | SATISFIED | ContainerList + EventSource; human-verify PASS; REQUIREMENTS.md marked `[x]` |
| LOGS-02 | 06-01, 06-02, 06-03 | Live-tailing log stream with backfill | SATISFIED | LogViewer WS + backfill; human-verify PASS; REQUIREMENTS.md marked `[x]` |
| LOGS-03 | 06-01, 06-03 | Auto-scroll with scroll-up pause | SATISFIED | 24px threshold + "Neueste anzeigen" pill; human-verify PASS; REQUIREMENTS.md marked `[x]` |
| LOGS-04 | 06-01, 06-02, 06-03 | `since=` time-window filter via preset chips | SATISFIED | SincePresetChips + server-side `parseSincePreset`; human-verify PASS; REQUIREMENTS.md marked `[x]` |

**No orphaned requirements.** LOGS-01..04 are the only Phase 6 requirements; all 4 satisfied.

### Anti-Patterns Found

None. No TODOs/FIXMEs/placeholders in any component file. No stub return patterns (`return null`, `return {}`, `return []` without data) in production paths. No hardcoded empty prop values at call sites. No polling anti-pattern (setInterval count=0 in ContainerList).

Notable clean-up items (informational only, not blockers):

| Item | Severity | Detail |
|------|----------|--------|
| Pre-existing `npm audit` vulnerabilities in web/ dep tree (5 vulns: 1 moderate, 4 high) | Info | Not introduced by Phase 6; logged as out-of-scope in Plan 01 SUMMARY. No Phase 6 dep is the root cause. |
| `docker-adapter.mjs` uses `.mjs` extension instead of `.ts` as originally planned | Info | Intentional deviation — `.mjs` is runtime-importable by `node:test` without a build step. `npx tsc --noEmit` passes clean. Documented in 06-02-SUMMARY §Deviations. |

### Human Verification

Completed as part of Phase 6 Plan 03, Task 3. Deployed to Pi (`10.10.40.23`) on 2026-04-15 ~20:30 local; all 6 verification items APPROVED.

Two defects caught and fixed during live verification:

1. `df2c02b` — `COMPOSE_PROJECT_NAME=mowbot` corrected from `mowerbot` (Pi clone lives in `~/mowbot`; label filter matched zero containers with wrong name).
2. `65ea79b` — `/logs/stream` allowlist now accepts container names (not only IDs); frontend passes names, fix resolves WS close-code `1008 unknown container`.

Both fixes are committed, pushed, and deployed. The approved human-verify outcomes are documented in `06-03-SUMMARY.md §Human-Verify Outcomes (Task 3 — APPROVED)`.

### Notes for Phase 7 / Phase 8

The following are not gaps but context useful to downstream phases:

- The `docker.sock :ro` mount on the `web` service is in place. Phase 7/8 do not need the logs infrastructure but should note the `:ro` constraint if they ever need to invoke Docker from the web container (they likely will not).
- The single `server.on("upgrade")` listener pattern is now locked by a live regression test. Any Phase 7/8 work that touches `server.mjs` must route through the existing path-dispatch branch — adding a second `server.on("upgrade")` call will break the Wave 0 test.
- The `COMPOSE_PROJECT_NAME=mowbot` correction (commit `df2c02b`) aligns the filter to the actual Pi directory name. Phase 7/8 plans that reference the Compose project name should use `mowbot`, not `mowerbot`.
- Pre-existing `npm audit` vulnerabilities (5, not from Phase 6 deps) remain unaddressed; worth a sweep before v2.2 ships.

---

## Summary

Phase 6 goal fully achieved. All 5 ROADMAP success criteria are observable and verified — both programmatically (11/11 Wave 0 tests green, TypeScript clean, no stub anti-patterns) and through human verification on real hardware (Pi @ 10.10.40.23, approved 2026-04-15). LOGS-01 through LOGS-04 are all satisfied and marked complete in REQUIREMENTS.md. The `/rosbridge` regression gate holds. No gaps, no deferred items within Phase 6 scope.

---

_Verified: 2026-04-15T20:45:00Z_
_Verifier: Claude (gsd-verifier)_
