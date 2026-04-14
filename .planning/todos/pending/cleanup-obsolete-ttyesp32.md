---
title: Clean up obsolete /dev/ttyESP32 references
area: docs
created: 2026-04-14
source: phase-1-discuss
priority: low
---

# Clean up obsolete `/dev/ttyESP32` references

The ESP32 motor controller runs on UART `/dev/ttyAMA0` (see `docker-compose.yml:23`), not USB. The `/dev/ttyESP32` symlink is a leftover from a pre-HAT topology when the ESP32 was flashed/connected via CP2102 USB adapter.

Stale references to fix:

- **`.env.example:8`** — `ESP32_DEVICE=/dev/ttyESP32` currently **overrides** the correct docker-compose default `${ESP32_DEVICE:-/dev/ttyAMA0}`. This is a real bug — anyone copying `.env.example` to `.env` unchanged will point micro-ros-agent at a non-existent device. Fix: remove the line, or change to `ESP32_DEVICE=/dev/ttyAMA0`.
- **`udev/99-mower.rules:2`** — the CP2102 → `ttyESP32` rule is dead hardware. Decision: delete, or comment out with a "dev-kit flashing only" note.
- **`CLAUDE.md:75`** — lists `/dev/ttyESP32` as the ESP32 symlink. Update to `/dev/ttyAMA0`.
- **`README.md:36,61,78`** — multiple mentions of `/dev/ttyESP32`. Update or remove.
- **`setup.sh:43`** — log message claims `/dev/ttyESP32` gets installed. Update to match the live rule (`/dev/ttyGNSS` is still valid).

## Why deferred

Flagged by user during `/gsd-discuss-phase 1` on 2026-04-14. Kept out of Phase 1 scope to keep that phase focused on LD19 wiring. This cleanup has no dependency on LiDAR work and can run independently any time after Phase 1.

## How to tackle

Single `/gsd-quick` pass — pure documentation + one small config fix. Pure text edits across 5 files. No runtime impact (the existing `.env.example` bug only bites someone who copies it verbatim; real deployments on the actual Pi have `.env` pointing at the correct UART).

## Acceptance

- `grep -r "ttyESP32" .` returns zero matches (or only matches inside a deliberate "historical note" section).
- `docker compose config` resolves the micro-ros-agent device mount to `/dev/ttyAMA0` when `.env` is absent or unchanged from `.env.example`.
