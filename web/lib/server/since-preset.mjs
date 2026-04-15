/**
 * parseSincePreset — translate a preset chip label to an epoch-second
 * "since" argument for `container.logs({ since })`.
 *
 * Graceful-unknown contract: null / unknown preset → null (no filter).
 * Plan 02 Task 1 — Phase 6 WebUI Container-Logs View.
 *
 * @param {string | null | undefined} preset
 * @returns {number | null}
 */
const TABLE = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
};

export function parseSincePreset(preset) {
  if (preset == null) return null;
  const secs = TABLE[preset];
  if (secs == null) return null;
  return Math.floor(Date.now() / 1000) - secs;
}
