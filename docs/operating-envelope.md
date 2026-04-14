# Operating Envelope

The LD19 / STL-19P LiDAR is rated IP5X (dust-protected) and is NOT
rain-resistant. Operating temperature: −10 °C to +45 °C. The mower must not
be operated outside these limits.

## Operator Rules

1. Do not operate the mower in rain, snow, or on wet/dewy grass. Dry-grass
   operation only.
2. Do not operate when the ambient temperature is below −10 °C or above +45 °C.
3. If the mower is caught in rain mid-mission, stop immediately, power down,
   and let the LiDAR dry for at least 2 hours before next run.

These are physical sensor limits, not software-enforceable. A weather shroud
/ IP-rated enclosure is tracked as a v2 hardware deliverable.

## Source

- `docs/datasheets/lidar/D500-STL-19P-Datasheet.pdf` §4 (IP5X, temperature)
- `docs/datasheets/lidar/README.md` §"Mechanical / environmental"
