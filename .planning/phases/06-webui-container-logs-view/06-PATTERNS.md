# Phase 6: WebUI Container-Logs View — Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 11 (new) + 2 (modified)
**Analogs found:** 11 / 11 (all have an in-repo analog)

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `web/server.mjs` *(MODIFY)* | server / WS dispatcher | streaming (WS proxy) | `web/server.mjs` (self — `/rosbridge` branch) | exact |
| `web/lib/server/docker-adapter.ts` *(NEW)* | server utility / adapter | request-response + streaming | `web/lib/ros/ros-client.ts` (connection manager pattern) | role-match |
| `web/app/api/logs/containers/route.ts` *(NEW)* | API route (GET) | request-response | `web/app/api/missions/route.ts` GET handler | exact |
| `web/app/logs/page.tsx` *(NEW)* | Next.js App Router page (client) | presentation | `web/app/lidar/page.tsx` | exact |
| `web/components/logs/log-viewer.tsx` *(NEW)* | React client component | streaming (WS consumer) | `web/components/lidar/scan-canvas.tsx` (ref'd), `web/lib/ros/ros-client.ts` (WS reconnect loop) | role-match |
| `web/components/logs/container-list.tsx` *(NEW)* | React presentational component | request-response | `web/components/layout/sidebar.tsx` (list + active-row pattern) | role-match |
| `web/components/logs/since-preset-chips.tsx` *(NEW)* | React presentational component | event-driven (click) | `web/components/ui/badge.tsx` (cva variant pattern) | role-match |
| `web/components/logs/connection-badge.tsx` *(NEW)* | React presentational component | state → visual | `web/components/ui/badge.tsx` | exact |
| `web/lib/store/logs-store.ts` *(NEW, optional)* | Zustand store | state container | `web/lib/store/scan-store.ts` (latest-only, no persistence) | exact |
| `web/lib/types/logs.ts` *(NEW)* | TypeScript types | type definition | `web/lib/types/ros-messages.ts` (shared type module) | role-match |
| `docker-compose.yml` *(MODIFY)* | config | N/A | existing `web:` service block (lines 123-138) | exact |
| `web/package.json` *(MODIFY)* | config | N/A | existing deps block | exact |
| `web/components/layout/sidebar.tsx` + `mobile-nav.tsx` *(MODIFY)* | navigation config | N/A | existing `navItems` arrays | exact |

## Pattern Assignments

---

### `web/server.mjs` *(MODIFY — extend the single upgrade handler)*

**Analog:** `web/server.mjs` itself (the `/rosbridge` branch is the reference for the new `/logs/stream/:id` branch).

**Dispatch pattern — CRITICAL: single listener, path branches** (lines 66-143):

```js
server.on("upgrade", (req, socket, head) => {
  const pathname = (req.url || "").split("?")[0];

  socket.on("error", (err) => {
    console.error(`[ws] Socket error on ${pathname}: ${err.message}`);
  });

  if (pathname === "/rosbridge") {
    // ... existing rosbridge proxy ...
  } else {
    // Let Next.js handle HMR WebSocket upgrades
    const upgradeHandler = app.getUpgradeHandler();
    if (upgradeHandler) upgradeHandler(req, socket, head);
    else socket.destroy();
  }
});
```

**Copy:** insert `else if (pathname.startsWith("/logs/stream/"))` branch **between** the rosbridge branch and the HMR fallback. Do NOT add a second `server.on("upgrade", …)`. The `grep -c 'server.on("upgrade"' web/server.mjs` success-criterion from CONTEXT.md must return exactly `1`.

**WS handshake pattern** (lines 76-78):

```js
const wss = new WebSocketServer({ noServer: true });
wss.handleUpgrade(req, socket, head, (clientWs) => {
  // ... wire up client <-> upstream ...
});
```

**Close/cleanup pattern** (lines 107-132): mirror this for the logs branch — on `clientWs.on("close")` call `raw.destroy()` and `stdoutPT.destroy()` + `stderrPT.destroy()` to prevent fd leaks. On upstream error, `clientWs.close()`.

**Logging pattern** (lines 83, 108, 115, 124, 128): `console.log("[rosbridge-proxy] ...")` / `console.error("[rosbridge-proxy] ...")`. For logs branch use prefix `[logs-stream]` for symmetry.

**Error-suppression pattern** (lines 39-50): `process.on("uncaughtException", …)` already swallows `ECONNRESET` / `EPIPE` / `ECONNREFUSED`. Reuse as-is; no change needed.

**NaN sanitizer lesson** (lines 26-36): the rosbridge branch strings-scans text frames for NaN. For logs, emit `JSON.stringify({ts, stream, line})` server-side — no NaN risk, no scrubber needed.

---

### `web/lib/server/docker-adapter.ts` *(NEW — thin dockerode wrapper with method allowlist)*

**Analog:** no direct analog in repo; closest is `web/lib/ros/ros-client.ts` (connection-manager + reconnect + narrow public surface). Different underlying client library but the same *shape*: one persistent connection, exponential-backoff reconnect for the events stream, narrow named exports.

**Imports/module pattern to copy** (ros-client.ts top):

```ts
// Named exports only; no default beyond a convenience getter
export function onConnection(cb, key?) { ... }
export function connect(url?) { ... }
export function isConnected(): boolean { ... }
```

For docker-adapter: export exactly `listContainers`, `getContainerLogs`, `inspectContainer`, `subscribeEvents` — nothing else. This is the CONTEXT.md "method allowlist at the Node layer" boundary.

**Exponential-backoff reconnect pattern** (ros-client.ts lines 27-29, 234-246):

```ts
const MAX_RECONNECT_DELAY = 5000;
const INITIAL_RECONNECT_DELAY = 500;

function scheduleReconnect() {
  const s = getState();
  if (s.reconnectTimer) return;
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    doConnect();
    s.reconnectDelay = Math.min(s.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }, s.reconnectDelay);
}
```

**Apply to:** the events-stream reconnect in docker-adapter (CONTEXT.md §Container set: "reconnect events stream on failure with same exponential backoff"). The 500 ms → 5000 ms constants should match ros-client.ts exactly so operator UX is consistent across the two WS paths.

**Error-logging prefix convention** (ros-client.ts and server.mjs): `console.error("[docker-adapter] ...")`.

---

### `web/app/api/logs/containers/route.ts` *(NEW — GET handler returning container list)*

**Analog:** `web/app/api/missions/route.ts` — identical role (GET → JSON list) and data flow.

**Imports pattern** (missions/route.ts lines 1-6):

```ts
import { NextResponse } from "next/server";
// plus domain imports with @/ alias
import type { Mission } from "@/lib/types/mission";
```

**GET handler pattern** (missions/route.ts lines 105-108):

```ts
export async function GET() {
  const missions = await readMissions();
  return NextResponse.json(missions);
}
```

**Adaptation for logs:** call `listContainers()` from the docker-adapter; on failure (docker.sock unreachable) return `NextResponse.json({ error: "..." }, { status: 503 })` — the 503 is explicit CONTEXT.md behavior and matches the 4xx pattern at missions/route.ts lines 181-184.

**Try/catch + contextual console.error pattern** (missions/route.ts lines 179-185):

```ts
} catch (err) {
  console.error("[missions] POST error:", err);
  return NextResponse.json({ error: "Ungueltige Daten" }, { status: 400 });
}
```

**Apply to logs route:** `console.error("[logs/containers] GET error:", err)` and return 503 with German error string (e.g., `"Docker nicht erreichbar"` from UI-SPEC.md copywriting table).

**No-cache header:** CONTEXT.md requires `GET /api/logs/containers` be SSR-safe and no-cache. Add `export const dynamic = "force-dynamic"` and/or `{ headers: { "Cache-Control": "no-store" } }` on the NextResponse — no existing analog for this in the repo, borrow from Next.js 16 App Router docs.

---

### `web/app/logs/page.tsx` *(NEW — client-side page entry)*

**Analog:** `web/app/lidar/page.tsx` — same role (thin client page that wraps a single viewer component), same data flow (client-only, no SSR, dynamic import because the viewer reaches for DOM APIs).

**Full pattern to copy** (lidar/page.tsx lines 1-52):

```tsx
"use client";

import dynamic from "next/dynamic";

const LogViewer = dynamic(
  () =>
    import("@/components/logs/log-viewer").then((m) => ({
      default: m.LogViewer,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-background flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Logs werden geladen…</span>
      </div>
    ),
  }
);

export default function LogsPage() {
  return <LogViewer className="h-full w-full" />;
}
```

**Why this analog:** lidar/page.tsx also has WS-dependent children (scan-canvas needs `document`, `ResizeObserver`). The logs viewer will have the same needs (WebSocket, scroll refs). SSR off is correct.

**Locale:** loading string must be German ("Logs werden geladen…") to match UI-SPEC.md copywriting contract and existing `lidar/page.tsx` line 18 ("LiDAR wird geladen...").

---

### `web/components/logs/container-list.tsx` *(NEW — left-pane list with selectable rows)*

**Analog:** `web/components/layout/sidebar.tsx` — same role (vertical list of clickable rows with active/hover states, reads path/state, uses `cn()` + lucide icons + `text-primary` active styling).

**Imports pattern** (sidebar.tsx lines 1-17):

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Map, /* ... */ } from "lucide-react";
import { cn } from "@/lib/utils";
```

**Active-row highlight pattern** (sidebar.tsx lines 60-78) — locked by UI-SPEC.md to match this visual language exactly:

```tsx
<Link
  className={cn(
    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
    isActive
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  )}
>
```

**Apply to container-list rows:** replace `<Link>` with `<button>` (selection is local state, not route); keep `bg-primary/10 text-primary` for selected (UI-SPEC.md §Left pane "Selected: `bg-primary/10 text-primary` (matches existing sidebar active state for visual continuity)"). Row layout: status dot (8 px, `bg-primary` running / `bg-muted-foreground` exited) + name (`text-sm truncate`) + image tag (`text-xs text-muted-foreground truncate`). Row min-height `min-h-11` (44 px touch target).

---

### `web/components/logs/log-viewer.tsx` *(NEW — right-pane WS consumer, scroll manager, ANSI render)*

**Analog (WS + reconnect structure):** `web/lib/ros/ros-client.ts` — mirror the INITIAL_RECONNECT_DELAY=500 / MAX_RECONNECT_DELAY=5000 exponential-backoff ladder.

```ts
const MAX_RECONNECT_DELAY = 5000;
const INITIAL_RECONNECT_DELAY = 500;
```

Client-side reconnect state machine (onopen resets delay, onclose doubles up to cap) — lines 234-246 of ros-client.ts are the reference.

**Analog (dynamic-import target, scroll ref, client-only DOM):** `web/components/lidar/scan-canvas.tsx` (lidar/page.tsx already wires it via `dynamic({ ssr: false })`).

**State-machine → visual mapping:** follow UI-SPEC.md §"State Machine: Connection → Visual" table exactly (no code analog — spec-driven).

**Auto-scroll threshold pattern:** UI-SPEC.md §Performance locks this at 24 px: `scrollTop + clientHeight < scrollHeight − 24` → paused.

**WS URL resolver pattern** (ros-client.ts lines 10-21) — copy verbatim, adapted:

```ts
function resolveLogsUrl(id: string, qs: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/logs/stream/${encodeURIComponent(id)}${qs}`;
}
```

This matches the `/rosbridge` path-relative pattern so prod (behind reverse proxy) and dev (direct to :3000) both work.

---

### `web/components/logs/since-preset-chips.tsx` *(NEW — 6 preset buttons)*

**Analog:** `web/components/ui/badge.tsx` — cva-based variant switching (active/inactive/hover) is the closest pattern.

**cva variant pattern** (badge.tsx lines 5-30):

```tsx
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ...",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        // ...
      },
    },
    defaultVariants: { variant: "default" },
  }
);
```

**Apply to chips:** two variants (`active` = `bg-primary text-primary-foreground`, `inactive` = `bg-secondary text-secondary-foreground hover:bg-secondary/80`) — exact classes from UI-SPEC.md §Preset chip row. Height `h-8`, gap `gap-1`, font `text-xs font-semibold`.

---

### `web/components/logs/connection-badge.tsx` *(NEW — live/reconnecting/stopped)*

**Analog:** `web/components/ui/badge.tsx` — exact match on role. Use the existing `Badge` primitive directly; no need to redefine cva variants.

**Usage pattern** — import `Badge` from `@/components/ui/badge`, add a dot span child:

```tsx
<Badge variant="secondary" className="h-6 px-2 rounded-full inline-flex items-center gap-1.5">
  <span className={cn("h-2 w-2 rounded-full", dotClass)} />
  {label}
</Badge>
```

`dotClass` per UI-SPEC.md state table: live = `bg-primary`, reconnecting = `bg-amber-500 animate-pulse`, stopped = `bg-destructive`. Loader2 icon from `lucide-react` at `h-3 w-3 animate-spin` only in `reconnecting` state.

**Accessibility** (UI-SPEC.md §Accessibility): `role="status" aria-label="Verbindung live|wird aufgebaut|gestoppt"` — no analog, spec-driven.

---

### `web/lib/store/logs-store.ts` *(NEW — Zustand, optional per CONTEXT.md discretion)*

**Analog:** `web/lib/store/scan-store.ts` — exact match on shape (latest-only, no persistence, no ring buffer, single domain). Small store, few actions, `set`/`get` only.

**Full pattern to copy** (scan-store.ts lines 1-31):

```ts
"use client";
import { create } from "zustand";

interface LogsState {
  selectedContainerId: string | null;
  sincePreset: "1m" | "5m" | "15m" | "1h" | "6h" | "24h" | null; // null = default tail
  connectionState: "live" | "reconnecting" | "stopped" | "idle";

  selectContainer: (id: string | null) => void;
  setSincePreset: (p: LogsState["sincePreset"]) => void;
  setConnectionState: (s: LogsState["connectionState"]) => void;
}

export const useLogsStore = create<LogsState>((set) => ({
  selectedContainerId: null,
  sincePreset: null,
  connectionState: "idle",
  selectContainer: (id) => set({ selectedContainerId: id }),
  setSincePreset: (p) => set({ sincePreset: p }),
  setConnectionState: (s) => set({ connectionState: s }),
}));
```

Do NOT put the log-line buffer in the store (would cause re-renders at 100 lines/s). Keep the ring buffer in a `useRef<string[]>` inside `<LogViewer>` — matches the "store is data, timers live elsewhere" discipline from scan-store.ts's header comment (lines 7-9).

---

### `web/lib/types/logs.ts` *(NEW — shared types across sidecar + client)*

**Analog:** `web/lib/types/ros-messages.ts` — same role (cross-boundary type definitions, interfaces for wire-format messages).

**Pattern:** PascalCase interfaces, exported named, no default export.

```ts
export interface ContainerSummary {
  id: string;         // short id (12 chars) for URL; full id internally
  name: string;
  image: string;
  state: "running" | "exited" | "created" | "paused" | "restarting" | "dead";
}

export interface LogFrame {
  ts: number;                 // epoch ms
  stream: "stdout" | "stderr";
  line: string;               // one line, no trailing '\n'; ANSI preserved
}

export type SincePreset = "1m" | "5m" | "15m" | "1h" | "6h" | "24h";
```

---

### `docker-compose.yml` *(MODIFY — add :ro docker.sock mount to web service only)*

**Analog:** existing `web:` service block (lines 123-138). Insert `/var/run/docker.sock:/var/run/docker.sock:ro` as a third volume entry.

**Reference** (current state):

```yaml
  web:
    image: ghcr.io/danyial/mowbot/web:latest
    # ...
    volumes:
      - ./config:/app/config
      - mower-data:/app/data
```

**Diff:**

```yaml
    volumes:
      - ./config:/app/config
      - mower-data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock:ro   # NEW — Phase 6 LOGS-01..04
```

CONTEXT.md success gate: `:ro` suffix must appear in the docker-compose diff. No other service gets this mount.

---

### `web/components/layout/sidebar.tsx` + `mobile-nav.tsx` *(MODIFY — add `/logs` nav entry)*

**Analog:** the `navItems` arrays themselves (sidebar.tsx lines 19-26, mobile-nav.tsx lines 15-22). Insert one entry in both.

**Pattern to copy** (sidebar.tsx lines 19-26):

```tsx
const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/map", label: "Karte", icon: Map },
  { href: "/lidar", label: "LiDAR", icon: Radar },
  // + new:
  { href: "/logs", label: "Logs", icon: ScrollText },   // lucide ScrollText per UI-SPEC.md
  { href: "/teleop", label: "Steuerung", icon: Gamepad2 },
  { href: "/missions", label: "Aufträge", icon: ClipboardList },
  { href: "/settings", label: "Einstellungen", icon: Settings },
];
```

Add `ScrollText` to the lucide import block. Apply the identical change to `mobile-nav.tsx` so the mobile bottom nav also exposes `/logs`.

---

## Shared Patterns

### Logging prefix convention

**Source:** `web/server.mjs` (`[rosbridge-proxy] …`), `web/app/api/missions/route.ts` (`[missions] POST error: …`).

**Apply to:** every new server-side file.

- `server.mjs` logs branch: `[logs-stream]`
- `docker-adapter.ts`: `[docker-adapter]`
- `api/logs/containers/route.ts`: `[logs/containers]`

```ts
console.error("[logs/containers] GET error:", err);
console.log("[logs-stream] Client connected to", containerId);
```

### Exponential-backoff reconnect

**Source:** `web/lib/ros/ros-client.ts` lines 27-29, 234-246.

**Apply to:**
1. Node sidecar events-stream reconnect in `docker-adapter.ts`
2. Client-side WS reconnect in `log-viewer.tsx`

```ts
const INITIAL_RECONNECT_DELAY = 500;
const MAX_RECONNECT_DELAY = 5000;

// On close:
delay = Math.min(delay * 2, MAX_RECONNECT_DELAY);
// On successful open:
delay = INITIAL_RECONNECT_DELAY;
```

Operator UX stays consistent with `/rosbridge` reconnect cadence — requirement from CONTEXT.md §Reconnect & failure UX.

### Path-relative WebSocket URL resolution

**Source:** `web/lib/ros/ros-client.ts` lines 10-21 (resolver) + `web/server.mjs` line 16 (path-only env-var convention).

**Apply to:** the browser-side WS URL in `log-viewer.tsx`. Always build `ws(s)://<window.location.host>/logs/stream/<id>` so prod/dev/reverse-proxied deployments all Just Work, matching the `/rosbridge` pattern.

### Try/catch + German user-facing error strings

**Source:** `web/app/api/missions/route.ts` lines 179-185 + UI-SPEC.md copywriting table.

**Apply to:** `api/logs/containers/route.ts`. User-facing `error` body strings in German (`"Docker nicht erreichbar"`); `console.error` messages in English with a `[prefix]`.

### `cn()` + Tailwind token conditional styling

**Source:** `web/components/layout/sidebar.tsx` lines 66-72.

**Apply to:** every new presentational component. Always use `cn()` from `@/lib/utils` for conditional classes. Token-only colors — `bg-primary`, `text-muted-foreground`, `bg-destructive`, `bg-secondary`, `border-border`. Never introduce new hex colors (UI-SPEC.md §Design System lock).

### Zustand store shape

**Source:** `web/lib/store/scan-store.ts` lines 10-30.

**Apply to:** `logs-store.ts`. Rules: data-focused, no timers (`setInterval` belongs in the component, not the store), no persistence, latest-only state, small number of named actions.

### Client-only rendering via `dynamic({ ssr: false })`

**Source:** `web/app/lidar/page.tsx` lines 8-23.

**Apply to:** `web/app/logs/page.tsx`. Loading fallback in German ("Logs werden geladen…"). SSR off because the viewer opens a WebSocket and reads scroll metrics.

### File/directory naming (kebab-case, `@/` imports)

**Source:** `.planning/codebase/CONVENTIONS.md` §Files + §Path Aliases.

**Apply to:** every new file. `web/components/logs/log-viewer.tsx` (not `LogViewer.tsx`), `web/lib/store/logs-store.ts` (not `logsStore.ts`). All cross-module imports use `@/` — never relative.

---

## No Analog Found

No files in this phase lack an in-repo analog. Every new file has at least a role-match analog.

A couple of *techniques* (not files) are new to the codebase and must come from RESEARCH.md rather than a local example:

- **8-byte-header demux** via `container.modem.demuxStream(raw, stdoutPT, stderrPT)` — no existing analog; copy directly from RESEARCH.md §Code Examples 3-4.
- **Dockerode events stream** (`docker.getEvents({...})`) — no existing analog; RESEARCH.md §Code Examples 2 is the reference.
- **`ansi-to-html` render with `escapeXML: true` + `stream: true`** — no existing analog; RESEARCH.md is the reference.
- **`export const dynamic = "force-dynamic"` / no-cache on an App Router route handler** — not used elsewhere in the repo; standard Next.js 16 pattern.

## Metadata

**Analog search scope:** `web/app/**`, `web/components/**`, `web/lib/**`, `web/server.mjs`, `docker-compose.yml`
**Files scanned:** ~30 (web app surface + server + compose)
**Pattern extraction date:** 2026-04-15
