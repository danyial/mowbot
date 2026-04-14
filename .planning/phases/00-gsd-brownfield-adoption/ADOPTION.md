# MowerBot GSD Adoption Receipt

## Adoption Receipt

- **Date:** 2026-04-14
- **Milestone:** LD19 LiDAR Integration
- **Baseline Commit SHA:** 62d7ee399d6cb174093fe778c43683616d06878d (pre-adoption HEAD)
- **Tag (placed on this phase's commit):** `gsd-baseline-v0` (annotated, local only)
- **Project reference:** [.planning/PROJECT.md](../../PROJECT.md)
- **Requirement:** META-01

This receipt + the annotated tag `gsd-baseline-v0` together formally adopt the existing MowerBot repository as the GSD-managed brownfield baseline. No product, firmware, web, docker, or hardware code is modified by Phase 0 — pure attestation per `00-CONTEXT.md` D-01.

## Success Criteria Evidence

Per `.planning/ROADMAP.md` §"Phase 0: GSD Brownfield Adoption" — all three success criteria verified against repo state.

| Criterion | Evidence (path) | Last Commit SHA | Status |
|-----------|-----------------|-----------------|--------|
| 1. Core .planning/ files exist, committed, reflect LD19 milestone | .planning/PROJECT.md | b8345606b0a3cdaa008113a69300be50a8a6f283 | ✓ verified |
| 1. Core .planning/ files exist, committed, reflect LD19 milestone | .planning/REQUIREMENTS.md | b8345606b0a3cdaa008113a69300be50a8a6f283 | ✓ verified |
| 1. Core .planning/ files exist, committed, reflect LD19 milestone | .planning/ROADMAP.md | 62d7ee399d6cb174093fe778c43683616d06878d | ✓ verified |
| 1. Core .planning/ files exist, committed, reflect LD19 milestone | .planning/STATE.md | 6c53f58e2715cb90e4b844ca58c85c9cd7ad8676 | ✓ verified |
| 1. Core .planning/ files exist, committed, reflect LD19 milestone | .planning/config.json | dcc2b5fa7123fbbd33b08a1c02f6ce673049bfc8 | ✓ verified |
| 2. Codebase inventory artifacts present | .planning/codebase/ARCHITECTURE.md | fb1a58888a20eb381a6c4d2e43b23556a7f34302 | ✓ present |
| 2. Codebase inventory artifacts present | .planning/codebase/STACK.md | fb1a58888a20eb381a6c4d2e43b23556a7f34302 | ✓ present |
| 2. Codebase inventory artifacts present | .planning/codebase/STRUCTURE.md | fb1a58888a20eb381a6c4d2e43b23556a7f34302 | ✓ present |
| 2. Codebase inventory artifacts present | .planning/codebase/CONCERNS.md | fb1a58888a20eb381a6c4d2e43b23556a7f34302 | ✓ present |
| 2. Codebase inventory artifacts present | .planning/codebase/CONVENTIONS.md | fb1a58888a20eb381a6c4d2e43b23556a7f34302 | ✓ present |
| 2. Codebase inventory artifacts present | .planning/codebase/INTEGRATIONS.md | fb1a58888a20eb381a6c4d2e43b23556a7f34302 | ✓ present |
| 2. Codebase inventory artifacts present | .planning/codebase/TESTING.md | fb1a58888a20eb381a6c4d2e43b23556a7f34302 | ✓ present |
| 3. PROJECT.md alone conveys core value, v1 scope, out-of-scope | .planning/PROJECT.md §"Core Value" L7 and §"Requirements>Active" L11-L32 and §"Out of Scope" L34-L44 | b8345606b0a3cdaa008113a69300be50a8a6f283 | ✓ verified |

LD19 milestone reference confirmed in all three core docs via `grep -q "LD19"` (PROJECT.md, ROADMAP.md, REQUIREMENTS.md).

## Known State at Adoption

Uncommitted files under `hardware/` (PCB v2.0 `.kicad_*` edits, `.step` models, DRC reports, `production/`, `backups/`) plus `MowerBot-MotorController-erc.rpt` and modifications to `docs/pcb-motor-controller.md` are DEFERRED to Phase 1 per CONTEXT.md D-06. Phase 0 does not stage, commit, or `.gitignore` them.

Exact `git status --porcelain` snapshot at adoption time:

- ` M docs/pcb-motor-controller.md`
- ` M hardware/MowerBot-MotorController.kicad_pcb`
- ` M hardware/MowerBot-MotorController.kicad_prl`
- ` M hardware/MowerBot-MotorController.kicad_pro`
- ` M hardware/MowerBot-MotorController.kicad_sch`
- `?? MowerBot-MotorController-erc.rpt`
- `?? hardware/ADS1115.step`
- `?? hardware/BTS7960.step`
- `?? hardware/GY521_MPU6050.step`
- `?? hardware/MINI560.step`
- `?? hardware/MowerBot-MotorController-schematic.pdf`
- `?? hardware/MowerBot-MotorController_drc_violations.json`
- `?? hardware/MowerBot.kicad_sym`
- `?? hardware/MowerBot.pretty/`
- `?? hardware/backups/`
- `?? hardware/fabrication-toolkit-options.json`
- `?? hardware/fp-lib-table`
- `?? hardware/production/`
- `?? hardware/sym-lib-table`

This is known state, not a regression. Phase 1 (Hardware & UART Routing) inherits and commits these.

## Baseline Anchor

`ADOPTION.md` + the annotated git tag `gsd-baseline-v0` together are the canonical adoption anchor for MowerBot under the GSD workflow (per CONTEXT.md D-05). Future `/gsd-forensics` runs and pre-adoption vs GSD-managed diffs should reference the tag as the boundary.

The tag is created LOCALLY only and intentionally NOT pushed — remote sync is under user control (per CONTEXT.md deferred-ideas section).
