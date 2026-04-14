# Phase 0: GSD Brownfield Adoption - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Formally adopt the existing MowerBot repo as the GSD-managed brownfield baseline. Phase 0 is a meta/attestation phase — it does NOT modify product code, hardware, or existing `.planning/` artifacts. It verifies that the GSD scaffolding is in place, records an adoption receipt, and places a git anchor for future forensics.

Out of bounds for this phase: any edits to product code, firmware, web, docker, or hardware; any rework of existing `.planning/` documents (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md already approved); any commits to `hardware/` WIP (belongs to Phase 1).

</domain>

<decisions>
## Implementation Decisions

### Execution Scope
- **D-01:** Phase 0 is **pure attestation**. Deliverable is a single new file + a git tag. No edits to PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, config.json, or `.planning/codebase/`.
- **D-02:** Verification must programmatically confirm the three ROADMAP.md success criteria:
  1. Core `.planning/` files exist, are committed, reflect the LD19 milestone.
  2. `.planning/codebase/` artifacts (ARCHITECTURE, STACK, STRUCTURE, CONCERNS, CONVENTIONS, INTEGRATIONS, TESTING) are present.
  3. A human reading `PROJECT.md` alone can identify core value, v1 scope, and out-of-scope items.
- **D-03:** Produce `.planning/phases/00-gsd-brownfield-adoption/ADOPTION.md` — a short receipt listing: date, commit SHA of baseline, checklist of success-criterion evidence (file paths + commit SHAs), and the tag name. This is the human-readable adoption record.

### Baseline Marker
- **D-04:** Create annotated git tag **`gsd-baseline-v0`** on the Phase 0 completion commit (the commit that adds ADOPTION.md). Tag message references `.planning/PROJECT.md` and the milestone name ("LD19 LiDAR Integration").
- **D-05:** `ADOPTION.md` + `gsd-baseline-v0` tag together are the canonical "adoption point" anchor. Future `/gsd-forensics` and "pre-adoption vs GSD-managed" diffs reference the tag.

### Hardware WIP Handling
- **D-06:** Uncommitted files under `hardware/` (PCB v2.0 `.kicad_*` edits, `.step` models, DRC reports, `production/`, `backups/`) are **explicitly deferred to Phase 1** (Hardware & UART Routing). Phase 0 does not stage, commit, or `.gitignore` them.
- **D-07:** `ADOPTION.md` must call out the dirty `hardware/` tree as known state at adoption time so Phase 1 inherits it cleanly — not a regression, not lost work.

### STATE.md Lifecycle
- **D-08:** STATE.md is refreshed at **phase transitions only** (phase start + phase completion), driven by GSD workflows. Plan-level progress lives in `PLAN.md` / `VERIFICATION.md` inside the phase directory.
- **D-09:** Phase 0's completion is itself a phase transition — STATE.md must be updated as part of Phase 0 completion to reflect: "Phase 0 complete, baseline tagged, moving to Phase 1".

### Claude's Discretion
- Exact format of `ADOPTION.md` (headings, how to present the evidence checklist). Target: one screen, machine-greppable SHAs.
- Exact wording of the tag annotation message.
- Whether verification uses a small bash script committed into the phase dir or is performed inline by the executor — planner decides based on reuse potential.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & success criteria
- `.planning/ROADMAP.md` §"Phase 0: GSD Brownfield Adoption" — goal and three success criteria verbatim.
- `.planning/REQUIREMENTS.md` §"GSD Initialization" — META-01 (the sole requirement mapped to this phase).

### Milestone anchors (verified, don't rewrite)
- `.planning/PROJECT.md` — core value, constraints, out-of-scope. The "human can identify v1 scope" criterion verifies against this file.
- `.planning/STATE.md` — to be refreshed as part of Phase 0 completion; current version from 2026-04-14.
- `.planning/config.json` — existing GSD config; do not modify in Phase 0.

### Brownfield baseline (preserve, do not re-derive)
- `.planning/codebase/ARCHITECTURE.md`, `STACK.md`, `STRUCTURE.md`, `CONCERNS.md`, `CONVENTIONS.md`, `INTEGRATIONS.md`, `TESTING.md` — the pre-GSD brownfield inventory. Phase 0 verifies presence; subsequent phases consume.
- `.planning/research/SUMMARY.md` (+ STACK, ARCHITECTURE, FEATURES, PITFALLS) — 2026-04-14 research pass; referenced by later phases, not by Phase 0.

No external specs or ADRs apply to Phase 0 — it is a workflow/meta phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Git is already configured (main branch, clean history up to `6c53f58 docs: create roadmap`). No branch strategy set (`git.branching_strategy: "none"` in `.planning/config.json`) — Phase 0 work lands directly on main.
- Existing commit-message convention observable in recent log: `docs:`, `chore:`, `feat:`, `fix:` prefixes. ADOPTION commit should follow (`docs:` or `chore:`).

### Established Patterns
- Phase directory layout: GSD uses `.planning/phases/{padded}-{slug}/`. Phase 0 dir is `.planning/phases/00-gsd-brownfield-adoption/` — already created by this discuss step.
- `.planning/config.json` sets `commit_docs: true` — GSD will commit the CONTEXT/PLAN/VERIFICATION files automatically.

### Integration Points
- `ADOPTION.md` lives inside the Phase 0 directory, NOT at `.planning/` root — keeps phase artifacts colocated.
- Git tag `gsd-baseline-v0` is a repo-level artifact; push is optional (user controls remote sync), but create locally as part of Phase 0 completion.

</code_context>

<specifics>
## Specific Ideas

- "Adoption receipt" framing: the user is treating Phase 0 as a formal handoff from pre-GSD brownfield to GSD-managed. ADOPTION.md should read like a receipt (date, evidence, signature-equivalent = tag), not like a README or a status report.
- Belt-and-suspenders on the marker: user explicitly chose BOTH a git tag AND a receipt file rather than picking one. Don't collapse them in planning — they serve different audiences (tag for tooling, file for humans).

</specifics>

<deferred>
## Deferred Ideas

- **Hardware WIP cleanup** — PCB v2.0 files, STEP models, DRC reports under `hardware/` stay uncommitted through Phase 0. Phase 1 (Hardware & UART Routing) owns staging/committing these alongside LD19 pigtail wiring work.
- **PROJECT.md polish / ROADMAP cross-links** — user explicitly rejected scope expansion into document editing this phase. If gaps surface later, handle via a targeted `/gsd-quick` or capture as a v2 requirement.
- **Remote push of `gsd-baseline-v0`** — create locally; user decides when/whether to push.

</deferred>

---

*Phase: 00-gsd-brownfield-adoption*
*Context gathered: 2026-04-14*
