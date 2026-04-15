---
task: cleanup-ttyesp32
created: 2026-04-14
type: quick
---

# Clean up obsolete `/dev/ttyESP32` references

The ESP32 motor controller runs on UART `/dev/ttyAMA0` (see `docker-compose.yml:23`), not USB. Several files still reference the dead `/dev/ttyESP32` symlink from the pre-HAT topology. The `.env.example` line is a real config bug: it overrides the correct docker-compose default `${ESP32_DEVICE:-/dev/ttyAMA0}`, so fresh installs copying `.env.example` verbatim point micro-ros-agent at a non-existent device.

## Files touched

- `.env.example` — change `ESP32_DEVICE` to `/dev/ttyAMA0` (bug fix)
- `udev/99-mower.rules` — delete dead CP2102→ttyESP32 rule
- `setup.sh` — update log message to drop ttyESP32 reference
- `CLAUDE.md` — update ESP32_DEVICE default
- `README.md` — update text + table (lines 36, 61, 78)
- `.planning/codebase/STACK.md`, `STRUCTURE.md`, `INTEGRATIONS.md` — update snapshot

## Not touched

- `specifications.md` — frozen historical HAT migration spec
- `.planning/research/*` — pre-migration research context, preserved as record

## Acceptance

- `grep -r "ttyESP32"` (excluding `specifications.md` + `.planning/research/`) returns no matches
- `docker compose config` resolves micro-ros-agent device to `/dev/ttyAMA0` with no `.env` present
