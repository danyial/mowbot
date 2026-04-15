---
phase: 06-webui-container-logs-view
plan: 03
subsystem: web-frontend
tags: [nextjs, react, zustand, websocket, eventsource, ansi-to-html, sse, radix-dialog, wave-3]

requires:
  - phase: "06-02"
    provides: "GET /api/logs/containers, SSE /api/logs/events, WS /logs/stream/<id>"
provides:
  - "/logs route (client-only, dynamic import with ssr:false)"
  - "<LogViewer> with WS 500→5000ms backoff, ANSI render (escapeXML:true + stream:true), 24px scroll-pause, 10k ring buffer"
  - "<ContainerList> with one-shot hydrate + EventSource live updates (no polling timers)"
  - "<SincePresetChips> (1m/5m/15m/1h/6h/24h + 'Alle' clear)"
  - "<ConnectionBadge> (live/reconnecting/stopped per UI-SPEC state table)"
  - "useLogsStore: selectedContainerId / sincePreset / connectionState"
  - "Sidebar + mobile-nav: /logs entry with lucide ScrollText icon"
affects:
  - "next.config.mjs (serverExternalPackages added for dockerode build-fix — benefits all future dockerode consumers)"

tech-stack:
  added:
    - "ansi-to-html@^0.7.2 (already installed Plan 01 — first active use here)"
    - "@types/ansi-to-html (local shim — no npm package exists): web/types/ansi-to-html.d.ts"
  patterns:
    - "Dynamic-import page wrapper (analog: lidar/page.tsx) for WS-dependent children"
    - "Ring buffer in useRef<RenderedRow[]> (never in Zustand) to avoid 100 lines/s re-render storm"
    - "EventSource-only live refresh — no setInterval polling fallback in ContainerList"
    - "serverExternalPackages for Turbopack to skip bundling dockerode's native-crypto transitive deps"

key-files:
  created:
    - "web/lib/store/logs-store.ts"
    - "web/components/logs/container-list.tsx"
    - "web/components/logs/since-preset-chips.tsx"
    - "web/components/logs/connection-badge.tsx"
    - "web/components/logs/log-viewer.tsx"
    - "web/app/logs/page.tsx"
    - "web/types/ansi-to-html.d.ts"
  modified:
    - "web/components/layout/sidebar.tsx"
    - "web/components/layout/mobile-nav.tsx"
    - "web/next.config.mjs"
    - "web/app/api/logs/containers/route.ts"
    - "web/app/api/logs/events/route.ts"

key-decisions:
  - "Ring buffer in a component-local useRef — NOT in Zustand — so the store doesn't re-render at 100 lines/s (CONTEXT.md §Claude's Discretion; scan-store.ts discipline)"
  - "Converter instance recreated on container switch — palette state deliberately does NOT bleed across streams; within a stream stream:true preserves state across chunks"
  - "Turbopack build-fix landed here (Rule 3) even though root cause is Plan 02 code, because Task 2 acceptance requires 'npm run build' exits 0 and Plan 02 never ran it"
  - "ansi-to-html type shim authored locally (web/types/ansi-to-html.d.ts) — the npm package has no official @types and the project already has a nipplejs shim as precedent"

requirements-completed: [LOGS-01, LOGS-02, LOGS-03, LOGS-04]

duration: ~25min
completed: 2026-04-15
---

# Phase 6 Plan 03: Frontend `/logs` route + LogViewer + nav Summary

**Operator-facing `/logs` shipped: two-pane viewer with live container list, WS log stream with ANSI colors + scroll-pause + 10k ring buffer, preset chip since-filter, reconnect badge, and nav integration. TypeScript + Wave 0 tests + `npm run build` all green. 6 ROADMAP Phase 6 success criteria pending human-verify on real hardware (Task 3 checkpoint).**

## Performance

- **Started:** 2026-04-15
- **Completed:** 2026-04-15 (pending human-verify outcomes)
- **Tasks:** 3 (2 code + 1 blocking checkpoint)
- **Files created:** 7
- **Files modified:** 5

## Accomplishments

- **Live container list** with one-shot `/api/logs/containers` hydrate + `EventSource('/api/logs/events')` push updates — **NO setInterval, NO polling** (hard anti-pattern gate)
- **Per-container log stream** via `ws(s)://<host>/logs/stream/<id>?since=<preset>&tail=200` with exponential backoff 500→5000 ms matching rosbridge cadence
- **ANSI rendering** via `new Convert({ escapeXML: true, stream: true })` — T-06-04 XSS mitigation (HTML-escape BEFORE emitting color spans)
- **Auto-scroll with 24 px pause threshold** — scroll-up pauses + shows "Neueste anzeigen" pill; pill click or scroll-to-bottom resumes
- **Ring buffer** in `useRef<RenderedRow[]>` capped at 10 000 lines (never in Zustand) so 100 lines/s doesn't re-render the store
- **Preset chip re-backfill**: selecting 1m/5m/15m/1h/6h/24h closes current WS and opens a new one with `since=<preset>`; "Alle" clears
- **Mobile drawer** via Radix `Dialog` with `Menu` trigger carrying `aria-label="Container-Liste öffnen"` (a11y non-negotiable)
- **Nav entry** added to both sidebar.tsx and mobile-nav.tsx (lucide `ScrollText`, German label "Logs")
- **Production build fixed** (Rule 3) — `serverExternalPackages` in `next.config.mjs` for `dockerode`, `docker-modem`, `ssh2`, `cpu-features`; `/logs` now lists as `○ (Static)` client page in the build output

## Task Commits

1. **Task 1** — Zustand store + ContainerList + SincePresetChips + ConnectionBadge → `b41f15c` (feat)
2. **Task 2** — LogViewer + `/logs` page + nav integration + build fix → `0946a0c` (feat)
3. **Task 3** — Human-verify checkpoint (no commit — pending operator sign-off)

**Plan metadata:** _pending final commit after SUMMARY + STATE updates + human-verify approval_

## Files Created / Modified

### Created

- `web/lib/store/logs-store.ts` — `useLogsStore` (selectedContainerId / sincePreset / connectionState); no persistence layer, no timers, no line buffer (analog: scan-store.ts)
- `web/components/logs/container-list.tsx` — left pane; one-shot `/api/logs/containers` hydrate + `EventSource('/api/logs/events')` live updates; Docker-unreachable banner with `AlertTriangle` + German copy on 503; row status dots (`bg-primary` running / `bg-muted-foreground` exited); active row `bg-primary/10 text-primary` matching sidebar convention
- `web/components/logs/since-preset-chips.tsx` — 6 preset buttons in `role="group" aria-label="Zeitfenster"` with `aria-pressed`; ghost "Alle" clear button visible only when a preset is active
- `web/components/logs/connection-badge.tsx` — live/reconnecting/stopped dot + German label + `role="status"`; amber-500 `animate-pulse` + Loader2 `animate-spin` only on reconnecting
- `web/components/logs/log-viewer.tsx` — WS client with 500→5000 ms backoff, Radix Dialog drawer on mobile, ring buffer (10 000 lines), 24 px scroll-pause, ANSI render via `ansi-to-html` with `escapeXML: true` + `stream: true`, stderr `border-l-2 border-destructive/60`, system rows in italic muted, `role="log"` + `aria-live="polite"` only when auto-scrolling
- `web/app/logs/page.tsx` — client-only page; dynamic import `ssr: false` with German "Logs werden geladen…" loading text (verbatim lidar/page.tsx pattern)
- `web/types/ansi-to-html.d.ts` — local module declaration (no official `@types` package); precedent: `web/types/nipplejs.d.ts`

### Modified

- `web/components/layout/sidebar.tsx` — added `ScrollText` import + `{ href: "/logs", label: "Logs", icon: ScrollText }` between `/lidar` and `/teleop`
- `web/components/layout/mobile-nav.tsx` — same one-line insertion
- `web/next.config.mjs` — `serverExternalPackages: ['dockerode','docker-modem','ssh2','cpu-features']` (Rule 3 build-fix)
- `web/app/api/logs/containers/route.ts` — added `export const runtime = "nodejs"` for documentation (defense-in-depth with the serverExternalPackages fix)
- `web/app/api/logs/events/route.ts` — same

## Verification (Automated — Green)

- `cd web && node --test __tests__/*.mjs` → **11 / 11 pass** (Wave 0 regression gate HOLDS)
- `grep -c 'server.on("upgrade"' web/server.mjs` → **1** (single upgrade listener invariant HOLDS)
- `grep -c 'escapeXML: *true' web/components/logs/log-viewer.tsx` → **1** (T-06-04 XSS mitigation present)
- `grep -c 'stream: *true' web/components/logs/log-viewer.tsx` → **1**
- `grep -c 'INITIAL_RECONNECT_DELAY *= *500' web/components/logs/log-viewer.tsx` → **1**
- `grep -c 'MAX_RECONNECT_DELAY *= *5000' web/components/logs/log-viewer.tsx` → **1**
- `grep -c 'scrollHeight - 24' web/components/logs/log-viewer.tsx` → **1**
- `grep -c '10000' web/components/logs/log-viewer.tsx` → **2** (MAX_LINES constant + comment ref)
- `grep -c 'setInterval' web/components/logs/container-list.tsx` → **0** (events-only — no polling)
- `grep -c 'EventSource' web/components/logs/container-list.tsx` → **3**
- `grep -c '/api/logs/events' web/components/logs/container-list.tsx` → **2**
- `grep -c '/api/logs/containers' web/components/logs/container-list.tsx` → **2**
- `grep -c 'persist\|localStorage' web/lib/store/logs-store.ts` → **0** (no storage)
- `grep -cE '#[0-9a-fA-F]{3,6}' web/components/logs/*.tsx` → **0** (tokens only)
- `grep -cE 'xterm|react-window|toast' web/components/logs/log-viewer.tsx` → **0** (UI-SPEC non-goals absent)
- `grep -c 'ScrollText' web/components/layout/sidebar.tsx` → **2**; `grep -c '"/logs"' web/components/layout/sidebar.tsx` → **1**; same for mobile-nav.tsx
- `grep -c 'Logs werden geladen' web/app/logs/page.tsx` → **1**; `grep -c 'ssr: *false' web/app/logs/page.tsx` → **1**
- `cd web && npx tsc --noEmit` → **0 errors**
- `cd web && npm run build` → **exit 0**; `/logs` listed as `○ (Static)` in the build output

## Deviations from Plan

**1. [Rule 3 — Blocking] Production build regression from Plan 02 — added `serverExternalPackages`**
- **Found during:** Task 2 verify (`npm run build` step)
- **Issue:** Turbopack failed bundling `ssh2/lib/protocol/crypto.js` — pulled in transitively via `dockerode → docker-modem → ssh2`. Import trace started at `app/api/logs/events/route.ts` (Plan 02 file). Plan 02's self-check ran `node --check server.mjs` + `npx tsc --noEmit` but did NOT run `npm run build`, so this regression shipped hidden.
- **Fix:** Added `serverExternalPackages: ['dockerode', 'docker-modem', 'ssh2', 'cpu-features']` to `web/next.config.mjs`. Turbopack now externalizes these — they resolve at Node runtime from `node_modules`, never entering the bundler. Build passes, `/logs` listed as `○ (Static)`. Also added `export const runtime = "nodejs"` to both `/api/logs/{containers,events}/route.ts` as documentation (belt-and-suspenders; the serverExternalPackages fix alone is sufficient).
- **Files modified:** `web/next.config.mjs`, `web/app/api/logs/containers/route.ts`, `web/app/api/logs/events/route.ts`
- **Commit:** `0946a0c`
- **Scope justification:** Task 2 acceptance criteria explicitly require `npm run build` exits 0, so this fix is in-scope for Plan 03 regardless of where the root cause landed.

**2. [Rule 3 — Blocking] `@types/ansi-to-html` does not exist on npm — local shim authored**
- **Found during:** Task 2 initial write
- **Issue:** `ansi-to-html` ships no types; the package has no `@types/ansi-to-html` on DefinitelyTyped. TypeScript would fail on `import Convert from "ansi-to-html"` without a declaration.
- **Fix:** Authored `web/types/ansi-to-html.d.ts` with `declare module` block — same pattern the repo already uses for `nipplejs` (see `web/types/nipplejs.d.ts`). Exposes `Convert` class + `ConvertOptions` interface (including `escapeXML` and `stream` flags used by Plan 03).
- **Commit:** `0946a0c`

**3. [Rule 1 — Micro-fix] Forbidden substrings in comments**
- **Found during:** Task 1 verify
- **Issue:** Grep gates `grep -c 'setInterval' ...` and `grep -c 'persist\|localStorage' ...` use substring matching — my initial comments mentioned these terms by name (e.g. "No setInterval. No polling."). Count returned 2 and 1 respectively; spec required 0.
- **Fix:** Rephrased comments to avoid the literal tokens ("No polling timers" instead of "No setInterval. No polling."; "no storage layer" instead of "no persistence"). Functional behavior unchanged.
- **Commit:** `b41f15c` (amended in the same write — no separate commit)

**4. [Rule 1 — Micro-fix] `SCROLL_THRESHOLD` constant replaced with literal `24`**
- **Found during:** Task 2 verify
- **Issue:** I initially used `const SCROLL_THRESHOLD = 24` and referenced it in the scroll comparison. Spec requires the literal pattern `scrollHeight - 24` to be greppable in the source (UI-SPEC lock + acceptance criterion).
- **Fix:** Inlined the `24` literal. Behavior unchanged; the constant was only DRY sugar.
- **Commit:** `0946a0c`

## Threat Mitigations — Status

| Threat | Disposition | Implemented |
|--------|-------------|-------------|
| T-06-04 (XSS via crafted ANSI log line) | mitigate | ✅ `new Convert({ escapeXML: true, stream: true })` — every frame's `line` is HTML-escaped BEFORE color span emission. `escapeXML: true` present exactly once in log-viewer.tsx. |
| T-06-06 (DoS via unbounded buffer) | mitigate | ✅ Ring buffer capped at `MAX_LINES = 10000` in `useRef<RenderedRow[]>`; oldest lines evicted via `splice(0, buf.length - MAX_LINES)`. Not in Zustand — no re-render storm. |
| T-06-07 (WS hijack via tampered window.location.host) | accept | As planned — same-origin WS, trusted-LAN per PROJECT.md. |
| T-06-02 (second upgrade listener) | mitigate | ✅ Client-only code; `grep -c 'server.on("upgrade"' web/server.mjs` still `1` (Wave 0 regression test GREEN). |

All 4 threats in this plan's register handled. Zero high-severity unmitigated.

## Known Stubs

None — every component renders real data (hydrate from `/api/logs/containers`, live from `/api/logs/events`, WS frames from `/logs/stream/<id>`).

## Human-Verify Outcomes (Task 3 — PENDING)

> **Checkpoint not yet run.** This section will be filled after the operator deploys to the Pi and runs the 6 verification items below. The plan is NOT complete until this section records `approved`.

### Verification items (from PLAN 06-03 Task 3)

1. **LOGS-01 — live container list** — _pending_ — navigate to `/logs`, confirm mower containers visible with image tags + status dots; `docker stop` a container → row flips gray or disappears within 5 s; `docker start` → row returns green within 5 s.
2. **LOGS-02 — backfill + live tail** — _pending_ — click a talkative container (rosbridge/slam), confirm ≤500 ms first paint; tail=200 backfill visible; new lines stream; timestamps `HH:MM:SS.sss`; no garbled bytes at line start (demux OK); ANSI colors render where source emits them.
3. **LOGS-03 — auto-scroll + pause-on-scroll-up** — _pending_ — busy container follows bottom automatically; scroll up stops it + shows "Neueste anzeigen" pill (green outline, ArrowDown); scroll to bottom resumes; pill click smooth-scrolls to bottom + resumes.
4. **LOGS-04 — since= preset re-backfill** — _pending_ — click `5m` chip → chip turns green, stream re-opens, content re-populates from last ~5 min, live tail continues; "Alle" ghost button appears; click `1h` → re-backfill; click "Alle" → back to default tail.
5. **/rosbridge REGRESSION GATE** — _pending_ — with `/logs` streaming in Tab A, open `/teleop` in Tab B; confirm rosbridge green + joystick drives motors; leave both tabs 5 min → neither drops; on Pi `grep -c 'server.on("upgrade"' /app/server.mjs` returns `1`.
6. **Security gate — :ro mount** — _pending_ — `docker inspect mower-web | jq '[.[0].Mounts[] | select(.Source=="/var/run/docker.sock")] | .[0].RW'` returns `false`.

**Resume signal:** operator types "approved — LOGS-01..04 all observed, /rosbridge regression gate holds, :ro mount confirmed" OR a precise description of any failing item.

## Next Phase Readiness

- Phase 6 complete after operator sign-off. REQUIREMENTS.md LOGS-01..04 flip to `done`; ROADMAP.md Phase 6 checkbox ticks.
- Phase 7 (SLAM Pose → EKF Yaw Fusion) unblocked — no hard dependency on Phase 6 artifacts; the soft dependency was "operator can see container logs while bringing up yaw fusion" and that is now deliverable.

## Self-Check: PASSED (automated) — PENDING (human-verify)

**Automated (all complete before checkpoint):**
- `test -f web/lib/store/logs-store.ts` → FOUND
- `test -f web/components/logs/container-list.tsx` → FOUND
- `test -f web/components/logs/since-preset-chips.tsx` → FOUND
- `test -f web/components/logs/connection-badge.tsx` → FOUND
- `test -f web/components/logs/log-viewer.tsx` → FOUND
- `test -f web/app/logs/page.tsx` → FOUND
- `test -f web/types/ansi-to-html.d.ts` → FOUND
- Commit `b41f15c` in git log → VERIFIED
- Commit `0946a0c` in git log → VERIFIED
- `cd web && node --test __tests__/*.mjs` → 11/11 pass
- `cd web && npx tsc --noEmit` → 0 errors
- `cd web && npm run build` → exit 0

**Human-verify:** PENDING (Task 3 checkpoint below).

---
*Phase: 06-webui-container-logs-view*
*Plan: 03*
*Draft completed: 2026-04-15 — awaiting Task 3 human-verify outcomes*
