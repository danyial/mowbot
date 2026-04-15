# Phase 6: WebUI Container-Logs View — Research

**Researched:** 2026-04-15
**Domain:** Node/Next.js 16 sidecar + dockerode v4 log streaming + WS multiplexing inside existing `server.mjs`
**Confidence:** HIGH (stack verified against npm + dockerode source; pitfalls grounded in existing `server.mjs` pattern)

## Summary

Phase 6 adds a `/logs` route to the Next.js dashboard that live-tails any `mowerbot`-project Docker container from the browser. All heavy lifting is bolted onto infrastructure that already exists: the single `server.on('upgrade')` dispatcher in `web/server.mjs` (already owns `/rosbridge`), the Docker engine on the Pi, and the Next.js App Router. Feature delivery is almost entirely wiring — no new containers, no new services, one new npm dep (`dockerode@^4.0.10`) and optionally `ansi-to-html@^0.7.2`.

The five risk areas the planner must address in order of severity: (1) preserving `/rosbridge` while extending the upgrade dispatcher; (2) correctly demuxing the 8-byte framing on non-TTY containers (every ROS2 container in this stack is non-TTY); (3) clean `stream.destroy()` on WS close so the sidecar doesn't leak file descriptors; (4) the dockerode method allowlist at the Node layer (defense-in-depth for the `:ro` sock mount); (5) client-side XSS hardening of ANSI-rendered lines.

**Primary recommendation:** add `dockerode@^4.0.10` + `ansi-to-html@^0.7.2` to `web/package.json`, extend `server.mjs`'s existing upgrade handler with an `else if (pathname.startsWith('/logs/stream/'))` branch using a wrapped dockerode adapter limited to `list / logs / inspect / getEvents`, mount `/var/run/docker.sock:/var/run/docker.sock:ro` only on the `web` service, and ship `/logs` as a client-side React view at `web/app/logs/page.tsx`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Architecture:**
1. Logs sidecar lives inside the existing `web` container — no new Docker service. Reuses Node runtime + `server.mjs`.
2. Docker socket mounted **read-only** on the `web` service: `/var/run/docker.sock:/var/run/docker.sock:ro`. Only the `web` service gets this mount.
3. Dockerode method allowlist at the Node layer: only `container.list()`, `container.logs()`, `container.inspect()`, and the events stream are exposed. Wrap dockerode in a thin adapter that refuses any other method.
4. **Single `server.on('upgrade')` handler, path dispatch.** Extend the existing rosbridge upgrade handler with a second branch for `/logs/stream/:name`. Do NOT add a second `server.on('upgrade')` listener.
5. Non-TTY log demux is mandatory: `container.inspect()` first to read `Config.Tty`; if `false` (true for every ROS2 container in this stack), pipe through `container.modem.demuxStream(raw, stdoutPT, stderrPT)`.

**Container set & refresh:**
- Filter: containers with label `com.docker.compose.project=mowerbot` (verify actual project name at plan time; fallback `com.docker.compose.service` presence).
- Refresh via dockerode events (`type=container`, events `start`/`die`/`destroy`); in-memory map keyed by container ID; no polling fallback; reconnect events stream on failure with same exponential backoff.

**Backfill + since-filter:**
- Default: `tail=200`, no `since=` filter.
- Preset chips: `1m` `5m` `15m` `1h` `6h` `24h` (six buttons).
- On filter change: close current WS, open new one with updated query.
- No freeform duration input in v2.2.
- Server-side `since=` translation: preset string → epoch-seconds before calling `container.logs({ since, tail, timestamps: true, follow: true, stdout: true, stderr: true })`.

**Viewer UI:**
- Two-pane split layout. Left pane (~280 px, collapsible drawer on mobile). Right pane: monospace log stream.
- Right pane header: container badge + status dot, connection-state badge (live / reconnecting / stopped), preset chip row, "Resume auto-scroll" pill (shown only when paused).
- Row format: `[HH:MM:SS.sss] <line>`. Timestamps come from Docker (`timestamps: true`). Gutter faint (text-slate-400).
- ANSI colors via `ansi-to-html` client-side. Sanitize output (allowlist DOMParser check).
- Scroll behavior: auto-scroll to bottom on new line; detect manual scroll-up (`scrollTop + clientHeight < scrollHeight − threshold`) and pause until user clicks "Resume" or scrolls back to bottom.

**Reconnect & failure UX:**
- Exponential backoff 500 ms → 5000 ms cap. Resets on successful open.
- State badge three states: **live** (green), **reconnecting** (yellow + spinner), **stopped** (red).
- Container restart: client observes close, reconnects; server re-issues log stream.
- docker.sock unreachable: events reconnect every 2 s; HTTP list endpoint returns 503; inline banner "Docker daemon unreachable — retrying".
- No floating toasts for transient disconnects — inline state badge only.

**Routing:**
- Route file: `web/app/logs/page.tsx`.
- Nav icon: lucide `ScrollText` or `Terminal`.
- API: `GET /api/logs/containers` (SSR-safe, no-cache). `WS /logs/stream/:id?since=<preset>&tail=<n>` handled entirely in `server.mjs`.

### Claude's Discretion

Planner may choose without re-asking:
- Exact Zustand store shape for selected-container + connection-state
- React component split (single `<LogViewer>` vs split into `<ContainerList>` + `<LogStream>` + `<LogLine>`)
- Whether to add react-window virtualization (skip if not needed for perf at 200 lines + ~100 lines/s)
- Exact wire format between sidecar and browser (JSON `{ts, stream:"stdout"|"stderr", line}` vs NDJSON) — prefer simplest demuxable form
- Exact error-wire format
- ANSI converter library (`ansi-to-html` preferred; `anser` acceptable)
- Test harness for 8-byte demux (fixture fine)

### Deferred Ideas (OUT OF SCOPE)

- Log search / grep filter — Future.
- Download logs to file — Future.
- Log-level highlight rules (WARN yellow, ERROR red) — Future.
- Multi-container merged tail — explicitly out of scope (chronological interleaving ambiguous).
- xterm.js interactive terminal — out of scope (shell-exec = security boundary violation).
- Authentication on `/logs` — trusted-LAN assumption per PROJECT.md.
- `tecnativa/docker-socket-proxy` — future hardening milestone.
- Container lifecycle buttons (start/stop/restart) — breaks read-only boundary.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOGS-01 | Live list of mower Docker containers in `/logs`, auto-refreshing as containers start/stop | Dockerode `listContainers({all: true, filters: {label: ['com.docker.compose.project=<name>']}})` + `getEvents({filters:{type:['container'], event:['start','die','destroy']}})` — §Code Examples 1 + 2 |
| LOGS-02 | Select a container → backfill + live tail | `container.logs({follow:true, stdout:true, stderr:true, tail:200, timestamps:true})` returning Node Readable + `modem.demuxStream()` demux — §Code Examples 3 + 4 |
| LOGS-03 | Auto-scroll on new lines, pause on manual scroll-up, resume on scroll-to-bottom | `scrollTop + clientHeight ≥ scrollHeight − threshold` pattern with passive scroll listener + `useRef` — §Code Examples 7 |
| LOGS-04 | `since=` time-window filter (presets 1m/5m/15m/1h/6h/24h) | Server-side preset → epoch-seconds translation → `container.logs({since: Math.floor(Date.now()/1000) - secs, ...})`; on preset change, close WS and reopen with new since — §Code Examples 5 |

**Plus regression gate (non-numbered, from ROADMAP.md):** `/rosbridge` remains functional when `/logs` is open in another tab — single-upgrade-handler preservation. See §Code Examples 6 and §Pitfall 1.
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Container enumeration + event subscription | Node sidecar (inside `web` container) | — | Reads `docker.sock`; must not touch browser |
| Log stream acquisition + demux | Node sidecar | — | 8-byte framing is a Docker protocol concern; browser must never see raw frames |
| WS upgrade path dispatch (`/rosbridge` vs `/logs/stream/:id`) | Node `server.mjs` | — | Single entrypoint; one `server.on('upgrade')` listener |
| Dockerode method allowlist (defense-in-depth) | Node sidecar adapter | — | The `:ro` bind is advisory (bind-mount RO affects inode writes, not the socket protocol); method allowlist is the real boundary |
| Log line rendering (ANSI → HTML, timestamp gutter, scroll mgmt) | Browser (React client component) | — | Pure presentation, no ROS coupling |
| Container state (selected id, filter preset, conn state) | Browser (Zustand) | — | Ephemeral, per-tab |
| Backfill vs live-tail strategy (single WS, close/reopen on filter change) | Browser controls lifecycle; Node executes | Node | Client owns UX; server is stateless per-connection |
| SSR of `/logs` page | None | Browser | `/logs` is pure client-side — no SSR value; WS requires browser context anyway |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `dockerode` | `^4.0.10` (verified npm 2026-03-20) | Node client for Docker Engine API over UNIX socket; streams multiplexed logs; `modem.demuxStream()` strips 8-byte framing | Dominant Node client (~1.9 M weekly DL per STACK.md); Promise+callback APIs; Node 18+. `[VERIFIED: npm view dockerode version → 4.0.10]` |
| `ansi-to-html` | `^0.7.2` (verified npm 2022-06-13) | ANSI escape → HTML span conversion, client-side, ~4 KB | Small, stable (last published 2022 but API frozen); supports `stream:true` option to persist state across chunk boundaries and `escapeXML:true` for XSS safety. `[VERIFIED: npm view ansi-to-html version → 0.7.2]` `[CITED: github.com/rburns/ansi-to-html README]` |
| `ws` | `^8.18` (already in web via transitive — `next` ships it; verify at plan) | WebSocket server inside `server.mjs` | Already used for `/rosbridge` proxy. Reuse. `[VERIFIED: web/server.mjs imports `ws`]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | already installed (`^0.577.0`) | `ScrollText` or `Terminal` icon for nav | Already the icon library for dashboard/map/teleop |
| `zustand` | already installed (`^4.5.7`) | Optional store for selected-container + connection-state | Use if view has multi-component state; skip if a single `<LogViewer>` owns it in component state |
| `react-window` | not installed | Log-line virtualization | ONLY if measured perf at 200-line backfill + 100 lines/s shows jank; default = skip (plain `<div>` scroller with cap of ~10 k lines) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `dockerode` | Raw HTTP over `/var/run/docker.sock` (Node `http.request` with `socketPath`) | Would reimplement 8-byte demux (~200 LoC). Not worth it. |
| `dockerode` | `node-docker-api` | Beta, 1/18 the downloads, same underlying modem. Rejected in STACK.md. |
| `ansi-to-html` | `anser` | Equivalent; `anser` is more actively maintained but 2× bigger. Either acceptable per CONTEXT.md. |
| ANSI rendering library | xterm.js | Overkill (+200 KB). Explicitly out-of-scope per REQUIREMENTS.md. |
| Plain div scroller | `react-window` virtualization | Only if perf demands. 200-line default is trivial. |

**Installation:**

```bash
cd web
npm install dockerode@^4.0.10 ansi-to-html@^0.7.2
npm install --save-dev @types/dockerode
```

**Version verification (run before plan finalizes):**

```bash
npm view dockerode version        # Expect: 4.0.10 (published 2026-03-20)
npm view ansi-to-html version     # Expect: 0.7.2 (published 2022-06-13)
npm view @types/dockerode version # Check currency; types lag main lib
```

All three verified `[VERIFIED: npm registry, queried 2026-04-15]`.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Browser tab: /logs                                                      │
│                                                                         │
│   GET /api/logs/containers ──┐                                          │
│                              │                                          │
│   ws://host:3000/logs/       │                                          │
│     stream/<id>?since=5m    ─┼─┐                                        │
│     &tail=200                │ │                                        │
│                              │ │  (ALSO concurrent:)                    │
│                              │ │  ws://host:3000/rosbridge              │
│                              │ │  from other tab / other store          │
└──────────────────────────────┼─┼────────────────────────────────────────┘
                               │ │
                               │ │ (single HTTP/WS entry: :3000)
                               ▼ ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ server.mjs (Node 22, web container)                                     │
│                                                                         │
│  server.on('upgrade', …)  ← EXACTLY ONE listener                        │
│    │                                                                    │
│    ├─ if pathname === '/rosbridge'  → existing rosbridge proxy          │
│    │    (NaN scrub, CBOR pass-thru, unchanged)                          │
│    │                                                                    │
│    ├─ else if pathname.startsWith('/logs/stream/')  → NEW               │
│    │    │                                                               │
│    │    ├─ parse :id + query (since, tail)                              │
│    │    ├─ dockerAdapter.inspect(id)  → Config.Tty? cache result        │
│    │    ├─ dockerAdapter.logs(id, {follow, stdout, stderr, tail,        │
│    │    │                          since, timestamps}) → Node Readable  │
│    │    ├─ if !Tty: container.modem.demuxStream(raw, stdoutPT, stderrPT)│
│    │    ├─ line-frame each PT (split on '\n')                           │
│    │    ├─ JSON.stringify({ts, stream, line}) → ws.send(text frame)     │
│    │    └─ on ws.close: raw.destroy() + PTs.destroy()                   │
│    │                                                                    │
│    └─ else → handle Next.js HMR (existing) / socket.destroy (unknown)   │
│                                                                         │
│  GET /api/logs/containers  (Next.js API route)                          │
│    └─ dockerAdapter.listContainers({filters:{label:[project=mowerbot]}})│
│                                                                         │
│  Startup: dockerAdapter.getEvents({filters:{type:['container'],         │
│             event:['start','die','destroy']}})                          │
│    └─ event stream pushes to in-memory container map + broadcasts to    │
│       connected `/api/logs/containers` SSE clients (optional) or just   │
│       invalidates the HTTP cache (client polls-on-focus).               │
│                                                                         │
│  dockerAdapter = thin wrapper exposing ONLY:                            │
│    list | logs | inspect | events  (throws on anything else)            │
│    → defense-in-depth for the :ro sock mount                            │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        │ UNIX socket, bind-mounted read-only
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ /var/run/docker.sock (Docker engine on Pi host)                         │
│                                                                         │
│  GET /containers/json?filters=… → list                                  │
│  GET /containers/<id>/logs?follow=1&… → multiplexed byte stream         │
│    Frame: [STREAM_TYPE(1), 0, 0, 0, SIZE(4 BE)] + payload               │
│  GET /containers/<id>/json → inspect (Config.Tty)                       │
│  GET /events?filters=… → chunked JSON event stream                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
web/
├── app/
│   ├── logs/
│   │   └── page.tsx                # NEW — client component, /logs route
│   └── api/
│       └── logs/
│           └── containers/
│               └── route.ts        # NEW — GET container list (SSR-safe)
├── components/
│   └── logs/
│       ├── log-viewer.tsx          # NEW — right pane, ANSI render, scroll mgmt
│       ├── container-list.tsx      # NEW — left pane
│       ├── since-preset-chips.tsx  # NEW — filter chips
│       └── connection-badge.tsx    # NEW — live/reconnecting/stopped
├── lib/
│   ├── server/
│   │   └── docker-adapter.ts       # NEW — dockerode wrapper w/ method allowlist
│   └── store/
│       └── logs-store.ts           # NEW (optional) — Zustand for selected + conn state
└── server.mjs                      # MODIFY — extend existing upgrade handler
```

### Pattern 1: Extend the single upgrade dispatcher (do NOT add a second listener)

**What:** Reuse the existing `server.on('upgrade', …)` handler in `server.mjs` by inserting an `else if` branch. Node's HTTP server fires **every** registered upgrade listener for **every** upgrade request; a second `server.on('upgrade', …)` would run for `/rosbridge` connections too and the rosbridge proxy would break (see Pitfall 1).

**When to use:** any time a new WS path is needed on this Node server.

**Example:**

```js
// web/server.mjs — inside the existing server.on('upgrade', …) block
server.on("upgrade", (req, socket, head) => {
  const pathname = (req.url || "").split("?")[0];

  socket.on("error", (err) => {
    console.error(`[ws] Socket error on ${pathname}: ${err.message}`);
  });

  if (pathname === "/rosbridge") {
    // … existing rosbridge proxy (unchanged) …
    return;  // EXPLICIT return — prevents fall-through
  }

  if (pathname.startsWith("/logs/stream/")) {
    handleLogsUpgrade(req, socket, head);
    return;
  }

  // Existing fallback: Next.js HMR
  const upgradeHandler = app.getUpgradeHandler();
  if (upgradeHandler) upgradeHandler(req, socket, head);
  else socket.destroy();
});
```

Source: `web/server.mjs` lines 66–143 (existing pattern).

### Pattern 2: Dockerode adapter with method allowlist

**What:** Thin wrapper that exposes only the four methods the feature needs. Throws on any other call. This is defense-in-depth for the `:ro` mount because bind-mount RO affects inode writes on the socket file, not the Docker API protocol — a writable API call can still succeed through a read-only inode.

**When to use:** any time the Node layer touches `docker.sock`.

**Example:**

```ts
// web/lib/server/docker-adapter.ts
import Docker from "dockerode";

const raw = new Docker({ socketPath: "/var/run/docker.sock" });

// Explicit allowlist — TypeScript prevents accidental call-through
export const dockerAdapter = {
  listContainers: (opts: Docker.ContainerListOptions) =>
    raw.listContainers(opts),
  getContainer: (id: string) => {
    const c = raw.getContainer(id);
    // Return a narrowed facade — refuse lifecycle methods
    return {
      id: c.id,
      inspect: () => c.inspect(),
      logs: (o: Docker.ContainerLogsOptions & { follow: true }) =>
        c.logs(o) as Promise<NodeJS.ReadableStream>,
      modem: c.modem,  // needed for demuxStream
    };
  },
  getEvents: (opts: { filters?: Record<string, string[]> }) =>
    raw.getEvents(opts),
  // DELIBERATELY ABSENT: createContainer, pull, run, exec, commit, prune, …
};
```

### Pattern 3: Non-TTY demux for ROS2 containers

**What:** Every ROS2 container in `docker-compose.yml` is started without a TTY (no `tty: true` anywhere in compose). Docker's log API returns an 8-byte-header multiplexed stream for non-TTY containers: `[STREAM_TYPE(1), 0, 0, 0, SIZE_u32_BE(4)] + payload`. `STREAM_TYPE` is `1` for stdout, `2` for stderr. Piping raw to the browser produces garbled output and mis-tagged stderr.

**When to use:** always, after `inspect()` reveals `Config.Tty === false`.

**Example:**

```ts
import { PassThrough } from "stream";

const container = dockerAdapter.getContainer(id);
const { Config } = await container.inspect();
const tty = Config.Tty === true;

const raw = await container.logs({
  follow: true, stdout: true, stderr: true,
  tail: 200, since: sinceEpoch ?? 0, timestamps: true,
}) as NodeJS.ReadableStream;

if (tty) {
  // TTY path: raw is plain utf-8, whole-stream = stdout
  raw.on("data", (chunk) => emit("stdout", chunk.toString("utf-8")));
} else {
  // Non-TTY path: demux is mandatory
  const stdoutPT = new PassThrough();
  const stderrPT = new PassThrough();
  container.modem.demuxStream(raw, stdoutPT, stderrPT);
  stdoutPT.on("data", (chunk) => emit("stdout", chunk.toString("utf-8")));
  stderrPT.on("data", (chunk) => emit("stderr", chunk.toString("utf-8")));
}

// Cleanup: when the WS closes or filter changes
function cleanup() {
  raw.destroy();  // closes the HTTP response → Docker stops streaming
  stdoutPT?.destroy();
  stderrPT?.destroy();
}
```

`[CITED: dockerode README — modem.demuxStream(stream, stdout, stderr)]`
`[VERIFIED: dockerode lib/container.js — logs() returns Node stream when isStream=true (follow=true)]`

### Pattern 4: Line framing across chunk boundaries

**What:** Docker streams bytes, not lines. A chunk may end mid-line; the next chunk continues the same line. The sidecar must buffer until `\n` before emitting a log frame to the browser.

**Example:**

```ts
function lineFramer(onLine: (line: string) => void) {
  let buf = "";
  return (chunk: Buffer) => {
    buf += chunk.toString("utf-8");
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      onLine(buf.slice(0, idx));  // drop the \n
      buf = buf.slice(idx + 1);
    }
    // Anything left in buf is a partial line — wait for next chunk
  };
}
```

Pair with timestamps: when `timestamps: true` is passed to `container.logs()`, each log line is prefixed by `2026-04-15T10:12:03.456789Z ` before the actual content. Parse it out server-side into a numeric `ts` field.

### Pattern 5: Compose project label filter

**What:** Docker Compose tags every container it creates with the `com.docker.compose.project` label. The value is the project name, which defaults to the lowercase basename of the directory containing the compose file. For this repo (`MowerBot/`), the default is `mowerbot`.

**Verify at plan time** — run this on the Pi:

```bash
docker inspect mower-web --format '{{ index .Config.Labels "com.docker.compose.project" }}'
# Expected: mowerbot (or whatever COMPOSE_PROJECT_NAME is set to)
```

**Filter syntax (Docker API):**

```ts
// listContainers filter
const containers = await dockerAdapter.listContainers({
  all: true,
  filters: { label: ["com.docker.compose.project=mowerbot"] },
});

// getEvents filter — restrict to container lifecycle for this project
const events = await dockerAdapter.getEvents({
  filters: {
    type: ["container"],
    event: ["start", "die", "destroy"],
    label: ["com.docker.compose.project=mowerbot"],
  },
});
events.on("data", (chunk) => {
  const evt = JSON.parse(chunk.toString());  // NDJSON frames
  // evt.Action ∈ {start,die,destroy}; evt.id = container id
  invalidateContainerCache(evt.id, evt.Action);
});
```

`[CITED: docs.docker.com/reference/cli/docker/system/events/ — --filter syntax]`
`[CITED: docs.docker.com/compose/how-tos/project-name/ — default is directory basename]`

**Fallback if project label is ever unset:** filter on `com.docker.compose.service` presence (any value) — looser but catches any compose-managed container. Do not make this the default.

### Pattern 6: Client-side scroll-pause detection

**What:** When the user scrolls up, pause auto-scroll. When they scroll back to the bottom (within a threshold), resume. Threshold of ~4 px handles sub-pixel scrollTop rounding (Chrome returns fractional `scrollTop`, Firefox rounds).

**Example:**

```tsx
function LogStream({ lines }: { lines: LogLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Passive listener — don't block scroll perf
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - 4;  // 4 px threshold
      setAutoScroll(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll on new lines when enabled
  useLayoutEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto font-mono">
      {lines.map((l) => <LogLine key={l.id} line={l} />)}
      {!autoScroll && (
        <button onClick={() => setAutoScroll(true)}>Resume auto-scroll</button>
      )}
    </div>
  );
}
```

Source for threshold rationale: MDN `scrollHeight`/`scrollTop` semantics — `scrollTop` can be a non-integer (subpixel) while `scrollHeight`/`clientHeight` are integer-rounded, so exact equality never fires reliably across browsers.

### Pattern 7: Next.js 16 App Router — `/logs` is a client page

**What:** The `/logs` view is pure client — WebSocket needs a browser, dockerode isn't usable in the browser anyway, and no SEO/SSR value. Mark the page `"use client"` at the top and skip SSR entirely.

```tsx
// web/app/logs/page.tsx
"use client";
import { LogViewer } from "@/components/logs/log-viewer";
export default function LogsPage() { return <LogViewer />; }
```

The API route for the container list (`web/app/api/logs/containers/route.ts`) is server-side and uses `dockerAdapter.listContainers()`. Return `Cache-Control: no-store` — container list must be fresh.

### Anti-Patterns to Avoid

- **Adding a second `server.on('upgrade', …)` listener.** Node fires ALL upgrade listeners for every upgrade; your `/logs` handler will run for `/rosbridge` upgrades and race the existing proxy. See Pitfall 1.
- **Forwarding raw log bytes to the browser without demuxing.** For non-TTY containers (every ROS2 container here), the first 8 bytes of every chunk are framing; the browser will render garbage. See Pitfall 2.
- **Not calling `raw.destroy()` on WS close.** The underlying HTTP response to Docker stays open, the container keeps streaming to a dead socket, and the sidecar leaks file descriptors. See Pitfall 3.
- **Exposing dockerode directly in an API route.** Any query-param-driven method call is an escalation path. Use the adapter allowlist. See Pitfall 4.
- **Setting `innerHTML` to raw `ansi-to-html` output without `escapeXML: true`.** A container that logs `<script>…</script>` (unlikely but possible for e.g. rosbridge echoing hostile topic data) would XSS the operator's browser. See Pitfall 5.
- **Polling `docker ps` every N seconds instead of subscribing to events.** Wastes CPU, adds latency to list updates, and the decision is already locked against it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 8-byte Docker multiplex frame parser | Custom byte parser | `container.modem.demuxStream(raw, stdoutPT, stderrPT)` | Dockerode ships this. Edge cases: header split across chunks, zero-length frames, partial trailing frames. Not worth reinventing. |
| Docker API HTTP client over UNIX socket | `http.request({socketPath: ...})` with hand-rolled response parsing | `dockerode` | Error handling, streaming backpressure, TLS fallback — all solved. |
| ANSI escape → HTML converter | Regex-based span emitter | `ansi-to-html` with `stream:true, escapeXML:true` | Handles 256-color, bold/italic, cursor moves (discard), state across chunk boundaries. ~4 KB. |
| WebSocket upgrade handshake | `http.upgrade` manual handling | `new WebSocketServer({noServer: true}).handleUpgrade(...)` | Already in use in `server.mjs` for `/rosbridge`. Consistent. |
| Docker Compose project discovery | Parsing compose files, env vars, dir name logic | `com.docker.compose.project` label (Docker sets it automatically) | Set by Docker Compose itself. Canonical. `[CITED: docs.docker.com/compose/how-tos/project-name/]` |
| Exponential backoff reconnect | Bespoke timer loop | Copy the rosbridge client's existing pattern (500 ms → 5000 ms cap, reset on open) | Already validated in this codebase — consistency matters. |

**Key insight:** every hand-rolled piece here has been written many times and has known edge-case bugs. The stack (`dockerode` + `ansi-to-html` + `ws` + the existing `server.mjs` pattern) covers the feature end-to-end with ~300 lines of glue.

## Runtime State Inventory

Phase 6 is **not a rename/refactor/migration phase.** It introduces new code without renaming existing artifacts or migrating data. This section is included for completeness; all categories are "None."

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — phase creates no persistent state. Container lists/logs are in-memory only. | none |
| Live service config | None — no changes to running ROS2 services, rosbridge, or existing containers' config. | none |
| OS-registered state | None — no Windows Task Scheduler, launchd, systemd, pm2 registrations touched. | none |
| Secrets/env vars | None — no SOPS keys, no new `.env` variables. `docker.sock` path is standard and not a secret. | none |
| Build artifacts | `web/node_modules/dockerode` + `web/node_modules/ansi-to-html` will be added on next `npm install`. Standard. | none (running `npm install` in build pipeline handles it) |

## Common Pitfalls

### Pitfall 1: Second `server.on('upgrade', …)` listener shadows `/rosbridge`

**What goes wrong:** Developer adds `server.on('upgrade', handleLogs)` alongside the existing rosbridge handler. Node's HTTP server invokes **every** upgrade listener for **every** upgrade request. Both handlers race; whichever calls `socket.destroy()` or `wss.handleUpgrade()` first wins, and the other's response is written to an already-closed socket. Result: `/rosbridge` connections start closing immediately under load, dashboard goes dark, and the regression gate in ROADMAP.md fails.

**Why it happens:** `server.on(…)` registers; it doesn't replace. The rosbridge handler has been load-bearing since v2.1; if the planner forgets the existing handler already does path-dispatch, the second listener looks correct in isolation.

**How to avoid:**
1. Extend the **existing** upgrade handler at `web/server.mjs:66` with an `else if (pathname.startsWith('/logs/stream/'))` branch.
2. Add explicit `return` after each path match to prevent fall-through.
3. Never write `server.on('upgrade', …)` more than once.
4. Regression test: `grep -c 'server.on("upgrade"' web/server.mjs` must return exactly `1` after the phase ships (called out in ROADMAP.md success criteria).

**Warning signs:**
- After adding `/logs`, the rosbridge disconnect badge starts flashing in other tabs.
- `server.mjs` console shows two log lines per upgrade.
- `grep -c 'server.on("upgrade"' web/server.mjs` returns `2`.

### Pitfall 2: Skipping the demux on non-TTY containers

**What goes wrong:** Developer tests against `docker run -it alpine sh` (TTY=true) and everything works. Ships to the mower. All ROS2 containers are non-TTY — every log line starts with `\x01\x00\x00\x00\x00\x00\x01\x50` (or similar). The browser renders control glyphs, splits lines mid-word, and silently mis-tags stderr as stdout so the operator misses ERROR messages.

**Why it happens:** The dockerode README's headline example uses a TTY-attached container; the demux is a side note. The framing only appears for containers started with `tty: false` (default).

**How to avoid:**
1. `container.inspect()` before streaming; read `Config.Tty`. Cache the result (won't change for the container's lifetime).
2. If `Tty === false`: `container.modem.demuxStream(raw, stdoutPT, stderrPT)` unconditionally, even if "it looks fine."
3. Fixture-based unit test: feed a known byte sequence `[1,0,0,0,0,0,0,5,'h','e','l','l','o']` through the demuxer and assert `stdoutPT` emits `"hello"`.
4. Integration test: run the log viewer against the `slam` container (which writes to stderr with colors) and verify stderr tagging.

**Warning signs:**
- First 4–8 chars of every line look like box-drawing / control chars.
- Long lines split at odd byte offsets unrelated to `\n`.
- Stderr coloring wrong in the UI.

### Pitfall 3: Not calling `raw.destroy()` on WS close

**What goes wrong:** User switches containers (close old WS, open new). Server's old log stream keeps running, but nothing's reading from it. After a dozen container switches or filter changes, the sidecar has 12 orphan HTTP streams to `docker.sock`, each holding an fd; eventually `EMFILE: too many open files` on the web container or Docker daemon pressure.

**Why it happens:** Dockerode's log stream is a Node `Readable` backed by an HTTP response to the daemon. Closing the WS doesn't cascade — the Readable has no idea the downstream consumer is gone.

**How to avoid:**
1. In the `clientWs.on('close', …)` handler: call `raw.destroy()` on the log stream AND `stdoutPT.destroy()` / `stderrPT.destroy()` on the passthroughs.
2. Wrap in `try/catch` — `destroy()` after an already-errored stream throws.
3. Use `AbortController` + `abortSignal` option on `container.logs()` as the cleaner alternative (dockerode supports it, per `lib/container.js`).

**Warning signs:**
- Web container RSS creeps up over time.
- `lsof -p $(pidof node)` inside the web container shows growing count of socket connections.
- Docker daemon logs "client disconnected" only after very long delays.

### Pitfall 4: Dockerode method allowlist bypass via query param

**What goes wrong:** An API route accepts a dockerode method name from the URL (`/api/logs/:method/:id`). Attacker (or a malicious browser extension) calls `/api/logs/kill/mower-rosbridge` and dockerode happily POSTs to `/containers/mower-rosbridge/kill`. `docker.sock:ro` doesn't protect because bind-mount RO affects inode writes, not the socket protocol.

**Why it happens:** Dynamic method dispatch is tempting ("keep it DRY"). The `:ro` mount looks sufficient but only blocks `write(2)` on the sock inode — which Docker's HTTP-over-UNIX-socket protocol never does. The daemon accepts POST just fine.

**How to avoid:**
1. **No dynamic dispatch.** Four named methods (`list`, `logs`, `inspect`, `events`), four named endpoints/branches. Hardcode the method name at each call site.
2. The adapter wrapper (Pattern 2) exposes exactly four functions; TypeScript enforces at compile time.
3. Code review gate: `grep -rE 'raw\.(createContainer|exec|start|stop|kill|commit|build|prune|remove)' web/lib/server/` must return empty.

**Warning signs:**
- Dockerode adapter has a `method: string` parameter anywhere.
- Any API route path contains `:method` or `:action`.

### Pitfall 5: `ansi-to-html` + `innerHTML` XSS when `escapeXML: false`

**What goes wrong:** `ansi-to-html`'s default `escapeXML: false` emits input characters verbatim wrapped in color spans. If a log line contains `<script>alert(1)</script>`, and the React code sets `dangerouslySetInnerHTML={{__html: converted}}`, that script runs. Practical attack vector is low on a trusted LAN mower, but the fix is trivial.

**Why it happens:** Default `ansi-to-html` config, documented behavior `[CITED: github.com/rburns/ansi-to-html]`.

**How to avoid:**
1. Construct `new Convert({ stream: true, escapeXML: true })` — `stream: true` preserves ANSI state across chunks, `escapeXML: true` entity-encodes `<`, `>`, `&`, `"`, `'` in the input.
2. Paranoia belt: before `dangerouslySetInnerHTML`, parse the result with `DOMParser` and reject anything that contains a `<script>` or `on*=` attribute. One-shot allowlist, not a sanitizer.
3. Prefer React text rendering where possible: split the converted HTML into runs and render as `<span>` children — avoids `dangerouslySetInnerHTML` entirely. This is overkill for v2.2; `escapeXML: true` is sufficient.

**Warning signs:**
- Any `dangerouslySetInnerHTML` in log rendering code.
- `new Convert()` called with no options (defaults are unsafe for untrusted input).

### Pitfall 6: Container ID vs name collision across restart

**What goes wrong:** User selects `slam` → URL becomes `/logs/stream/<long-id-abc123>`. Operator runs `docker compose restart slam`. Container ID changes to `<new-id-def456>`. Client reconnects to the old ID, dockerode returns "no such container," sidecar sends close frame 1008, client badge goes red forever.

**Why it happens:** Dockerode binds to IDs but the operator's mental model is names.

**How to avoid:**
1. Primary key in the URL is the **name** (e.g., `mower-slam`), not the ID.
2. Server resolves name → current ID at upgrade time via `listContainers({filters:{name:[name]}})`.
3. Events subscription watches `start` on the same name and pushes a "reconnect hint" to live clients.
4. UI pattern: on WS close with code 1008, wait 1 s, re-resolve name, re-open WS — once per close event, no loop.

**Warning signs:**
- URL contains a long hex id.
- "Container no longer exists" state shown after a routine restart.

### Pitfall 7: Alpine Node image running as root + docker.sock GID mismatch

**What goes wrong:** The official `node:22-alpine` image ships a non-root `node` user (UID 1000, GID 1000). The host `docker` group is often GID 998 or 999 on Debian/Pi OS Bookworm. If the Dockerfile sets `USER node`, the in-container process can't `read(2)` on `/var/run/docker.sock` — operation fails with `EACCES`.

**Why it happens:** Mismatch between image user GID and host `docker` group GID. The current `web` image has no `USER` directive (per CONTEXT.md implication + docker-compose.yml showing no `user:` override), so it runs as root inside the container — access works, but that's a separate hardening concern.

**How to avoid:**
1. **Current state:** `web` container runs as root; `:ro` mount + method allowlist is the boundary. Document in `docker-compose.yml` comment.
2. **Future hardening (NOT this phase):** set `user: "1000:999"` in `docker-compose.yml` (where `999` matches host docker group), OR build the image with `addgroup -g $DOCKER_GID docker && adduser -G docker node`.
3. Verify at plan time: `getent group docker` on the Pi → note GID. Don't change user in this phase; flag as deferred hardening.

**Warning signs:**
- `EACCES` on first dockerode call after a user-hardening change.
- `ls -la /var/run/docker.sock` in-container shows group the node user isn't in.

### Pitfall 8: `timestamps: true` adds ISO prefix that must be stripped

**What goes wrong:** With `timestamps: true` passed to `container.logs()`, Docker prefixes each line with `2026-04-15T10:12:03.456789012Z ` (RFC3339Nano + space). If the sidecar emits the raw line, the browser sees the timestamp twice (once in the server-rendered gutter, once in the line body). Ugly and wastes screen.

**Why it happens:** Developers assume timestamps come out-of-band. They don't — they're inlined.

**How to avoid:**
1. Parse: regex `/^(\S+)\s(.*)$/` on each line; group 1 is the ISO timestamp, group 2 is the actual content.
2. Convert ISO → `HH:MM:SS.sss` for the gutter.
3. Emit `{ts: epochMillis, stream, line: group2}` to the browser; client renders gutter from `ts`.

**Warning signs:**
- Log rows show `[2026-04-15T10:12:03.456Z] 2026-04-15T10:12:03.456789012Z actual message`.

## Code Examples

Numbered to match the "Research Support" references in the `<phase_requirements>` block.

### Example 1: List project containers

```ts
// web/app/api/logs/containers/route.ts
import { NextResponse } from "next/server";
import { dockerAdapter } from "@/lib/server/docker-adapter";

const PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME ?? "mowerbot";

export async function GET() {
  try {
    const containers = await dockerAdapter.listContainers({
      all: true,
      filters: { label: [`com.docker.compose.project=${PROJECT_NAME}`] },
    });
    return NextResponse.json(
      containers.map((c) => ({
        id: c.Id,
        name: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
        image: c.Image,
        state: c.State,  // "running" | "exited" | …
        status: c.Status,
      })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/logs/containers] list error:", err);
    return NextResponse.json(
      { error: "docker daemon unreachable" },
      { status: 503 },
    );
  }
}
```

### Example 2: Subscribe to lifecycle events

```ts
// web/lib/server/docker-events.ts
import { dockerAdapter } from "./docker-adapter";

const PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME ?? "mowerbot";

export function startEventSubscription(onChange: (id: string, action: string) => void) {
  let backoff = 500;
  const MAX = 5000;

  async function connect() {
    try {
      const stream = await dockerAdapter.getEvents({
        filters: {
          type: ["container"],
          event: ["start", "die", "destroy"],
          label: [`com.docker.compose.project=${PROJECT_NAME}`],
        },
      });
      backoff = 500;  // reset on success
      stream.on("data", (chunk: Buffer) => {
        try {
          const evt = JSON.parse(chunk.toString());
          onChange(evt.id, evt.Action);
        } catch {
          /* partial frame — ignore */
        }
      });
      stream.on("close", reconnect);
      stream.on("error", reconnect);
    } catch {
      reconnect();
    }
  }

  function reconnect() {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX);
  }

  connect();
}
```

### Example 3: Server-side log stream handler (inside `server.mjs`)

```js
// Pseudocode mixed TS/JS for readability — real implementation is in server.mjs (JS)
import { WebSocketServer, WebSocket } from "ws";
import { PassThrough } from "stream";
import { dockerAdapter } from "./lib/server/docker-adapter.js";

async function handleLogsUpgrade(req, socket, head) {
  const url = new URL(req.url, "http://x");
  const name = url.pathname.replace(/^\/logs\/stream\//, "");
  const tail = parseInt(url.searchParams.get("tail") ?? "200", 10);
  const since = parseSincePreset(url.searchParams.get("since"));  // → epoch seconds or 0

  const list = await dockerAdapter.listContainers({
    all: true, filters: { name: [name] },
  });
  if (list.length === 0) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  const container = dockerAdapter.getContainer(list[0].Id);
  const { Config } = await container.inspect();

  const wss = new WebSocketServer({ noServer: true });
  wss.handleUpgrade(req, socket, head, async (ws) => {
    let raw, stdoutPT, stderrPT;
    try {
      raw = await container.logs({
        follow: true, stdout: true, stderr: true,
        tail, since, timestamps: true,
      });
      const onLine = (stream) => lineFramer((line) => {
        const { ts, body } = splitIsoPrefix(line);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ts, stream, line: body }));
        }
      });
      if (Config.Tty) {
        raw.on("data", onLine("stdout"));
      } else {
        stdoutPT = new PassThrough();
        stderrPT = new PassThrough();
        container.modem.demuxStream(raw, stdoutPT, stderrPT);
        stdoutPT.on("data", onLine("stdout"));
        stderrPT.on("data", onLine("stderr"));
      }
    } catch (err) {
      ws.close(1011, "docker error");
      return;
    }
    ws.on("close", () => {
      try { raw?.destroy(); stdoutPT?.destroy(); stderrPT?.destroy(); }
      catch { /* idempotent */ }
    });
  });
}
```

### Example 4: Non-TTY demux (see Pattern 3)

### Example 5: Since-preset → epoch translation

```ts
function parseSincePreset(s: string | null): number {
  if (!s) return 0;
  const map: Record<string, number> = {
    "1m": 60, "5m": 300, "15m": 900,
    "1h": 3600, "6h": 21600, "24h": 86400,
  };
  const secs = map[s];
  if (!secs) return 0;
  return Math.floor(Date.now() / 1000) - secs;  // epoch seconds
}
```

Docker's `since` accepts either epoch seconds OR an ISO8601 timestamp. Epoch is simpler and avoids TZ confusion.

### Example 6: Regression test for `/rosbridge` + `/logs` concurrency

```ts
// web/__tests__/server-upgrade.test.ts (Node-native test, no vitest/jest needed)
// Run: node --test web/__tests__/server-upgrade.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

test("exactly one server.on('upgrade') listener", () => {
  const src = readFileSync("web/server.mjs", "utf-8");
  const matches = src.match(/server\.on\(['"]upgrade['"]/g) ?? [];
  assert.equal(matches.length, 1, "must have exactly one upgrade listener");
});

test("upgrade handler dispatches both /rosbridge and /logs/stream/", () => {
  const src = readFileSync("web/server.mjs", "utf-8");
  assert.match(src, /pathname === ['"]\/rosbridge['"]/, "rosbridge branch present");
  assert.match(src, /pathname\.startsWith\(['"]\/logs\/stream\/['"]\)/, "logs branch present");
});

// Integration smoke test (manual or CI-gated):
// 1. Start web container.
// 2. Open WS to ws://host:3000/rosbridge → assert onopen.
// 3. Open WS to ws://host:3000/logs/stream/mower-slam?tail=1 → assert first message within 2 s.
// 4. Keep both open for 60 s → assert no unexpected closes on either.
```

### Example 7: Scroll-pause hook (see Pattern 6)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling `docker ps` every N seconds | Dockerode events stream + in-memory map | Docker Engine API ≥ 1.12 (2016) | Instant container list updates; no CPU waste. Decision locked. |
| Using `docker logs` CLI subprocess + parse stdout | `dockerode` over UNIX socket | Dockerode has been dominant since ~2017 | Proper stream lifecycle + backpressure + typed opts. |
| Custom ANSI parser | `ansi-to-html` / `anser` | Libraries stable since 2017+ | Covers 256-color, bold, reset, escape-across-chunk. |
| Always-on auto-scroll | Pause-on-scroll-up (Dozzle pattern) | Became table-stakes in ops tooling ~2020 | Operators can actually read old lines. |

**Deprecated / outdated:**
- `node-docker-api` — beta, 1/18 the downloads; do not adopt.
- `localStorage` for log ring buffer — none of the REQs call for persistence; skip entirely.
- TTY-only log assumption — ROS2 containers are non-TTY; demux is mandatory.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The compose project name is `mowerbot` (directory basename lowercased) | Code Example 1, Pattern 5 | Container list returns empty; easy to verify at plan time with `docker inspect mower-web --format '{{ index .Config.Labels "com.docker.compose.project" }}'` |
| A2 | `web` container currently runs as root (no `USER` directive in image, no `user:` in compose) — so docker.sock access works without GID matching | Pitfall 7 | If wrong, bind-mount succeeds but reads `EACCES`; plan must add GID matching. Verify with `docker exec mower-web id`. |
| A3 | Every ROS2 container in this stack is non-TTY (no `tty: true` in compose) | Pattern 3, Pitfall 2 | If any container is TTY, demux still works but adds an unnecessary branch. Low risk — `grep -n "tty:" docker-compose.yml` returns empty at write time. |
| A4 | `ansi-to-html@0.7.2` (last published 2022) is still maintained and API-stable enough to rely on | Standard Stack | Library hasn't shipped a release in ~4 years but the API has been frozen since 0.6.x. Alternative (`anser`) named in CONTEXT.md as acceptable. |
| A5 | Docker Compose labels (`com.docker.compose.project`) are reliably set by the Docker Compose version on the Pi | Pattern 5 | Compose has set this label since v1.x (2015+). Extremely low risk; fallback `com.docker.compose.service` presence noted. |
| A6 | The current `@types/dockerode` package version is compatible with dockerode 4.0.10 | Standard Stack | Types lag; worst case, cast through `as any` for one or two method signatures. Verify at plan time with `npm view @types/dockerode versions --json`. |

**Tagged `[ASSUMED]` claims elsewhere in this document:** A1, A2, A3 above. All other claims are tagged `[VERIFIED]` or `[CITED]` inline.

## Open Questions

1. **Does the current `web` image need a Dockerfile change to include dockerode?**
   - What we know: `dockerode` is pure JS + native bindings for Docker modem parsing (depends on `docker-modem`, which is pure JS). Install adds no system libs.
   - What's unclear: is the current image built via `docker/web/Dockerfile` or directly from `node:22-alpine`? A rebuild is needed either way (new `package.json` deps), but knowing the image source affects the plan's build step.
   - Recommendation: planner reads `docker/web/Dockerfile` (if present) or `web/Dockerfile` at plan time and confirms the rebuild path.

2. **Do we need `COMPOSE_PROJECT_NAME` env var injected into the web container?**
   - What we know: `docker-compose.yml` doesn't set `COMPOSE_PROJECT_NAME` anywhere today; the default is the directory basename = `mowerbot`.
   - What's unclear: is the container-internal process aware of this? The sidecar runs inside the container and queries Docker from outside, so it must know the project name to filter.
   - Recommendation: inject `COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-mowerbot}` into the `web` service's `environment:` block. Single-line compose change.

3. **Should the events subscription push to clients, or should clients poll `/api/logs/containers` on focus?**
   - What we know: CONTEXT.md specifies dockerode events for refresh, no polling fallback.
   - What's unclear: between events and browser, the transport could be SSE (new endpoint), a WS message on the existing `/logs/stream/:id` channel (but that's per-container), or just cache-invalidation → client polls on page focus.
   - Recommendation: planner's discretion per CONTEXT.md. Simplest: SSE at `/api/logs/events` that emits `{action, name}` frames. Second simplest: invalidate a server-side cache and let client `SWR`-style fetch `/api/logs/containers` on window focus + a periodic cheap ETag check.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Engine | docker.sock access | Expected ✓ (already running all 9 containers) | ≥ 20.10 per STACK.md; Pi OS Bookworm ships 24.x | — |
| `/var/run/docker.sock` | dockerode | Expected ✓ on Pi host | UNIX socket | — (feature impossible without) |
| Node 22 (Alpine) inside `web` container | dockerode 4.x | Expected ✓ (current web image) | 22 per codebase/STACK.md | — |
| Docker Compose | label injection | Expected ✓ (existing stack is compose-managed) | — | — |
| npm registry | install dockerode + ansi-to-html | Expected ✓ at build time | — | Vendor locally if offline build needed (not a v2.2 concern) |

**Missing dependencies with no fallback:** none — this phase is pure additive wiring on top of infrastructure that already exists on the Pi.

**Verification at plan time:** on the Pi (ssh danny@10.10.40.23, per MEMORY.md):
```bash
ls -la /var/run/docker.sock                                # UNIX socket present
docker version --format '{{.Server.Version}}'              # ≥ 20.10
docker inspect mower-web --format '{{.State.Status}}'      # running
docker inspect mower-web --format '{{range .Mounts}}{{.Source}}→{{.Destination}}{{println}}{{end}}'  # current mounts
docker inspect mower-web --format '{{ index .Config.Labels "com.docker.compose.project" }}'  # project name (A1)
getent group docker                                        # host docker GID (A2 / Pitfall 7)
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | **Node native `node:test`** (Node 22 built-in). No new dev dep. Existing codebase has no TS-based unit test runner; adopting vitest/jest is out of scope for Phase 6. |
| Config file | none required for node:test |
| Quick run command | `cd web && node --test __tests__/ 2>&1` |
| Full suite command | `cd web && node --test __tests__/ 2>&1` (same — small test surface) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOGS-01 | List project containers, refresh on lifecycle events | unit + integration-smoke | `node --test web/__tests__/docker-adapter.test.mjs` (adapter method allowlist + filter shape); manual browser smoke for live refresh | ❌ Wave 0 |
| LOGS-02 | Select container → backfill + live tail, correct stderr demux | unit (demux fixture) + manual smoke against `mower-slam` | `node --test web/__tests__/demux.test.mjs` (8-byte header fixture → "hello\n"); manual `/logs` page open with `slam` selected | ❌ Wave 0 |
| LOGS-03 | Auto-scroll behavior with pause-on-scroll-up | manual UAT (browser interaction required) | manual: scroll up in /logs, confirm pause pill appears; scroll to bottom, confirm resume | ❌ (manual-only, justified: DOM scroll behavior is browser-specific and trivially visible) |
| LOGS-04 | `since=` preset re-backfills and continues live-tail | unit (epoch translation) + manual smoke | `node --test web/__tests__/since-preset.test.mjs` (preset strings → epoch math); manual: click "5m" chip, confirm older lines appear | ❌ Wave 0 |
| Regression | `/rosbridge` stays functional while `/logs` is open | unit (exactly-one-listener grep) + manual UAT | `node --test web/__tests__/server-upgrade.test.mjs` (Example 6) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd web && node --test __tests__/ 2>&1` (the full suite runs in <2 s because it's all file-scan + pure-function tests)
- **Per wave merge:** same command + `grep -c 'server.on("upgrade"' web/server.mjs` must return `1`
- **Phase gate:** full suite green + the 5 ROADMAP.md observable behaviors + `docker inspect mower-web | jq '[.[0].Mounts[] | select(.Source=="/var/run/docker.sock")] | .[0].RW'` returns `false` before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `web/__tests__/server-upgrade.test.mjs` — grep-based regression gate for exactly-one upgrade listener + both path branches present (Example 6)
- [ ] `web/__tests__/docker-adapter.test.mjs` — adapter allowlist: importing `dockerAdapter`, asserting it has only `listContainers`, `getContainer`, `getEvents` exported; asserting `getContainer()` facade has only `inspect`, `logs`, `modem`
- [ ] `web/__tests__/demux.test.mjs` — pure fixture: synthesize an 8-byte-header buffer, pipe through a minimal replica of the framer, assert stdout/stderr split
- [ ] `web/__tests__/since-preset.test.mjs` — `parseSincePreset('5m')` returns `Math.floor(Date.now()/1000) - 300` within ±1 s
- [ ] `web/__tests__/` directory — must be created; add to `tsconfig` excludes so Next.js build skips it
- [ ] Framework install: **none** — `node:test` is built into Node 22

**Rationale for minimal test surface:** Phase 6 is primarily glue code around external libraries (dockerode, ansi-to-html) and browser-interactive UI. Unit tests cover the two non-trivial pure functions (demux framing, since translation) plus the regression gates (single-listener grep, adapter allowlist). Everything else is manual browser UAT against the 5 ROADMAP.md success criteria — appropriate for a feature where correctness is visually obvious and the main bugs-we-fear (upgrade shadowing, demux skipped, fd leaks) are best caught by operator-observable behavior.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Out of scope per CONTEXT.md deferred-ideas (trusted-LAN assumption matches PROJECT.md) |
| V3 Session Management | no | Inherited from the existing `/rosbridge` trust model |
| V4 Access Control | yes | Dockerode method allowlist at Node layer (Pattern 2); `:ro` bind mount; no dynamic method dispatch |
| V5 Input Validation | yes | URL path param (`:id`/`:name`) validated against `listContainers` result; `since` preset validated against fixed map (see Example 5) — reject anything else |
| V6 Cryptography | no | No secrets, no tokens — docker.sock is local IPC |
| V14 Configuration | yes | `docker-compose.yml` mount must be `:ro`; compose project name must be set predictably (env var) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Docker.sock RW → container escape to host root | Elevation of Privilege | `:ro` bind mount + method allowlist (defense-in-depth: `:ro` alone is insufficient because it affects inode writes, not the API protocol) |
| Second `server.on('upgrade')` listener shadows `/rosbridge` | Denial of Service (accidental, on existing feature) | Single-listener invariant; grep test in Wave 0 |
| XSS via ANSI-rendered log line | Spoofing / Tampering of operator UI | `ansi-to-html` with `escapeXML: true`; optional DOMParser allowlist post-check |
| Path traversal in `/logs/stream/:id` to call arbitrary dockerode method | Elevation of Privilege | Method allowlist is hardcoded; `:id` only flows into `getContainer(id)` which is in the allowlist; no dynamic method name |
| `docker.sock` exposed to LAN | Information Disclosure / EoP | Never listen on a TCP port for docker; route everything through `server.mjs` on :3000 (same as `/rosbridge`) — inherits the existing trusted-LAN posture |
| Log content includes secrets (NTRIP password, etc.) | Information Disclosure | Containers already log to stdout regardless of this feature — the web UI is a new read surface, not a new leak surface. Flag for a future redaction pass (see Pitfalls 7.5 in milestone-level PITFALLS.md); do not block v2.2 on it. |

## Sources

### Primary (HIGH confidence)

- `.planning/research/STACK.md` — milestone-level dockerode + `:ro` rationale
- `.planning/research/ARCHITECTURE.md` — sidecar-in-web decision, topology, file touch list
- `.planning/research/PITFALLS.md` — pitfalls 1, 2, 3, 9 (docker.sock RW, demux skip, lifecycle drift, upgrade-handler shadow)
- `web/server.mjs` (lines 66–143) — existing single-upgrade-handler pattern with path dispatch
- `docker-compose.yml` (lines 123–138) — current `web` service config
- `web/package.json` — current deps (confirms `ws` transitive via `next`, `zustand`, `lucide-react` already present)
- dockerode `lib/container.js` — logs() signature + `isStream: args.opts.follow || false`
- npm registry — `dockerode@4.0.10` (2026-03-20), `ansi-to-html@0.7.2` (2022-06-13)
- [dockerode README](https://github.com/apocas/dockerode/blob/master/README.md) — `modem.demuxStream(stream, stdout, stderr)` signature
- [ansi-to-html README](https://github.com/rburns/ansi-to-html) — `stream: true`, `escapeXML: true` options
- [Docker Compose project name docs](https://docs.docker.com/compose/how-tos/project-name/) — default is directory basename
- [Docker events CLI docs](https://docs.docker.com/reference/cli/docker/system/events/) — `--filter type=container event=start,die,destroy label=…` syntax (same format as dockerode filters object)
- [MDN: Element.scrollHeight](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight) — scrollTop subpixel rounding rationale for threshold

### Secondary (MEDIUM confidence)

- Existing rosbridge client reconnect pattern (500 ms → 5000 ms cap) — copy-target for logs WS reconnect
- Dozzle (https://dozzle.dev/) — UX reference named in CONTEXT.md for scroll-pause and filter-chip UX

### Tertiary (LOW confidence)

- None — all claims in this doc are either VERIFIED against source/npm/files or CITED to official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified via `npm view` 2026-04-15, signatures verified against dockerode `lib/container.js`
- Architecture: HIGH — the pattern is a direct extension of the existing, working `/rosbridge` upgrade handler; no speculative redesign
- Pitfalls: HIGH — eight pitfalls grounded in either the existing `server.mjs` pattern (Pitfalls 1, 3, 6), known Docker API behavior (Pitfalls 2, 4, 8), or library documentation (Pitfall 5). Pitfall 7 flagged as ASSUMED until `docker exec mower-web id` is run at plan time.

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days — stack is mature; dockerode minor releases unlikely to break the narrow API surface used here)
