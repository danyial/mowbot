/**
 * Format a number with fixed decimal places
 */
export function formatNumber(value: number, decimals: number = 2): string {
  return value.toFixed(decimals);
}

/**
 * Format GPS coordinates (7 decimal places)
 */
export function formatCoordinate(value: number): string {
  return value.toFixed(7);
}

/**
 * Format speed in m/s
 */
export function formatSpeed(mps: number): string {
  return `${mps.toFixed(2)} m/s`;
}

/**
 * Format distance in meters or km
 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${meters.toFixed(1)} m`;
}

/**
 * Format duration in seconds to human-readable
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const min = Math.floor(seconds / 60);
    const sec = Math.round(seconds % 60);
    return `${min}m ${sec}s`;
  }
  const hrs = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return `${hrs}h ${min}m`;
}

/**
 * Format voltage with unit
 */
export function formatVoltage(voltage: number): string {
  return `${voltage.toFixed(1)}V`;
}

/**
 * Convert 3S LiPo voltage to percentage
 * 3S: 9.0V (empty) to 12.6V (full)
 */
export function voltageToPercent(voltage: number): number {
  const min = 9.0;
  const max = 12.6;
  return Math.max(0, Math.min(100, ((voltage - min) / (max - min)) * 100));
}

/**
 * Get battery color based on voltage
 */
export function getBatteryColor(voltage: number): string {
  if (voltage > 11.4) return "text-green-500";
  if (voltage > 10.8) return "text-yellow-500";
  return "text-red-500";
}

/**
 * Format degrees with unit
 */
export function formatDegrees(degrees: number): string {
  return `${degrees.toFixed(1)}°`;
}

/**
 * Format area in square meters
 */
export function formatArea(sqMeters: number): string {
  return `${sqMeters.toFixed(1)} m²`;
}

/**
 * Calculate polygon area using Shoelace formula
 * Points are [lat, lon] pairs
 */
export function calculatePolygonArea(
  points: [number, number][]
): number {
  if (points.length < 3) return 0;

  // Convert to approximate meters using equirectangular projection
  const refLat = points[0][0];
  const latToMeters = 111320;
  const lonToMeters = 111320 * Math.cos((refLat * Math.PI) / 180);

  const meterPoints = points.map((p) => [
    (p[0] - refLat) * latToMeters,
    (p[1] - points[0][1]) * lonToMeters,
  ]);

  let area = 0;
  for (let i = 0; i < meterPoints.length; i++) {
    const j = (i + 1) % meterPoints.length;
    area += meterPoints[i][0] * meterPoints[j][1];
    area -= meterPoints[j][0] * meterPoints[i][1];
  }

  return Math.abs(area / 2);
}
