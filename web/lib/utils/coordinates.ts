import type { LatLngExpression } from "leaflet";

/**
 * Convert GPS [lat, lon] to Leaflet LatLng
 */
export function gpsToLatLng(
  lat: number,
  lon: number
): LatLngExpression {
  return [lat, lon];
}

/**
 * Convert array of [lat, lon] pairs to Leaflet LatLng array
 */
export function pointsToLatLngs(
  points: [number, number][]
): LatLngExpression[] {
  return points.map(([lat, lon]) => [lat, lon] as LatLngExpression);
}

/**
 * Calculate distance between two GPS points in meters (Haversine)
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate total path length from array of [lat, lon] points
 */
export function pathLength(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(
      points[i - 1][0],
      points[i - 1][1],
      points[i][0],
      points[i][1]
    );
  }
  return total;
}

/**
 * Default map center (Eichenau, Bayern)
 */
export const DEFAULT_CENTER: [number, number] = [
  parseFloat(process.env.NEXT_PUBLIC_DEFAULT_LAT || "48.1634"),
  parseFloat(process.env.NEXT_PUBLIC_DEFAULT_LON || "11.3019"),
];

export const DEFAULT_ZOOM = parseInt(
  process.env.NEXT_PUBLIC_DEFAULT_ZOOM || "18",
  10
);

export const MAP_TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ||
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
