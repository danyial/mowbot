---
quick_id: 260415-ux6
slug: gps-detail-card
date: 2026-04-15
status: complete
---
# Quick Task: GPS-Detail-Anzeige im Dashboard

Erweitere die bestehende `<GpsStatus>` Card um einen aufklappbaren "Details"-Bereich mit:
- Fix-Typ numerisch (status=N + REP-145 Label)
- Horizontal 2σ (95%) + Vertikal 1σ/2σ separat
- MSL-Höhe
- Covariance-Typ (approximiert/diag/voll)
- Alter des letzten Fix in ms/s/min (500ms setInterval-Tick)

Speichererweiterung im `gps-store`: `fixStatusCode`, `verticalAccuracy`, `covarianceType`.
Keine ROS-Änderungen — alle Felder aus `/fix` bereits verfügbar.
