---
quick_id: 260415-ux6
slug: gps-detail-card
date: 2026-04-15
status: complete
---

# Quick Task: GPS-Detail-Anzeige im Dashboard — Summary

## What was built

Extended the existing `<GpsStatus>` dashboard card with a collapsible "Details" section exposing every useful field already present in the `/fix` `NavSatFix` message.

### Store changes (`web/lib/store/gps-store.ts`)
Added three derived fields:
- `fixStatusCode: number` — raw `NavSatStatus.status` (-2 sentinel, -1 NO_FIX, 0 FIX, 1 SBAS, 2 GBAS per REP-145)
- `verticalAccuracy: number` — 1σ vertical from `position_covariance[8]` (was previously unused)
- `covarianceType: number` — `position_covariance_type` (0=unknown, 1=approximated, 2=diag, 3=known)

### UI changes (`web/components/dashboard/gps-status.tsx`)
- Inline `status=N (LABEL)` next to the existing RTK badge
- Collapsible Details section (`ChevronDown/Up` toggle) showing:
  - Horizontal 2σ (95% CEP) alongside the existing 1σ
  - Vertical 1σ + 2σ (altitude variance was wired up but never rendered before)
  - MSL altitude in meters
  - Covariance type label (approximiert/diag/voll)
  - Fix age in ms/s/min with a **500 ms `setInterval` tick** so the age re-renders even when no new `/fix` message arrives

## Verification (live on mower via Playwright)

On `http://10.10.40.23:3000/` with the mower on the terrace at RTK Float:

```
GPS
RTK Float   status=2 (GBAS)
Lat: 48.1590698   Lon: 11.3154259
Genauigkeit (1σ): 3.4 cm   Letzter Fix: 0 ms
[Details ▼]
  Horizontal 2σ (95%): 6.7 cm   Vertikal 1σ: 10.4 cm
  Höhe (MSL): 622.92 m          Vertikal 2σ (95%): 20.8 cm
  Cov-Typ: approximiert         Alter: 0 ms
```

All fields render cleanly; setInterval tick proven (age refreshes at 500 ms cadence without new messages).

## Files changed

- `web/lib/store/gps-store.ts` — +5 store fields
- `web/components/dashboard/gps-status.tsx` — expanded card + Details section
- `.planning/quick/20260415-gps-detail-card/PLAN.md` + SUMMARY.md (this file)

## Commits

- `c3c1984` — `feat(gps): expand GPS dashboard card with detail popover`

## Deploy

Built and pushed on mower via `docker compose build web && docker compose up -d --force-recreate web`. Live and verified.

## Future extensions (not in scope here)

- **Stufe 2:** extend `nmea_navsat_driver` config to parse `GSA`/`GSV`/`RMC` so satellite count, HDOP/VDOP/PDOP, and correction age become available as separate topics. Would replace the current HDOP approximation (which is `sqrt(covariance[0])`) with the true reported value.
- **Stufe 3:** UM980 dual-antenna heading on `/heading` — independent second yaw source for Phase 7 cross-check.
