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
 * 7. Return waypoints + distance estimate + area stats
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

/**
 * Generate a complete mow path for the given parameters.
 */
export function generateMowPath(params: {
  /** Polygons of zones to mow (GeoJSON coordinates) */
  zonePolygons: number[][][][];
  /** Polygons of exclusion zones */
  exclusionPolygons: number[][][][];
  /** Mow width in meters */
  spacing: number;
  /** Overlap fraction 0-1 */
  overlap: number;
  /** Number of perimeter passes */
  perimeterPasses: number;
  /** Stripe angle in degrees (0 = East-West) */
  angle: number;
  /** Speed in m/s (for duration estimate) */
  speed: number;
}): PlanResult {
  const {
    zonePolygons,
    exclusionPolygons,
    spacing,
    overlap,
    perimeterPasses,
    angle,
    speed,
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

  const safetyMargin = spacing / 2; // half mow-width as clearance

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
  //    so the robot center never crosses the boundary
  const safeArea = turf.buffer(mowArea, -safetyMargin / 1000, {
    units: "kilometers",
  });
  if (!safeArea || turf.area(safeArea) < 0.01) return emptyResult;
  mowArea = safeArea as Feature<Polygon | MultiPolygon>;

  // 3. Expand exclusion zones by safety margin, then subtract
  for (const exCoords of exclusionPolygons) {
    try {
      const exclusion = turf.polygon(exCoords);
      // Expand exclusion by half mow-width for safe clearance
      const expanded = turf.buffer(exclusion, safetyMargin / 1000, {
        units: "kilometers",
      });
      const exFeature = (expanded || exclusion) as Feature<Polygon | MultiPolygon>;
      const diff = turf.difference(turf.featureCollection([mowArea, exFeature]));
      if (diff) mowArea = diff as Feature<Polygon | MultiPolygon>;
    } catch {
      // Skip invalid exclusions
    }
  }

  // Check if anything remains after safety margin + exclusions
  if (turf.area(mowArea) < 0.01) return emptyResult;

  const allPoints: [number, number][] = [];
  const totalArea = turf.area(mowArea); // m² of safe mow area

  // 4. Generate perimeter passes
  let innerAreaFeature = mowArea;
  for (let p = 0; p < perimeterPasses; p++) {
    const offsetMeters = effectiveSpacing * (p + 0.5);
    const buffered = turf.buffer(mowArea, -offsetMeters / 1000, {
      units: "kilometers",
    });
    if (!buffered || turf.area(buffered) < 0.01) break;

    const perimeterPoints = extractPerimeterPoints(buffered);
    allPoints.push(...perimeterPoints);

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
      // Entire area covered by perimeter passes
      return buildResult(allPoints, speed, 0, totalArea, 0);
    }
  }

  // Calculate areas
  const innerAreaSqm = turf.area(innerAreaFeature);
  const perimeterAreaSqm = Math.max(0, totalArea - innerAreaSqm);

  // 5. Generate parallel stripes over the inner area
  //    Pass last perimeter point so nearest-neighbor starts from there
  const lastPoint =
    allPoints.length > 0 ? allPoints[allPoints.length - 1] : undefined;

  const { points: stripePoints, stripeCount } = generateParallelStripes(
    innerAreaFeature,
    effectiveSpacing,
    angle,
    lastPoint
  );
  allPoints.push(...stripePoints);

  const turns = Math.max(0, stripeCount - 1);

  return buildResult(allPoints, speed, turns, perimeterAreaSqm, innerAreaSqm);
}

/**
 * Extract perimeter ring points from a (Multi)Polygon as [lat, lon] waypoints.
 */
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
 * Stripes are sorted using nearest-neighbor for shortest travel distance.
 *
 * @param startFrom Optional [lat, lon] of the last perimeter point to
 *                  start nearest-neighbor sorting from.
 */
function generateParallelStripes(
  area: Feature<Polygon | MultiPolygon>,
  spacing: number,
  angleDeg: number,
  startFrom?: [number, number]
): { points: [number, number][]; stripeCount: number } {
  const centroid = turf.centroid(area);
  const centerLat = centroid.geometry.coordinates[1];

  // Convert spacing from meters to approximate degrees latitude
  const spacingDeg = spacing / 111320;

  // If angle is non-zero, rotate the polygon so stripes become horizontal (0°),
  // generate stripes, then rotate points back.
  const useRotation = Math.abs(angleDeg % 360) > 0.1;

  let workArea = area;
  if (useRotation) {
    workArea = turf.transformRotate(area, -angleDeg, {
      pivot: centroid.geometry.coordinates as [number, number],
    }) as Feature<Polygon | MultiPolygon>;
  }

  // Get bbox of the (possibly rotated) work area
  const [wMinLon, wMinLat, wMaxLon, wMaxLat] = turf.bbox(workArea);

  // Generate horizontal scan lines across the work area
  // Each stripe is a list of [lat, lon] waypoint pairs (entry, exit)
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
      // Sort intersections by longitude
      intersections.sort((a, b) => a[0] - b[0]);

      // Create segments (pairs of entry/exit points)
      const stripePoints: [number, number][] = [];
      for (let i = 0; i < intersections.length - 1; i += 2) {
        const entry = intersections[i];
        const exit = intersections[i + 1];
        if (!exit) continue;

        if (useRotation) {
          const entryPt = turf.transformRotate(turf.point(entry), angleDeg, {
            pivot: centroid.geometry.coordinates as [number, number],
          });
          const exitPt = turf.transformRotate(turf.point(exit), angleDeg, {
            pivot: centroid.geometry.coordinates as [number, number],
          });
          stripePoints.push(
            [entryPt.geometry.coordinates[1], entryPt.geometry.coordinates[0]],
            [exitPt.geometry.coordinates[1], exitPt.geometry.coordinates[0]]
          );
        } else {
          stripePoints.push(
            [entry[1], entry[0]], // [lat, lon]
            [exit[1], exit[0]]
          );
        }
      }

      if (stripePoints.length > 0) {
        stripes.push(stripePoints);
      }
    }

    y += spacingDeg;
  }

  if (stripes.length === 0) {
    return { points: [], stripeCount: 0 };
  }

  // --- Nearest-neighbor sorting ---
  // Instead of fixed boustrophedon order, pick the closest unvisited stripe
  // from the current position. This minimizes travel between stripes,
  // especially for complex polygon shapes.

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
        // First stripe — just pick the first one
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

    result.push(...stripe);
    currentPos = stripe[stripe.length - 1];
  }

  return { points: result, stripeCount: stripes.length };
}

/**
 * Find intersection points of a line with a (Multi)Polygon boundary.
 * Returns [lon, lat] coordinate pairs.
 */
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

/**
 * Build the final PlanResult from waypoints + speed + area stats.
 */
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
