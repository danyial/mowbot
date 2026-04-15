# Phase 4 Plan Check v2 — Re-verification after revision

**Checked:** 2026-04-14 (re-check)
**Plans:** 04-01-PLAN.md r2 (commit 81a7344), 04-02-PLAN.md r2 (commit 12ac42a)

| Plan | Verdict | Blockers | Flags |
|------|---------|----------|-------|
| 04-01 | **PASS** | 0 | 0 |
| 04-02 | **PASS with watched risks** | 0 | 2 (execution-time) |

**Go/no-go: GO — execute 04-01 then 04-02.**

---

## Prior-issue closure audit

| Prior | Status | Evidence |
|-------|--------|----------|
| 04-01 Flag A (Plan-B fallback) | **CLOSED** | Task 7 is a real `auto gate="conditional"` task — edits `ekf.yaml` (`publish_tf: false`), injects `static_transform_publisher(odom→base_link)` into `mower_nav_launch.py`, redeploys + re-runs probe 3. Gated on Task 6 resume-signal `"run-plan-b"`. Pre-staged, not prose. |
| 04-01 Flag B (SSH auth) | **CLOSED** | `<ssh_invocation>` block pins canonical `sshpass -p password ssh -o …` with explicit `brew install hudochenkov/sshpass/sshpass`. Every Pi step references `$SSHP`/`$SCPP`. No ambiguity. |
| 04-01 Flag C (regression gate) | **CLOSED** | Task 4 automated verify asserts 9-service set via `yaml.safe_load`; Task 5 step 7 re-asserts live with `docker compose ps`. |
| 04-02 Blocker #1 (cascade into /map) | **CLOSED** | Option 2 confirmed by reading `scan-canvas.tsx` + `scan-overlay.tsx`: anchored branch uses `projector`+`mountTarget`, standalone owns `viewRef`/`bumpView`/`viewTick`. Plan edits are additive to standalone-only paths; `underlay` prop untouched by `scan-overlay.tsx` (doesn't pass it). Task 5a sentinel (canvas count 2–3, no MapBitmap leak, no console errors) is a **real** regression net — it would catch a leaked MapBitmap or a newly noisy anchored-branch render. Not a placebo. |
| 04-02 Blocker #2 (⌂ vs Eraser) | **CLOSED** | P3.1 asserts Eraser→map clears AND view snapshot unchanged; P4.1 asserts ⌂→view resets AND `useMapStore.latest` object identity + bitmap pixel count unchanged. True two-way. |
| 04-02 Flag D (TRANSIENT_LOCAL) | **CLOSED** | P1.1 strengthened: fresh context, 3 s deadline, `window.__mapFirstAt` instrumentation; soft-fail with `[P1.1] LATCHED DELIVERY UNCONFIRMED` documented compensating control. |
| 04-02 Flag E (optimistic clear) | **CLOSED** | Task 2 onClick keeps `useMapStore.clear()` with explicit "removing this breaks P3's 2 s assertion" comment. |
| 04-02 Flag G (v0 stationary) | **CLOSED** | Code-comment addendum in MapBitmap skeleton + explicit SUMMARY obligation in `<output>` block naming the v1 deferral. |

---

## New risks poked

1. **Render-prop thrash.** `underlay` is invoked inside `useMemo([viewTick, cartesian, standalone])` — NOT on every React render, only on `viewTick` bump (wheel/drag) or new scan (~10 Hz). MapBitmap only re-composites on `transform` prop-identity change; `putImageData` stays keyed on `latest` identity (~1 Hz). At 10 Hz scan × 1080×784, this is `drawImage` once per scan — benign. **No perf issue.**
2. **`files_modified` audit.** Matches actual touched set: `web/lib/types/ros-messages.ts`, `web/lib/ros/{topics,services}.ts`, `web/lib/store/{map-store,ros-store}.ts`, `web/components/lidar/{scan-canvas.tsx,map-bitmap.tsx}`, `web/app/lidar/page.tsx`. No `view-store.ts` (Option 2 avoids it). `scan-overlay.tsx` correctly absent. Clean.
3. **SUMMARY obligation.** Both `<output>` blocks explicitly mandate Flag-G v0-limitation content (04-02) and Plan-B outcome (04-01). Honored.

---

## Execution-time watched flags (non-blocking)

- **W1 — MapBitmap anchor drift (was Flag G):** v0 renders correctly only near-origin/stationary. P1/SC#4 are stationary; SC#3 P2 probe stops `/scan` but doesn't drive the robot. If operator drives during human-verify, scan and bitmap diverge visibly — expected, document in SUMMARY, do NOT retry.
- **W2 — P1.1 latched delivery:** soft-fail acceptable per plan. If `[P1.1] LATCHED DELIVERY UNCONFIRMED` fires, verify the 2 s republish compensates; if >5 s observed, escalate.

## Dependency & context

04-01 (wave 1, `depends_on: []`) → 04-02 (wave 2, `depends_on: [04-01]`). No cycles. All MAP-01..MAP-05 covered. CLAUDE.md constraints (ROS2 Humble, host-networked Docker, Next.js App Router, CycloneDDS, preserved typed-array scrubber exemption) all honored.

## Recommendation

Execute 04-01. On Task 6 approval (or Plan-B success), execute 04-02. Watch W1 + W2 during Task 5b human-verify; neither blocks checkpoint.
