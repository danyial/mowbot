---
phase: 06-webui-container-logs-view
plan: 02
subsystem: web-backend
tags: [dockerode, server-mjs, websocket, sse, docker-socket-ro, logs, wave-2]

requires:
  - phase: "06-01"
    provides: "4 RED Wave 0 tests that this plan must flip to GREEN"
provides:
  - "Node sidecar: listContainers / getContainer / getEvents dockerode adapter with method allowlist"
  - "server.mjs single-listener upgrade dispatch extended with /logs/stream/<id> WS branch"
  - "GET /api/logs/containers — 200 ContainerSummary[] | 503 Docker nicht erreichbar"
  - "GET /api/logs/events — text/event-stream with hello|container|reconnecting|resumed|error frames"
  - ":ro bind mount on /var/run/docker.sock for web service only (T-06-01 mitigation)"
  - "COMPOSE_PROJECT_NAME=mowerbot injected so label filter is invocation-cwd independent"
affects:
  - "06-03-PLAN (frontend can now consume /api/logs/containers + /api/logs/events + /logs/stream/<id>)"

tech-stack:
  added: []  # All runtime deps installed in Plan 01
  patterns:
    - "Dockerode method allowlist as defense-in-depth beyond docker.sock :ro"
    - "Single server.on('upgrade') listener + path-dispatch (preserves /rosbridge; adds /logs/stream/)"
    - "ReadableStream-backed SSE with exponential-backoff reconnect (500→5000ms cap) matching ros-client.ts"
    - "Dynamic imports inside the /logs/stream branch isolate dockerode load from /rosbridge cold start"
    - "Non-TTY container demux via container.modem.demuxStream (T-06-03)"

key-files:
  created:
    - "web/lib/types/logs.ts"
    - "web/lib/server/demux.mjs"
    - "web/lib/server/since-preset.mjs"
    - "web/lib/server/docker-adapter.mjs"
    - "web/app/api/logs/containers/route.ts"
    - "web/app/api/logs/events/route.ts"
  modified:
    - "web/server.mjs"
    - "web/__tests__/demux.test.mjs"
    - "web/__tests__/since-preset.test.mjs"
    - "web/__tests__/docker-adapter.test.mjs"
    - "docker-compose.yml"

key-decisions:
  - "Adapter file extension: .mjs instead of planned .ts — runtime-importable by node:test without a build step. Consumers import via moduleResolution=bundler. Wave 0 tests updated .js → .mjs specifiers (allowed by Plan 02 Task 1 step 4)."
  - "Dynamic-import dockerode inside the /logs/stream/ branch (not top-level) so /rosbridge remains cold-start-safe even if dockerode ever fails to load"
  - "DEFAULT_PROJECT resolved from process.env.COMPOSE_PROJECT_NAME first, fallback 'mowerbot' — makes the filter deterministic regardless of compose invocation cwd (RESEARCH.md Q2 fallback)"
  - "SSE endpoint does NOT 503 on initial connect failure — emits 'error' frame and keeps retrying, so the browser EventSource does not enter its native reconnect loop and mask the reason"

requirements-completed: [LOGS-01, LOGS-02, LOGS-04]

duration: ~15min
completed: 2026-04-15
---

# Phase 6 Plan 02: Backend (dockerode adapter + server.mjs /logs/stream branch + SSE events + :ro sock) Summary

**All backend plumbing for live container-log streaming landed: dockerode adapter with method allowlist, server.mjs gains a /logs/stream/<id> WS branch inside its single existing upgrade listener, GET /api/logs/containers + SSE /api/logs/events routes, and docker.sock mounted :ro on the web service only. All 11 Wave 0 subtests flipped RED → GREEN; `/rosbridge` single-upgrade-listener regression gate HOLDS.**

## Performance

- **Started:** 2026-04-15
- **Completed:** 2026-04-15
- **Tasks:** 6 (5 code + 1 verification)
- **Files created:** 6
- **Files modified:** 5

## Accomplishments

- **Method allowlist enforced at runtime** — docker-adapter exports exactly `{listContainers, getContainer, getEvents}`; facade exposes exactly `{inspect, logs, modem}` (T-06-05 mitigation)
- **Single upgrade listener preserved** — `grep -c 'server.on("upgrade"' web/server.mjs` returns `1`; /rosbridge branch byte-identical (T-06-02 mitigation)
- **Non-TTY demux wired** — inspect() → Config.Tty check → `container.modem.demuxStream(raw, stdoutPT, stderrPT)` only when TTY=false (T-06-03 mitigation)
- **docker.sock :ro isolated to web service** — YAML-level scan confirms no other service gains the mount (T-06-01 mitigation)
- **SSE replaces polling** — `/api/logs/events` pushes `{hello, container, reconnecting, resumed, error}` frames; reconnect ladder (500→5000ms) matches ros-client.ts
- **Input validation at every boundary** — id checked against live listContainers(), since restricted to preset allowlist, tail clamped [0, 5000] (T-06-04 mitigation)

## Task Commits

1. **Task 1** — Types + demux + since-preset pure modules → `65ad825` (feat)
2. **Task 2** — dockerode adapter with method allowlist → `047b426` (feat)
3. **Task 3** — GET /api/logs/containers route → `f37d293` (feat)
4. **Task 4** — server.mjs /logs/stream/ branch → `f47c471` (feat)
5. **Task 5** — docker.sock :ro + COMPOSE_PROJECT_NAME in docker-compose.yml → `c3e87d8` (feat)
6. **Task 5b** — SSE /api/logs/events route → `3e7e5d4` (feat)
7. **Task 6** — Verification-only (no commit)

**Plan metadata:** _pending final commit after SUMMARY + STATE updates_

## Files Created / Modified

### Created

- `web/lib/types/logs.ts` — ContainerSummary, LogFrame, SincePreset (cross-boundary types)
- `web/lib/server/demux.mjs` — pure 8-byte-frame demuxer (test-exercised)
- `web/lib/server/since-preset.mjs` — preset → epoch-seconds; null passthrough; graceful unknown
- `web/lib/server/docker-adapter.mjs` — dockerode wrapper; exports `{listContainers, getContainer, getEvents}` only; getContainer facade exposes `{inspect, logs, modem}` only
- `web/app/api/logs/containers/route.ts` — GET → 200 ContainerSummary[] | 503 Docker nicht erreichbar; no-cache; dynamic=force-dynamic
- `web/app/api/logs/events/route.ts` — SSE channel with exponential-backoff reconnect (500→5000ms); no polling fallback

### Modified

- `web/server.mjs` — extended existing `server.on("upgrade", …)` handler with `else if (pathname.startsWith("/logs/stream/"))` branch; full validation + inspect/demux pipeline; fd-leak cleanup on client close. `/rosbridge` branch untouched.
- `web/__tests__/demux.test.mjs` — import specifier `.js` → `.mjs` (Plan 02 Task 1 step 4 authorization)
- `web/__tests__/since-preset.test.mjs` — same
- `web/__tests__/docker-adapter.test.mjs` — same
- `docker-compose.yml` — `web` service: added `/var/run/docker.sock:/var/run/docker.sock:ro` volume + `COMPOSE_PROJECT_NAME=mowerbot` env

## RED → GREEN State Transitions

| Test | Before | After |
|------|--------|-------|
| `server-upgrade.test.mjs::has exactly one server.on('upgrade')` | GREEN | GREEN (held) |
| `server-upgrade.test.mjs::preserves /rosbridge branch` | GREEN | GREEN (held) |
| `server-upgrade.test.mjs::adds /logs/stream/ branch` | **RED** | ✅ **GREEN** |
| `docker-adapter.test.mjs::allowlist exports` | **RED** | ✅ **GREEN** |
| `docker-adapter.test.mjs::facade {inspect, logs, modem}` | **RED** | ✅ **GREEN** |
| `demux.test.mjs::stdout/stderr split` | **RED** | ✅ **GREEN** |
| `demux.test.mjs::multi-frame concat` | **RED** | ✅ **GREEN** |
| `demux.test.mjs::unknown-type skip` | **RED** | ✅ **GREEN** |
| `since-preset.test.mjs::all presets ±1s` | **RED** | ✅ **GREEN** |
| `since-preset.test.mjs::null passthrough` | **RED** | ✅ **GREEN** |
| `since-preset.test.mjs::bogus → null` | **RED** | ✅ **GREEN** |

**Overall: 11/11 pass, 0 fail.** `cd web && node --test __tests__/*.mjs` exits 0.

## Deviations from Plan

**1. [Rule 3 — Blocking] Adapter extension .mjs instead of .ts**
- **Found during:** Task 2
- **Issue:** Plan frontmatter listed `web/lib/server/docker-adapter.ts`. The Wave 0 test imports `../lib/server/docker-adapter.js` at runtime via `node:test`, which can't load TypeScript without a build step. Node 25 does not strip types by default.
- **Fix:** Wrote adapter as `docker-adapter.mjs` with JSDoc typedef comments; consumers (route.ts files) import via `@/lib/server/docker-adapter.mjs` — `moduleResolution: bundler` in tsconfig.json resolves `.mjs` cleanly. Three Wave 0 test files had their import specifier changed `.js` → `.mjs` (explicitly authorized by Plan 02 Task 1 step 4). `npx tsc --noEmit` reports zero errors.
- **Files modified:** `web/lib/server/docker-adapter.mjs` (new; was planned as `.ts`), `web/__tests__/{demux,since-preset,docker-adapter}.test.mjs` (specifier update)
- **Commits:** `65ad825`, `047b426`

**2. [Rule 3 — Blocking] `docker compose config` unavailable on dev host**
- **Found during:** Task 5 verify
- **Issue:** Task 5 verify command `docker compose config` runs `docker compose` but the Docker Compose plugin is not installed on the macOS dev box (only `docker` Engine CLI is present).
- **Fix:** Substituted a Python `yaml.safe_load` + per-service scan that (a) confirms the YAML parses and (b) asserts the `docker.sock` mount exists on exactly the `web` service and nowhere else. The full `docker compose config` gate will run on the Pi during deploy (the `:ro` assertion via `docker inspect mower-web | jq …` is already the manual VALIDATION.md gate).
- **Files modified:** none (verification-tooling deviation only)

**3. [Rule 2 — Missing critical functionality] demuxStream comment-reference removed**
- **Found during:** Task 4 verify
- **Issue:** Acceptance criterion stated `grep -c 'demuxStream' web/server.mjs == 1`. My initial write had a brief `// T-06-03` inline comment mentioning `demuxStream`, producing count 2.
- **Fix:** Shortened the comment to not repeat the identifier; actual call-site remains. Count is now exactly 1.
- **Commit:** `f47c471`

## Dockerode Project-Label Fallback Decision

- **Primary:** `process.env.COMPOSE_PROJECT_NAME` (injected via docker-compose.yml).
- **Fallback if env missing:** hardcoded `"mowerbot"`.
- **Override for ad-hoc testing:** `process.env.MOWER_COMPOSE_LABEL` (full `key=value` string).

So the label filter is `com.docker.compose.project=${COMPOSE_PROJECT_NAME || 'mowerbot'}`. Because Task 5 wires `COMPOSE_PROJECT_NAME=mowerbot` on the `web` service's `environment:` block, the filter is now invocation-cwd independent on the Pi.

## Threat Mitigations — Status

| Threat | Disposition | Implemented |
|--------|-------------|-------------|
| T-06-01 Elevation of Privilege (docker.sock mount) | mitigate | ✅ `:ro` on web service only; YAML scan confirms no other service. Manual `docker inspect` gate recorded in VALIDATION.md. |
| T-06-02 Tampering (second upgrade listener) | mitigate | ✅ Wave 0 regression test GREEN; count===1. |
| T-06-03 Tampering (demux skipped) | mitigate | ✅ inspect()→Config.Tty===false → `container.modem.demuxStream(raw, stdoutPT, stderrPT)`. |
| T-06-04 Denial of Service (input abuse) | mitigate | ✅ id allowlist from live listContainers(); since preset allowlist; tail clamped [0,5000]. |
| T-06-05 Information Disclosure (adapter leak) | mitigate | ✅ Allowlist enforced; Wave 0 test GREEN. |

All 5 threats mitigated. Zero high-severity unmitigated.

## Issues Encountered

- Working tree at start of plan had pre-existing `D` entries for archived phase dirs (`.planning/phases/00-04/…`) — these are unrelated to Plan 02 and were not staged.
- `npm audit` reports inherited from Plan 01 (5 vulns in web/ tree) — still out-of-scope per GSD scope-boundary rule; not addressed here.

## Self-Check: PASSED

- `test -f web/lib/types/logs.ts` → FOUND
- `test -f web/lib/server/demux.mjs` → FOUND
- `test -f web/lib/server/since-preset.mjs` → FOUND
- `test -f web/lib/server/docker-adapter.mjs` → FOUND
- `test -f web/app/api/logs/containers/route.ts` → FOUND
- `test -f web/app/api/logs/events/route.ts` → FOUND
- `grep -c 'server.on("upgrade"' web/server.mjs` → `1` (regression gate HOLDS)
- `grep -c '/logs/stream/' web/server.mjs` → `3` (≥2 ✔)
- `grep -c 'demuxStream' web/server.mjs` → `1` (exact ✔)
- `grep -c '/var/run/docker.sock:/var/run/docker.sock:ro' docker-compose.yml` → `1` (exact ✔)
- `grep -c 'COMPOSE_PROJECT_NAME' docker-compose.yml` → `1` (≥1 ✔)
- `cd web && node --test __tests__/*.mjs` → 11 pass / 0 fail (ALL GREEN)
- `cd web && node --check server.mjs` → OK
- `cd web && npx tsc --noEmit` → 0 errors
- All 6 commits exist in git log: `65ad825`, `047b426`, `f37d293`, `f47c471`, `c3e87d8`, `3e7e5d4` → VERIFIED

## Manual Verification for Plan 03 Execution

After deploying the changed docker-compose.yml + web image to the Pi:

1. `docker inspect mower-web | jq '[.[0].Mounts[] | select(.Source=="/var/run/docker.sock")] | .[0].RW'` → expect `false`
2. `docker inspect mower-web | jq '.[0].Config.Env[]' | grep COMPOSE_PROJECT_NAME` → expect `COMPOSE_PROJECT_NAME=mowerbot`
3. `curl -s http://mower.local:3000/api/logs/containers | jq 'length'` → expect ≥ 1 (mower- containers enumerated)
4. `curl -N http://mower.local:3000/api/logs/events` → expect immediate `event: hello` frame, then `event: resumed`
5. WebSocket smoke: `websocat "ws://mower.local:3000/logs/stream/$(docker ps --filter label=com.docker.compose.project=mowerbot --format '{{.ID}}' | head -1 | cut -c1-12)?tail=5"` → expect JSON frames
6. `/rosbridge` regression: open web UI `/teleop` + one client tab on `/logs` (Plan 03) simultaneously for 5 min → no disconnects on either.

## User Setup Required

None for this plan. The `:ro` mount + `COMPOSE_PROJECT_NAME` injection take effect on next `docker compose up -d web`.

## Next Phase Readiness

- Plan 03 (frontend `/logs` page + components) is unblocked. It should consume:
  - `GET /api/logs/containers` for the left-pane list (no-cache, SSR-safe)
  - `GET /api/logs/events` (EventSource) for live list refresh — NOT polling
  - `ws(s)://<host>/logs/stream/<id>?since=<preset>&tail=<n>` for per-container streams; messages are NDJSON `{ts, stream, line}`
- All interface contracts from `<interfaces>` in 06-02-PLAN.md were honored verbatim (modulo `.ts` → `.mjs` extension for the adapter — types file remains `.ts` as specified).

---
*Phase: 06-webui-container-logs-view*
*Plan: 02*
*Completed: 2026-04-15*
