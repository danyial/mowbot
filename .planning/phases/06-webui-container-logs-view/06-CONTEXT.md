# Phase 6: WebUI Container-Logs View — CONTEXT

**Phase:** 6 — WebUI Container-Logs View
**Milestone:** v2.2 Ops & Fusion Polish
**Requirements:** LOGS-01, LOGS-02, LOGS-03, LOGS-04

<canonical_refs>

- `.planning/PROJECT.md` — Current Milestone v2.2, constraints (Next.js 16 App Router, `server.mjs` single-upgrade-handler pattern must preserve `/rosbridge`)
- `.planning/REQUIREMENTS.md` — LOGS-01..04 + explicit Out-of-Scope (lifecycle buttons, shell-exec, merged multi-container tail)
- `.planning/ROADMAP.md` — Phase 6 success criteria (5 observable behaviors incl. `/rosbridge` regression gate)
- `.planning/research/STACK.md` — `dockerode@^4.0.10` recommendation, `container.modem.demuxStream()` required for non-TTY ROS containers (8-byte-header framing)
- `.planning/research/FEATURES.md` — Dozzle reference product; table-stakes = list + live-tail + backfill + auto-scroll-with-pause + timestamps + since-filter; anti-features named explicitly
- `.planning/research/ARCHITECTURE.md` — Logs sidecar lives inside existing `web` container; extend existing `server.on('upgrade')` with path dispatch; `docker.sock:ro` mount on `web` service only
- `.planning/research/PITFALLS.md` — docker.sock RW = host root; demux-skip = garbled output; second `server.on('upgrade')` listener shadows `/rosbridge`
- `web/server.mjs` — reference WebSocket-proxy pattern (existing `/rosbridge` upgrade handler at line 66; NaN scrubber layer; exponential-backoff reconnect reference in rosbridge client)
- Dozzle docs (https://dozzle.dev/) — UX reference for container-logs viewer

No external ADRs exist; project-level decisions are authoritative via PROJECT.md + REQUIREMENTS.md.

</canonical_refs>

<scope>

**In scope:**
- Next.js `/logs` route (App Router, client-side viewer)
- New WS path `/logs/stream/:name` dispatched from `server.mjs`'s existing single upgrade handler
- Node sidecar using `dockerode@^4.0.10` over read-only `docker.sock` bind mount on the `web` service
- Container list sourced by Docker Compose project label, refreshed via dockerode events stream
- Backfill + since-filter with preset chips (1m / 5m / 15m / 1h / 6h / 24h) and 200-line default tail
- Auto-scroll with pause-on-manual-scroll-up
- Auto-reconnect with visible connection-state badge (green/yellow/red)
- ANSI color rendering client-side
- `/rosbridge` regression preserved (single upgrade handler, path dispatch)

**Out of scope (REQUIREMENTS.md — do NOT implement):**
- Container lifecycle buttons (start / stop / restart)
- Shell-exec into containers
- Multi-container merged log tail
- Log download-to-file, grep/search, log-level highlight rule engine — Future
- ANSI-driven interactive UI (xterm.js) — defer; ansi-to-html is sufficient for v2.2

</scope>

<decisions>

### Architecture (locked by research, confirmed)

1. **Logs sidecar lives inside the existing `web` container.** No new Docker service. Reuses Node runtime + `server.mjs`.
2. **Docker socket mounted read-only** on the `web` service: `/var/run/docker.sock:/var/run/docker.sock:ro`. Only the `web` service gets this mount.
3. **Dockerode method allowlist at the Node layer:** only `container.list()`, `container.logs()`, `container.inspect()`, and the events stream are exposed. Wrap dockerode in a thin adapter that refuses any other method — defense-in-depth even though `:ro` is the primary boundary.
4. **Single `server.on('upgrade')` handler, path dispatch.** Extend the existing rosbridge upgrade handler with a second branch for `/logs/stream/:name`. Do NOT add a second `server.on('upgrade')` listener — it would fire for every upgrade including `/rosbridge` and shadow behavior.
5. **Non-TTY log demux** is mandatory: for each container, `container.inspect()` first to read `Config.Tty`; if `false` (true for every ROS2 container in this stack), pipe through `container.modem.demuxStream(raw, stdoutPassthrough, stderrPassthrough)` to strip Docker's 8-byte stream-header framing before forwarding to the WS client.

### Container set & refresh (decided)

- **Filter:** only containers with label `com.docker.compose.project=mowerbot` (or whatever Compose project name resolves to — verify at plan time; if Compose version-varies, fall back to `com.docker.compose.service` presence).
- **Refresh mechanism:** subscribe to dockerode events (`docker events --filter 'type=container'`) for instant add/remove; list is an in-memory map keyed by container ID, hydrated once on startup and updated on `start`/`die`/`destroy` events.
- **No polling fallback** — events are reliable on a single host. If the events stream dies, reconnect it (same exponential-backoff pattern as the WS reconnect on the client side).

### Backfill + since-filter semantics (decided)

- **Default view:** `tail=200` with no `since=` filter. Fast first paint.
- **Preset chips:** `1m` `5m` `15m` `1h` `6h` `24h` (six buttons). Selecting a preset switches the stream to `since=<t>` and re-backfills from that point; live-tail continues from now.
- **Stream lifecycle on filter change:** close current WS, open new one with updated query. Acceptable — Docker's `logs` API can't mid-stream re-scope a since window.
- **No freeform duration input in v2.2.** Presets cover operator scenarios during yaw-fusion debugging and map-reset testing.
- **Server-side `since=` translation:** accept the preset string client-side, map to epoch-seconds in the Node sidecar before calling `container.logs({ since, tail, timestamps: true, follow: true, stdout: true, stderr: true })`.

### Viewer UI & layout (decided)

- **Layout:** two-pane split. Left pane (fixed ~280 px, collapsible on mobile to a drawer): container list with name, short image tag, status dot (green running / gray exited), click-to-select. Right pane: monospace log stream.
- **Right pane header:** container-name badge + status dot, connection-state badge (live / reconnecting / stopped), preset-chip row for since-filter, "Resume auto-scroll" pill (shown only when auto-scroll is paused).
- **Row format:** `[HH:MM:SS.sss] <line>`. Timestamps come from Docker (`timestamps: true`); no client-side clock math. Gutter styled faint (text-slate-400) so the eye reads the line content.
- **ANSI colors:** render, don't strip. Use `ansi-to-html` (~4 KB) in the client; run incoming log chunks through the converter before appending to the DOM. Sanitize the resulting HTML against XSS — `ansi-to-html` output is safe by default (it only emits `<span style="color:#..">`), but wrap in a small allowlist DOMParser check to be paranoid.
- **Scroll behavior:** auto-scroll to bottom on new line; detect manual scroll-up (scrollTop + clientHeight < scrollHeight − threshold) and pause auto-scroll until user either clicks "Resume auto-scroll" pill or scrolls back to the bottom.
- **Empty state:** "No container selected — pick one on the left" (desktop) or equivalent on mobile.
- **Loading state:** while WS is connecting and before first message, show a single-line "Connecting to <container>…" skeleton.
- **Error state:** WS close with non-normal code → auto-reconnect badge transitions; if container was destroyed, show "Container no longer exists — reselect from the list".

### Reconnect & failure UX (decided)

- **Reconnect policy:** exponential backoff starting at 500 ms, doubling to 5000 ms cap. Matches the existing rosbridge client's reconnect pattern. Resets on a successful open.
- **State badge:** three states displayed in the viewer header:
  - **live** (green dot) — WS open, messages flowing
  - **reconnecting** (yellow dot with spinner) — WS closed unexpectedly, backoff timer running
  - **stopped** (red dot) — terminal failure (container destroyed, docker.sock unreachable, or user closed)
- **Container restart:** Docker's logs stream closes when the container restarts; client observes close, reconnects, server re-issues the log stream which will show the new container's output from start. No user action required.
- **docker.sock unreachable:** Node sidecar tries dockerode events reconnect every 2 s; while down, the HTTP `/api/logs/containers` list endpoint returns 503, the `/logs` page shows an inline "Docker daemon unreachable — retrying" banner.
- **No floating toasts for transient disconnects** — inline state badge only. Operator should never be interrupted by a modal/toast during yaw-fusion debugging.

### Routing & nav integration

- Add `/logs` to the app sidebar/nav (same pattern as existing routes: dashboard, map, teleop, missions, settings, lidar). Icon: lucide `ScrollText` or `Terminal`.
- Route file: `web/app/logs/page.tsx`.
- API surface:
  - `GET /api/logs/containers` — list containers (SSR-safe, no-cache)
  - `WS /logs/stream/:id?since=<preset>&tail=<n>` — per-container live stream (handled entirely in `server.mjs`, NOT a Next.js API route, because `server.mjs` owns upgrade dispatch)

### Claude's Discretion (planner may choose without re-asking)

- Exact Zustand store shape for selected-container + connection-state
- React component split (single `<LogViewer>` or split into `<ContainerList>` + `<LogStream>` + `<LogLine>`)
- Whether to add a lightweight virtualized list (react-window) for the log stream — if not needed for perf at 200 lines + ~100 lines/s, skip
- Exact wire format between sidecar and browser (JSON `{ts, stream:"stdout"|"stderr", line}` vs newline-delimited strings) — prefer whatever's simplest and demuxable
- Exact error-wire format
- ANSI converter library (`ansi-to-html` preferred; `anser` acceptable alternative)
- Test harness for the 8-byte demux (fixture vs live — fixture is fine)

</decisions>

<specifics>

- **Model product:** Dozzle. If there's a design question with no obvious answer, "what would Dozzle do?" is a good fallback.
- **No feature-flag toggle to disable `/logs`.** If docker.sock isn't mounted, the page just shows the inline "Docker daemon unreachable" banner and no containers.
- **Operator will use this concurrently with `/rosbridge` on another tab during Phase 7 bring-up.** The single-upgrade-handler regression test in ROADMAP.md's success criterion 5 is non-negotiable.

</specifics>

<success_criteria>

From ROADMAP.md Phase 6 (all five must be observable at execute time):

1. `/logs` shows live list of mower containers, auto-updating as containers start/stop (LOGS-01)
2. Select a container → backfill + live tail (LOGS-02)
3. Auto-scroll with pause-on-manual-scroll-up, resume when scrolled to bottom (LOGS-03)
4. `since=` time-window via preset chips re-backfills the stream (LOGS-04)
5. `/rosbridge` stays functional in another tab while `/logs` is open (regression gate — single upgrade handler)

Plus research-driven verification:
- Non-TTY container (any ROS2 container) logs render without garbled 8-byte-header bytes
- `docker.sock` mount is `:ro` in `docker-compose.yml` diff
- Exactly one `server.on('upgrade')` listener is added; `grep -c "server.on(\"upgrade\"" web/server.mjs` returns `1`

</success_criteria>

<deferred_ideas>

Ideas that came up but belong to future phases/milestones:

- **Log search / grep filter** — real-time regex highlight in the viewer. Future differentiator; not needed for yaw-fusion debugging.
- **Download logs to file** — browser-side save of the current buffer. Future.
- **Log-level highlight rules** (WARN yellow, ERROR red) — deferred until we have a persistent rule engine.
- **Multi-container merged tail** — explicitly out of scope per PROJECT.md (chronological interleaving ambiguous); revisit only if v2.2 operator workflow demands it.
- **xterm.js interactive terminal** — out of scope (shell-exec is a security boundary violation).
- **Authentication on `/logs`** — trusted-LAN assumption matches PROJECT.md; revisit if tailnet / public exposure becomes a goal.
- **Replacing `:ro` docker.sock with `tecnativa/docker-socket-proxy`** — hardening path for a future security-focused milestone.

</deferred_ideas>

---

*Authored: 2026-04-15. Downstream consumers: gsd-phase-researcher, gsd-planner.*
