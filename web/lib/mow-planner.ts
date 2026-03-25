/**
 * Mow path planner — generates waypoints for parallel stripe mowing.
 *
 * Algorithm:
 * 1. Merge all target zone polygons into one
 * 2. Apply safety margin (spacing/2 inward buffer) so the robot center
 *    always stays at least half a mow-width away from boundaries
 * 3. Expand exclusion zones by spacing/2, then subtract from mow area
 * 4. Generate perimeter passes (inward polygon offsets)
 * 5. Generate parallel stripes at the given angle over the remaining inner area
 * 6. Sort stripes by nearest-neighbor for shortest travel between stripes
 * 7. Connect stripes via polygon perimeter when direct path crosses boundary
 * 8. Return waypoints + distance estimate + area stats
 */

import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon, Position } from "geojson";
import type { PlanResult } from "./types/mission";

/** Squared distance between two [lat, lon] points — for comparison only */
function distSq(a: [number, number], b: [number, number]): number {
  const dLat = a[0] - b[0];
  const dLon = a[1] - b[1];
  return dLat * dLat + dLon * dLon;
}

/** Euclidean distance between two [lon, lat] GeoJSON coords */
function geoDistSq(a: number[], b: number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/**
 * Get the outer ring of a (Multi)Polygon as [[lon, lat], ...].
 * For MultiPolygon, returns the ring of the largest sub-polygon.
 */
function getOuterRing(
  feature: Feature<Polygon | MultiPolygon>
): number[][] {
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates[0];
  }
  // MultiPolygon — pick the largest
  let bestRing = feature.geometry.coordinates[0][0];
  let bestArea = 0;
  for (const polyCoords of feature.geometry.coordinates) {
    try {
      const a = turf.area(turf.polygon(polyCoords));
      if (a > bestArea) {
        bestArea = a;
        bestRing = polyCoords[0];
      }
    } catch {
      // skip
    }
  }
  return bestRing;
}

/**
 * Find the index of the nearest point on a ring to the given [lat, lon] point.
 */
function findNearestRingIndex(
  point: [number, number], // [lat, lon]
  ring: number[][] // [[lon, lat], ...]
): number {
  const [lat, lon] = point;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = geoDistSq([lon, lat], ring[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Extract a slice of ring points from index `from` to index `to`,
 * walking forward (wrapping around). Excludes closing point.
 */
function ringSliceForward(
  ring: number[][],
  from: number,
  to: number
): number[][] {
  const n = ring.length - 1; // exclude closing point (same as first)
  const result: number[][] = [];
  let i = from;
  while (i !== to) {
    result.push(ring[i]);
    i = (i + 1) % n;
  }
  result.push(ring[to]);
  return result;
}

/**
 * Calculate the total distance of a path of [lon, lat] coords.
 */
function pathLengthGeo(coords: number[][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += Math.sqrt(geoDistSq(coords[i - 1], coords[i]));
  }
  return len;
}

/**
 * Find the shortest path along the polygon perimeter from point A to point B.
 * Returns intermediate [lat, lon] waypoints (excluding A and B themselves).
 * All points lie on the safe-area boundary, maintaining the safety margin.
 */
function findPerimeterPath(
  from: [number, number], // [lat, lon]
  to: [number, number], // [lat, lon]
  ring: number[][] // outer ring [[lon, lat], ...]
): [number, number][] {
  const fromIdx = findNearestRingIndex(from, ring);
  const toIdx = findNearestRingIndex(to, ring);

  if (fromIdx === toIdx) return [];

  // Two possible paths around the ring
  const pathForward = ringSliceForward(ring, fromIdx, toIdx);
  const pathBackward = ringSliceForward(ring, toIdx, fromIdx).reverse();

  // Pick shorter
  const shorter =
    pathLengthGeo(pathForward) <= pathLengthGeo(pathBackward)
      ? pathForward
      : pathBackward;

  // Convert [lon, lat] → [lat, lon], skip first and last (they are from/to)
  return shorter
    .slice(1, -1)
    .map(([lon, lat]) => [lat, lon] as [number, number]);
}

/**
 * Check if a direct line between two [lat, lon] points stays within the polygon.
 */
function isDirectPathInside(
  from: [number, number],
  to: [number, number],
  area: Feature<Polygon | MultiPolygon>
): boolean {
  try {
    const line = turf.lineString([
      [from[1], from[0]], // [lon, lat]
      [to[1], to[0]],
    ]);
    return turf.booleanWithin(line, area);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a complete mow path for the given parameters.
 */
export function generateMowPath(params: {
  zonePolygons: number[][][][];
  exclusionPolygons: number[][][][];
  spacing: number;
  overlap: number;
  perimeterPasses: number;
  angle: number;
  speed: number;
  /** Start/end point [lat, lon] — dock centroid or GPS position */
  startPoint?: [number, number];
}): PlanResult {
  const {
    zonePolygons,
    exclusionPolygons,
    spacing,
    overlap,
    perimeterPasses,
    angle,
    speed,
    startPoint,
  } = params;

  const emptyResult: PlanResult = {
    pathPoints: [],
    estimatedDistance: 0,
    estimatedDuration: 0,
    turns: 0,
    perimeterArea: 0,
    innerArea: 0,
  };

  if (zonePolygons.length === 0) return emptyResult;

  const effectiveSpacing = spacing * (1 - overlap);
  if (effectiveSpacing <= 0) return emptyResult;

  const safetyMargin = spacing / 2;

  // 1. Build the mow area: union all zone polygons
  let mowArea: Feature<Polygon | MultiPolygon> = turf.polygon(zonePolygons[0]);
  for (let i = 1; i < zonePolygons.length; i++) {
    try {
      const next = turf.polygon(zonePolygons[i]);
      const merged = turf.union(turf.featureCollection([mowArea, next]));
      if (merged) mowArea = merged as Feature<Polygon | MultiPolygon>;
    } catch {
      // Skip invalid polygons
    }
  }

  // 2. Apply safety margin: shrink mow area by half the mow width
  const safeArea = turf.buffer(mowArea, -safetyMargin / 1000, {
    units: "kilometers",
  });
  if (!safeArea || turf.area(safeArea) < 0.01) return emptyResult;
  mowArea = safeArea as Feature<Polygon | MultiPolygon>;

  // 3. Expand exclusion zones by safety margin, then subtract
  for (const exCoords of exclusionPolygons) {
    try {
      const exclusion = turf.polygon(exCoords);
      const expanded = turf.buffer(exclusion, safetyMargin / 1000, {
        units: "kilometers",
      });
      const exFeature = (expanded || exclusion) as Feature<
        Polygon | MultiPolygon
      >;
      const diff = turf.difference(
        turf.featureCollection([mowArea, exFeature])
      );
      if (diff) mowArea = diff as Feature<Polygon | MultiPolygon>;
    } catch {
      // Skip invalid exclusions
    }
  }

  if (turf.area(mowArea) < 0.01) return emptyResult;

  const mowPoints: [number, number][] = [];
  const totalArea = turf.area(mowArea);
  const outerRing = getOuterRing(mowArea);

  // 4. Generate perimeter passes
  let innerAreaFeature = mowArea;
  for (let p = 0; p < perimeterPasses; p++) {
    const offsetMeters = effectiveSpacing * (p + 0.5);
    const buffered = turf.buffer(mowArea, -offsetMeters / 1000, {
      units: "kilometers",
    });
    if (!buffered || turf.area(buffered) < 0.01) break;

    const perimeterPoints = extractPerimeterPoints(buffered);
    mowPoints.push(...perimeterPoints);

    innerAreaFeature = buffered as Feature<Polygon | MultiPolygon>;
  }

  // Shrink inner area to where stripes begin
  if (perimeterPasses > 0) {
    const innerOffset = effectiveSpacing * perimeterPasses;
    const shrunk = turf.buffer(mowArea, -innerOffset / 1000, {
      units: "kilometers",
    });
    if (shrunk && turf.area(shrunk) > 0.01) {
      innerAreaFeature = shrunk as Feature<Polygon | MultiPolygon>;
    } else {
      // Entire area covered by perimeter passes — add start/return paths
      const allPoints = addStartReturnPaths(startPoint, mowPoints, mowArea, outerRing);
      return buildResult(allPoints, speed, 0, totalArea, 0);
    }
  }

  const innerAreaSqm = turf.area(innerAreaFeature);
  const perimeterAreaSqm = Math.max(0, totalArea - innerAreaSqm);

  // 5. Generate parallel stripes with safe connections between them
  const lastPoint =
    mowPoints.length > 0 ? mowPoints[mowPoints.length - 1] : undefined;

  const { points: stripePoints, stripeCount } = generateParallelStripes(
    innerAreaFeature,
    effectiveSpacing,
    angle,
    mowArea, // pass the safe mow area for connection checks
    lastPoint
  );
  mowPoints.push(...stripePoints);

  const turns = Math.max(0, stripeCount - 1);

  // 6. Add start path (dock/GPS → first mow point) and return path (last mow point → dock/GPS)
  const allPoints = addStartReturnPaths(startPoint, mowPoints, mowArea, outerRing);

  return buildResult(allPoints, speed, turns, perimeterAreaSqm, innerAreaSqm);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prepend a path from startPoint to the first mow point, and append
 * a return path from the last mow point back to startPoint.
 * Connections route along the polygon perimeter when direct path is outside.
 */
function addStartReturnPaths(
  startPoint: [number, number] | undefined,
  mowPoints: [number, number][],
  safeArea: Feature<Polygon | MultiPolygon>,
  outerRing: number[][]
): [number, number][] {
  if (!startPoint || mowPoints.length === 0) return mowPoints;

  const result: [number, number][] = [];

  // Start: startPoint → first mow point
  result.push(startPoint);
  const firstMow = mowPoints[0];
  if (!isDirectPathInside(startPoint, firstMow, safeArea)) {
    const waypoints = findPerimeterPath(startPoint, firstMow, outerRing);
    result.push(...waypoints);
  }

  // All mow points
  result.push(...mowPoints);

  // Return: last mow point → startPoint
  const lastMow = mowPoints[mowPoints.length - 1];
  if (!isDirectPathInside(lastMow, startPoint, safeArea)) {
    const waypoints = findPerimeterPath(lastMow, startPoint, outerRing);
    result.push(...waypoints);
  }
  result.push(startPoint);

  return result;
}

function extractPerimeterPoints(
  feature: Feature<Polygon | MultiPolygon>
): [number, number][] {
  const points: [number, number][] = [];
  const polygons =
    feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];

  for (const coords of polygons) {
    const ring = coords[0];
    for (const [lon, lat] of ring) {
      points.push([lat, lon]);
    }
  }
  return points;
}

/**
 * Generate parallel mowing stripes across a polygon at a given angle.
 * Stripes are sorted using nearest-neighbor, and connections between
 * stripes that would cross outside the polygon are routed along the
 * polygon perimeter instead.
 */
function generateParallelStripes(
  area: Feature<Polygon | MultiPolygon>,
  spacing: number,
  angleDeg: number,
  safeArea: Feature<Polygon | MultiPolygon>,
  startFrom?: [number, number]
): { points: [number, number][]; stripeCount: number } {
  const centroid = turf.centroid(area);

  const spacingDeg = spacing / 111320;

  const useRotation = Math.abs(angleDeg % 360) > 0.1;

  let workArea = area;
  if (useRotation) {
    workArea = turf.transformRotate(area, -angleDeg, {
      pivot: centroid.geometry.coordinates as [number, number],
    }) as Feature<Polygon | MultiPolygon>;
  }

  const [wMinLon, wMinLat, wMaxLon, wMaxLat] = turf.bbox(workArea);

  // Generate horizontal scan lines — each stripe is a separate segment
  const stripes: [number, number][][] = [];

  let y = wMinLat + spacingDeg / 2;
  while (y < wMaxLat) {
    const lineCoords: Position[] = [
      [wMinLon - 0.001, y],
      [wMaxLon + 0.001, y],
    ];
    const scanLine = turf.lineString(lineCoords);
    const intersections = findLinePolygonIntersections(scanLine, workArea);

    if (intersections.length >= 2) {
      intersections.sort((a, b) => a[0] - b[0]);

      // Each pair of intersections is one stripe segment
      // For concave polygons, there can be multiple segments per scan line
      for (let i = 0; i < intersections.length - 1; i += 2) {
        const entry = intersections[i];
        const exit = intersections[i + 1];
        if (!exit) continue;

        let startPt: [number, number];
        let endPt: [number, number];

        if (useRotation) {
          const entryPt = turf.transformRotate(
            turf.point(entry),
            angleDeg,
            { pivot: centroid.geometry.coordinates as [number, number] }
          );
          const exitPt = turf.transformRotate(turf.point(exit), angleDeg, {
            pivot: centroid.geometry.coordinates as [number, number],
          });
          startPt = [
            entryPt.geometry.coordinates[1],
            entryPt.geometry.coordinates[0],
          ];
          endPt = [
            exitPt.geometry.coordinates[1],
            exitPt.geometry.coordinates[0],
          ];
        } else {
          startPt = [entry[1], entry[0]];
          endPt = [exit[1], exit[0]];
        }

        stripes.push([startPt, endPt]);
      }
    }

    y += spacingDeg;
  }

  if (stripes.length === 0) {
    return { points: [], stripeCount: 0 };
  }

  // --- Nearest-neighbor sorting with safe connections ---
  const outerRing = getOuterRing(safeArea);
  const result: [number, number][] = [];
  const visited = new Array(stripes.length).fill(false);
  let currentPos: [number, number] | null = startFrom ?? null;

  for (let step = 0; step < stripes.length; step++) {
    let bestIdx = -1;
    let bestDist = Infinity;
    let bestReverse = false;

    for (let i = 0; i < stripes.length; i++) {
      if (visited[i]) continue;

      const stripe = stripes[i];
      const stripeStart = stripe[0];
      const stripeEnd = stripe[stripe.length - 1];

      if (currentPos === null) {
        bestIdx = i;
        break;
      }

      const dStart = distSq(currentPos, stripeStart);
      const dEnd = distSq(currentPos, stripeEnd);

      if (dStart < bestDist) {
        bestDist = dStart;
        bestIdx = i;
        bestReverse = false;
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        bestIdx = i;
        bestReverse = true;
      }
    }

    if (bestIdx === -1) break;
    visited[bestIdx] = true;

    const stripe = bestReverse
      ? [...stripes[bestIdx]].reverse()
      : stripes[bestIdx];

    // Check if direct connection from currentPos to stripe start is inside
    if (currentPos !== null) {
      const target = stripe[0];
      if (!isDirectPathInside(currentPos, target, safeArea)) {
        // Route via polygon perimeter
        const perimeterWaypoints = findPerimeterPath(
          currentPos,
          target,
          outerRing
        );
        result.push(...perimeterWaypoints);
      }
    }

    result.push(...stripe);
    currentPos = stripe[stripe.length - 1];
  }

  return { points: result, stripeCount: stripes.length };
}

function findLinePolygonIntersections(
  line: Feature<import("geojson").LineString>,
  polygon: Feature<Polygon | MultiPolygon>
): [number, number][] {
  try {
    const intersections = turf.lineIntersect(line, polygon);
    return intersections.features.map(
      (f) => f.geometry.coordinates as [number, number]
    );
  } catch {
    return [];
  }
}

function buildResult(
  points: [number, number][],
  speed: number,
  turns: number = 0,
  perimeterArea: number = 0,
  innerArea: number = 0
): PlanResult {
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const [lat1, lon1] = points[i - 1];
    const [lat2, lon2] = points[i];
    const from = turf.point([lon1, lat1]);
    const to = turf.point([lon2, lat2]);
    distance += turf.distance(from, to, { units: "meters" });
  }

  const duration = speed > 0 ? distance / speed : 0;

  return {
    pathPoints: points,
    estimatedDistance: Math.round(distance),
    estimatedDuration: Math.round(duration),
    turns,
    perimeterArea: Math.round(perimeterArea),
    innerArea: Math.round(innerArea),
  };
}
