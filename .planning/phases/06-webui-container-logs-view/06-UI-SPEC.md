---
gsd_state_version: 1.0
phase: 6
slug: webui-container-logs-view
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-15
---

# Phase 6 — UI Design Contract: WebUI Container-Logs View

> Visual and interaction contract for the `/logs` route. The phase extends an existing Next.js 16 dashboard that already uses a shadcn-style stack (Radix primitives + Tailwind + HSL CSS variables) without a formal `components.json`. This spec locks tokens, states, and component contracts for the two-pane logs viewer so the planner and executor can implement without design ambiguity.

**Model product for UX tie-breakers:** Dozzle (https://dozzle.dev/). If an edge case isn't covered here, choose the Dozzle-equivalent behavior.

---

## Design System

| Property | Value | Source |
|----------|-------|--------|
| Tool | none (shadcn-style stack, no `components.json`) | `web/` absence of `components.json` confirmed |
| Preset | not applicable | — |
| Component library | Radix UI primitives (`@radix-ui/react-*`) wrapped by local `components/ui/*` | `web/package.json`, `web/components/ui/` |
| Icon library | `lucide-react` (`^0.577.0`) | `web/package.json` |
| Font | `Inter` via `next/font/google` (variable `--font-inter`) | `web/app/layout.tsx` |
| Theme | **Dark default** — `<html className="dark">` locked; light tokens exist but unused by AppShell | `web/app/layout.tsx:28` |
| Color model | Tailwind utilities keyed to HSL CSS variables in `globals.css` (`bg-background`, `text-foreground`, `bg-card`, `border-border`, etc.) | `web/tailwind.config.ts`, `web/app/globals.css` |
| Locale | German UI labels (match existing nav: "Karte", "Steuerung", "Aufträge") | `web/components/layout/sidebar.tsx:19-26` |

**Do NOT introduce:** new color tokens, new font families, new icon libraries, shadcn CLI, a `components.json`, or any third-party registry. This phase extends the existing token set only.

---

## Spacing Scale

Declared values (Tailwind defaults; all multiples of 4 from the standard set 4, 8, 16, 24, 32, 48, 64):

| Token | Tailwind | Value | Usage in `/logs` |
|-------|----------|-------|------------------|
| xs | `1` / `gap-1` | 4px | Chip internal icon gap, status-dot to label, log-row vertical padding (`py-1`) |
| sm | `2` / `gap-2` / `p-2` | 8px | Container-row padding-y, chip padding-y, list-item vertical rhythm |
| base | `4` / `p-4` | 16px | Container-list row padding-x, right-pane header padding (x + y), default component spacing |
| lg | `6` / `p-6` | 24px | Empty-state block padding |
| xl | `8` | 32px | Large layout gaps (not expected in this phase) |

Layout-specific fixed values:
- Left pane desktop width: **280px** (`w-[280px]`) — locked by CONTEXT.md
- Right-pane header height: **56px** (`h-14`) — matches existing AppShell header rhythm
- Log-row vertical padding: **4px** top + 4px bottom (`py-1`) — tightest value permitted by the multiple-of-4 rule; preserves terminal density
- Log-row horizontal padding: **16px** (`px-4`)
- Touch targets (chips, Resume pill, mobile drawer toggle): **min 44px** hit area — use `min-h-11` on clickable chips/pills

**Exceptions:** none. All spacing values used in this spec come from the standard set {4, 8, 16, 24, 32, 48, 64}.

---

## Typography

Three sizes, two weights. Inter for UI chrome; a monospace stack for the log stream.

| Role | Size | Weight | Line Height | Tailwind | Font family |
|------|------|--------|-------------|----------|-------------|
| Log line (stream body) | 13px | 400 regular | 1.5 (19.5px) | `text-[13px] leading-[1.5] font-normal` | `font-mono` (ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas) |
| Log gutter (timestamp) | 13px | 400 regular | 1.5 | `text-[13px] font-normal text-muted-foreground` | `font-mono` |
| UI body (container list, headers, empty/error copy) | 14px | 400 regular | 1.5 | `text-sm leading-normal` | Inter (`font-sans`) |
| UI label / chip / badge | 12px | 600 semibold | 1.2 | `text-xs font-semibold leading-tight` | Inter |
| Section heading (page title "Logs" inside pane header) | 16px | 600 semibold | 1.2 | `text-base font-semibold leading-tight` | Inter |

**Declared weights:** regular (400) + semibold (600). No other weights.
**Declared sizes:** 12, 13, 14, 16 (four sizes; 13 is the monospace-only exception for terminal density).
**Tabular figures:** gutter timestamps use `tabular-nums` (`font-mono` in the stack above already delivers fixed-width digits).

---

## Color

Dark theme is authoritative. 60/30/10 split expressed against the existing `globals.css` dark palette:

| Role | Token | Hex (HSL decoded) | Usage |
|------|-------|-------------------|-------|
| Dominant (60%) | `--background` → `hsl(222.2 84% 4.9%)` | `#030712` | Page background, log-stream scroll surface, mobile drawer overlay scrim base |
| Secondary (30%) | `--card` / `--secondary` / `--muted` → `hsl(222.2 84% 6.9%)` / `hsl(217.2 32.6% 17.5%)` | `#0b0f1a` / `#1e2736` | Left pane (container list) surface, right-pane header bar, chip inactive background |
| Accent (10%) | `--primary` → `hsl(142.1 70.6% 45.3%)` | `#22c55e` (green-500-ish) | Selected container row, active preset chip, "live" connection-status dot, "Resume auto-scroll" pill |
| Destructive | `--destructive` → `hsl(0 62.8% 50.6%)` | `#dc2626` (red-600-ish) | "stopped" connection-status dot, stderr line left-border indicator, "Docker daemon unreachable" inline banner |
| Warning (state-only, not a brand color) | Tailwind `amber-500` `hsl(37.7 92.1% 50.2%)` | `#f59e0b` | "reconnecting" connection-status dot + spinner (no other use) |
| Foreground / body text | `--foreground` → `hsl(210 40% 98%)` | `#f8fafc` | Log-line text default, body copy |
| Muted foreground | `--muted-foreground` → `hsl(215 20.2% 65.1%)` | `#94a3b8` | Gutter timestamp, "faint" per CONTEXT.md; stopped-container label; secondary metadata |
| Border | `--border` → `hsl(217.2 32.6% 17.5%)` | `#1e2736` | Pane divider, list-row separator, header underline |

**Accent reserved for:**
1. The currently-selected container row in the left list (`bg-primary/10 text-primary`, matching sidebar active state).
2. The currently-active preset chip (solid `bg-primary text-primary-foreground`).
3. The "live" connection-state dot (solid `bg-primary`, 8px circle).
4. The "Resume auto-scroll" pill (outline `border-primary text-primary`, shown only when auto-scroll is paused).

**Accent NOT used for:** regular buttons, inactive chips, hover states on list rows, the container-name badge, the status-dot on running containers (use `bg-emerald-500` or `bg-primary` — pick `bg-primary` to stay within tokens).

**ANSI color rendering:** `ansi-to-html` emits `<span style="color:#..">` inline. These colors bypass the token system by design — they are *data*, not *chrome*. Wrap the stream area in `text-foreground` so uncolored lines inherit the foreground token; colored spans override per ANSI code. No custom ANSI palette override — accept the library's default 16-color xterm palette.

**Line-stream coloring convention:**
- stdout lines: default `text-foreground`
- stderr lines: prefix with a 2px left border `border-l-2 border-destructive/60 pl-[14px]` (replaces the normal `pl-4`, preserving 16px visual left padding inclusive of border) — subtle enough not to shout, clear enough to spot at scroll speed.

---

## Component Contract

### Layout: Two-pane Split

- **Desktop (≥768px):** CSS grid `grid-cols-[280px_1fr]` inside the AppShell main slot; full viewport minus AppShell header/bottom-nav.
- **Mobile (<768px):** Right pane only; container list is a `Radix Dialog` drawer triggered from a `Menu` icon in the right-pane header. Use the existing `@radix-ui/react-dialog` primitive (already installed). Drawer slides from left, 85vw max, same `bg-card` surface.

### Left pane: Container list

- Header row (56px / `h-14`): label "Container" (`text-sm font-semibold`), right-aligned refresh-state dot (tiny `h-2 w-2 rounded-full`; green = events stream healthy, amber = reconnecting, red = `docker.sock` unreachable). No refresh button — the events stream is live. Header padding: `px-4 py-4`.
- Each row: 44px min height (`min-h-11`), padded `px-4 py-2`, flex layout:
  - Status dot (8px, `bg-primary` running / `bg-muted-foreground` exited)
  - Container name (truncate, `text-sm`), primary line
  - Image tag (truncate, `text-xs text-muted-foreground`), secondary line
- Hover: `hover:bg-accent/50`
- Selected: `bg-primary/10 text-primary` (matches existing sidebar active state for visual continuity)
- Exited containers: rendered at reduced opacity (`opacity-60`) with gray status dot; still selectable (to view historical tail)
- Empty list: "Keine Container gefunden" centered in `text-muted-foreground text-sm` with a secondary line "Docker-Compose läuft nicht oder kein `mowerbot`-Projekt aktiv."
- Docker unreachable: replace list content with the inline error banner spec below.

### Right pane: Log stream

Composed of three stacked regions:

1. **Header bar** (`h-14`, `bg-card`, `border-b border-border`, `px-4`): flex row with:
   - Container-name badge: `text-base font-semibold` + inline status dot (8px)
   - Connection-state badge (see state machine below)
   - Preset-chip row (6 chips + implicit "default" state when none active)
   - Spacer (`flex-1`)
   - "Resume auto-scroll" pill — conditional, right-aligned, 32px height (`h-8`)
2. **Stream scroller** (`flex-1 overflow-y-auto bg-background font-mono text-[13px] leading-[1.5]`): the log surface. Scroll container also owns the auto-scroll pause detection.
3. **(No footer)** — no status bar below the stream. State lives in the header.

### Log line (row)

```
[HH:MM:SS.sss]  <stdout or stderr content with ANSI spans>
└─ gutter ─┘    └──────────── content ────────────────────┘
  14 chars        flex-1
  text-muted-     text-foreground (or stderr: border-l-2 border-destructive/60)
  foreground
  tabular-nums
  select-none
  mr-4
```

- Whole row: `px-4 py-1`
- Long lines: **wrap**, do not truncate (`whitespace-pre-wrap break-all`). Operator needs to see the full stderr, and Tailwind `break-all` handles pathless token floods from ROS warnings.
- Row hover: no background change (would thrash at scroll speed). Optionally show a one-off copy icon on hover via `opacity-0 group-hover:opacity-100` — **defer to Future unless trivial**; not required this phase.
- Gutter timestamp is **derived from the Docker `timestamps: true` output**, formatted client-side to `HH:MM:SS.sss` in the operator's local timezone. Do not show the date; the time window is always "recent".

### Preset chip row

Six chips: `1m` `5m` `15m` `1h` `6h` `24h`. Plus an implicit seventh state "default" (no filter, `tail=200`).

- Chip visual (inactive): `h-8 px-2 rounded-md text-xs font-semibold bg-secondary text-secondary-foreground hover:bg-secondary/80`
- Chip visual (active): `bg-primary text-primary-foreground`
- Gap between chips: `gap-1` (4px)
- When a preset is active, a small "Alle" ghost button appears to its right to clear back to default tail. Ghost button: `text-xs text-muted-foreground hover:text-foreground underline underline-offset-2`.
- Changing a chip closes the current WS and opens a new one — no optimistic highlight until the new socket opens. Until then, the chip shows the "reconnecting" shimmer via Tailwind `animate-pulse`.

### Connection-state badge

Three explicit states. Single `<span>` with icon + label:

| State | Dot color | Label (German) | Animation |
|-------|-----------|----------------|-----------|
| `live` | `bg-primary` (green) | "Live" | none |
| `reconnecting` | `bg-amber-500` | "Verbinde…" | `animate-pulse` on dot + lucide `Loader2` icon at `animate-spin h-3 w-3` |
| `stopped` | `bg-destructive` (red) | "Gestoppt" | none |

Shape: `h-6 px-2 rounded-full bg-secondary text-xs font-semibold inline-flex items-center gap-1.5`. Dot is `h-2 w-2 rounded-full`.

### Resume auto-scroll pill

- Visibility: only when auto-scroll is paused (operator scrolled up).
- Shape: `h-8 px-2 rounded-full border border-primary text-primary text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-primary/10`
- Icon: lucide `ArrowDown` at `h-3 w-3`
- Copy: "Neueste anzeigen"
- Click: scrolls stream container to `scrollHeight` smoothly and re-enables auto-scroll.

### Container-name badge (header)

- Shape: inline flex row, not a pill. `gap-2 items-center`.
- Contents: status dot (8px) + container name (`text-base font-semibold truncate max-w-[240px]`) + image tag (`text-xs text-muted-foreground truncate max-w-[180px]`).
- Click: opens a `Radix Tooltip` with the full name, image, created-at timestamp. Tooltip is the only place the creation date appears.

---

## State Machine: Connection → Visual

| Client state | Header badge | Stream content | Resume pill | Chips |
|--------------|--------------|----------------|-------------|-------|
| No container selected | not shown | Empty state (see below) | hidden | disabled (`opacity-50 pointer-events-none`) |
| Connecting (first open, pre-onopen) | `reconnecting` / "Verbinde…" | Single row: "Verbinde mit `<name>`…" in `text-muted-foreground italic` | hidden | enabled |
| Connected, no backfill yet | `live` | Single row: "Warte auf Logzeilen…" `text-muted-foreground italic` | hidden | enabled |
| Streaming (auto-scroll on) | `live` | Log lines, auto-scroll to bottom | hidden | enabled |
| Streaming (paused) | `live` | Log lines, scroll frozen at user position | **visible** | enabled |
| WS closed unexpectedly (in backoff) | `reconnecting` | Keep prior buffer visible; append one system row: "Verbindung getrennt, Wiederverbindung…" | preserve previous visibility | enabled |
| WS terminally closed (container destroyed, or `docker.sock` gone) | `stopped` | Keep prior buffer; append one system row: "Container existiert nicht mehr — neu wählen." in `text-destructive` | hidden | disabled |
| Docker daemon unreachable (list endpoint 503) | n/a (no stream yet) | Left pane shows the banner; right pane shows its own empty state | hidden | disabled |

**System rows** (synthetic lines injected by the client, not from Docker): rendered in italic `text-muted-foreground` with an em-dash gutter "— —" instead of a timestamp. Do not include them in "line count" or auto-scroll offset math.

---

## Copywriting Contract

All operator-facing strings in German (matches existing dashboard locale). English in parentheses below is for the implementer's reference only.

| Element | Copy (de) |
|---------|-----------|
| Nav label (sidebar + mobile) | **Logs** |
| Nav icon | lucide `ScrollText` (choose `ScrollText` over `Terminal` — semantically "logs", not "shell"; matches the read-only-observability framing) |
| Page-level header (left pane label) | "Container" |
| Container-list empty state | Heading: "Keine Container gefunden" · Body: "Docker-Compose läuft nicht oder kein `mowerbot`-Projekt aktiv." |
| Right-pane initial empty state | Heading: "Kein Container ausgewählt" · Body: "Wähle links einen Container, um Logs zu sehen." |
| Right-pane mobile empty state (list is drawer) | Heading: "Kein Container ausgewählt" · Body: "Tippe auf **Container**, um einen auszuwählen." + button "Container öffnen" |
| Loading (pre-first-message) | "Verbinde mit `<container-name>`…" |
| Connection state — live | "Live" |
| Connection state — reconnecting | "Verbinde…" |
| Connection state — stopped | "Gestoppt" |
| Resume auto-scroll pill | "Neueste anzeigen" |
| Preset chip labels | `1m`, `5m`, `15m`, `1h`, `6h`, `24h` (untranslated — standard duration shorthand) |
| Clear-preset ghost button | "Alle" (meaning: show the default tail, no since filter) |
| Stderr-line subtle hint (aria-label on the stderr border) | `aria-label="Fehlerausgabe"` |
| Docker unreachable banner (inline, spans list area) | Heading: "Docker nicht erreichbar" · Body: "Der Docker-Daemon antwortet nicht. Neuer Versuch läuft…" · Icon: lucide `AlertTriangle` `text-destructive` |
| Container-destroyed system row (synthetic stream line) | "Container existiert nicht mehr — neu wählen." |
| Connection-lost system row | "Verbindung getrennt, Wiederverbindung…" |
| Primary CTA | **None.** This view is observational. The closest analog is the preset chip selection — no distinct primary button exists. |
| Error (WS terminal, non-destroy) | Inline system row in `text-destructive`: "Logstream konnte nicht geöffnet werden." · No retry button — state badge stays on `reconnecting` while backoff runs; the socket retries automatically. |
| Destructive confirmations | **None.** No destructive actions exist in this phase (no lifecycle buttons, no clear-buffer button). If a clear-buffer button is added later, it would not be destructive against server state. |

**Tone:** terse, operator-facing, mirrors the existing dashboard's voice (see "Aufträge", "Steuerung"). No emojis. No exclamation points. No "Oops" / "Sorry" — the operator is debugging, not being reassured.

---

## Accessibility

- Scroll container: `tabindex="0"` so keyboard users can focus it and page-up/page-down. Arrow keys scroll natively.
- Scroll container has `role="log"` and `aria-live="polite"` **only when auto-scroll is active**. When paused, drop `aria-live` to avoid spurious announcements while the user reads.
- Connection-state badge: `role="status"` with `aria-label` echoing the state ("Verbindung live", "Verbindung wird aufgebaut", "Verbindung gestoppt").
- Preset chips: grouped in `role="group" aria-label="Zeitfenster"`. Each chip is a `<button aria-pressed={active}>`.
- Resume pill: `<button>` with visible label; no `aria-hidden`.
- **Mobile drawer trigger:** the lucide `Menu` icon-only button in the right-pane header MUST declare `aria-label="Container-Liste öffnen"`. It is the only entry point to the container list on mobile; without the label, assistive tech would read it as an unlabeled button.
- Color contrast: all declared token pairs meet WCAG AA on dark theme — `--foreground` on `--background` ≈ 15.5:1; `--muted-foreground` on `--background` ≈ 5.4:1 (gutter timestamps); `--primary` on `--background` ≈ 4.9:1 (selected chip text uses `--primary-foreground` on `--primary`, which is dark-on-green ≈ 8:1). No further token edits required.
- Focus ring: rely on existing `--ring` token + default browser outline; the project's `button.tsx` already wires `focus-visible:ring-2 focus-visible:ring-ring`.

---

## Performance & Density Budget

These are design contract constraints, not implementation suggestions. The checker can verify them visually; the executor must not exceed them.

| Constraint | Target | Rationale |
|------------|--------|-----------|
| Sustained log rate without visible jank | ≥100 lines/s | Matches CONTEXT.md §Claude's Discretion note |
| Max in-memory line buffer | 10,000 lines | Hard cap before oldest-line eviction; prevents DOM blowup on long sessions |
| First meaningful paint after container select | ≤500ms on LAN | WS open + first backfill chunk |
| Auto-scroll threshold (pause detection) | 24px from bottom | Friendly enough that a 1-row overscroll doesn't pause; precise enough to catch intentional scroll-up |
| Chip click → new stream onopen | ≤800ms on LAN | Acceptable UX for close-and-reopen |

---

## Responsive Behavior

| Breakpoint | Layout |
|------------|--------|
| `<768px` (mobile) | Right pane full-width; left pane is a Radix Dialog drawer. Drawer trigger = lucide `Menu` icon button at the far left of the header bar with `aria-label="Container-Liste öffnen"`. Preset chips wrap to a second row if needed (`flex-wrap`). Container-name badge truncates to `max-w-[140px]`. |
| `768px–1279px` (tablet) | Two-pane grid `grid-cols-[240px_1fr]` (left pane compressed to 240px; chip labels stay full). |
| `≥1280px` (desktop) | Two-pane grid `grid-cols-[280px_1fr]` per CONTEXT.md. |

No orientation-specific rules. The AppShell's existing bottom-nav on mobile continues to reserve its safe-area space below the stream.

---

## Out-of-Spec / Explicit Non-Goals

These visuals/interactions are **explicitly not in this phase** and the executor MUST NOT add them:

- No log-level (WARN/ERROR) highlight rules. ANSI from the source is the only highlight.
- No search / filter box inside the stream. Presets are the only filter.
- No download / copy-all button.
- No container lifecycle buttons (start/stop/restart).
- No merged multi-container view.
- No settings modal for stream preferences (font size, timestamp toggle, line wrap) — all locked by this contract.
- No toast notifications for any state. Every state lives inline in the header or as a synthetic stream row.
- No modal dialogs for errors.
- No dark/light mode toggle — `dark` class on `<html>` stays hard-coded at this phase.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — no shadcn CLI in this project |
| third-party | none | not applicable |

No component-registry operations this phase. All new components are authored in-repo under `web/components/logs/` (planner's choice of split) and compose existing primitives from `web/components/ui/`.

---

## Traceability

| REQ-ID | Contract section(s) covering it |
|--------|---------------------------------|
| LOGS-01 (live container list) | Layout § Left pane; Copywriting § container-list empty state + Docker-unreachable banner; State Machine § Docker daemon unreachable |
| LOGS-02 (select → backfill + tail) | State Machine rows (Connecting, Connected-no-backfill, Streaming); Log-line row spec; Connection-state badge (`live`) |
| LOGS-03 (auto-scroll + pause/resume) | Resume auto-scroll pill; State Machine § Streaming (paused); Performance § auto-scroll threshold |
| LOGS-04 (since= preset filter) | Preset chip row; State Machine § chip click → shimmer; Performance § chip click budget |
| Regression: `/rosbridge` untouched | Not a UI contract — enforced by CONTEXT.md §Architecture and the planner/executor. The UI emits **no** behavior that would affect `/rosbridge`; badge/state is read-only. |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

---

*Authored 2026-04-15 by gsd-ui-researcher. Consumed by gsd-ui-checker, gsd-planner, gsd-executor, gsd-ui-auditor.*
