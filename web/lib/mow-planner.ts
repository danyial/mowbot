/**
 * Mow path planner — generates waypoints for parallel stripe mowing.
 *
 * Algorithm:
 * 1. Merge all target zone polygons into one
 * 2. Apply safety margin (spacing/2 inward buffer)
 * 3. Expand exclusion zones by spacing/2, then subtract from mow area
 * 4. Generate perimeter passes — outer ring passes first (all passes),
 *    then hole ring passes (all passes per hole) separately
 * 5. Generate parallel stripes at the given angle over the remaining inner area
 * 6. Sort stripes by nearest-neighbor for shortest travel between stripes
 * 7. Connect stripes via best polygon ring when direct path crosses boundary
 * 8. Add start/return path from dock or GPS position
 * 9. Return waypoints + distance estimate + area stats
 */

import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon, Position } from "geojson";
import type { PlanResult } from "./types/mission";

// ─────────────────────────────────────────────────────────────────────────────
// Geometry utilities
// ─────────────────────────────────────────────────────────────────────────────

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
 * Get ALL rings from a (Multi)Polygon as [[lon, lat], ...] arrays.
 * Includes outer ring and all hole rings.
 */
function getAllRings(feature: Feature<Polygon | MultiPolygon>): number[][][] {
  const rings: number[][][] = [];
  const polygons =
    feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];

  for (const coords of polygons) {
    for (const ring of coords) {
      rings.push(ring);
    }
  }
  return rings;
}

/**
 * Extract rings from a (Multi)Polygon, separated into outer rings and hole rings.
 */
function extractRingsSeparately(
  feature: Feature<Polygon | MultiPolygon>
): { outerRings: number[][][]; holeRings: number[][][] } {
  const outerRings: number[][][] = [];
  const holeRings: number[][][] = [];
  const polygons =
    feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];

  for (const coords of polygons) {
    outerRings.push(coords[0]); // First ring is outer
    for (let i = 1; i < coords.length; i++) {
      holeRings.push(coords[i]); // Remaining rings are holes
    }
  }
  return { outerRings, holeRings };
}

/**
 * Convert a GeoJSON ring [[lon, lat], ...] to [lat, lon] waypoints.
 */
function ringToWaypoints(ring: number[][]): [number, number][] {
  return ring.map(([lon, lat]) => [lat, lon] as [number, number]);
}

/**
 * Find the index of the nearest point on a ring to the given [lat, lon] point.
 */
function findNearestRingIndex(
  point: [number, number],
  ring: number[][]
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
  if (n <= 0) return [];
  const result: number[][] = [];
  let i = from % n;
  const target = to % n;
  while (i !== target) {
    result.push(ring[i]);
    i = (i + 1) % n;
  }
  result.push(ring[target]);
  return result;
}

/** Total distance of a path of [lon, lat] coords */
function pathLengthGeo(coords: number[][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += Math.sqrt(geoDistSq(coords[i - 1], coords[i]));
  }
  return len;
}

/**
 * Find the shortest path along a single ring from point A to point B.
 * Returns intermediate [lat, lon] waypoints (excluding A and B themselves).
 */
function findPerimeterPathOnRing(
  from: [number, number],
  to: [number, number],
  ring: number[][]
): [number, number][] {
  const fromIdx = findNearestRingIndex(from, ring);
  const toIdx = findNearestRingIndex(to, ring);

  if (fromIdx === toIdx) return [];

  const pathForward = ringSliceForward(ring, fromIdx, toIdx);
  const pathBackward = ringSliceForward(ring, toIdx, fromIdx).reverse();

  const shorter =
    pathLengthGeo(pathForward) <= pathLengthGeo(pathBackward)
      ? pathForward
      : pathBackward;

  return shorter
    .slice(1, -1)
    .map(([lon, lat]) => [lat, lon] as [number, number]);
}

/**
 * Find the best (shortest) perimeter path from A to B, trying all rings
 * of the polygon (outer + holes). This ensures the path routes around
 * exclusion zones when needed, instead of always using the outer ring.
 */
function findBestPerimeterPath(
  from: [number, number],
  to: [number, number],
  safeArea: Feature<Polygon | MultiPolygon>
): [number, number][] {
  const allRings = getAllRings(safeArea);

  let bestPath: [number, number][] = [];
  let bestLength = Infinity;

  for (const ring of allRings) {
    if (ring.length < 3) continue;
    const path = findPerimeterPathOnRing(from, to, ring);
    // Calculate total length including start→first and last→end
    const fullPath: [number, number][] = [from, ...path, to];
    let len = 0;
    for (let i = 1; i < fullPath.length; i++) {
      const dLat = fullPath[i][0] - fullPath[i - 1][0];
      const dLon = fullPath[i][1] - fullPath[i - 1][1];
      len += Math.sqrt(dLat * dLat + dLon * dLon);
    }
    if (len < bestLength) {
      bestLength = len;
      bestPath = path;
    }
  }

  return bestPath;
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
      [from[1], from[0]],
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

export function generateMowPath(params: {
  zonePolygons: number[][][][];
  exclusionPolygons: number[][][][];
  spacing: number;
  overlap: number;
  perimeterPasses: number;
  angle: number;
  speed: number;
  startPoint?: [number, number];
  /** Minimum clearance of robot EDGE from boundaries in meters. */
  edgeClearance?: number;
  /** Robot width in meters — used to calculate center-to-edge offset. */
  robotWidth?: number;
  /** Dock exit/entry path [[lat, lon], ...] — from dock exit to garden entry */
  dockPath?: [number, number][];
  /** Distance in meters the robot drives blind (backward) to exit dock */
  dockExitDistance?: number;
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

  // safetyMargin = distance from boundary to robot CENTER
  // = edgeClearance (edge-to-boundary) + robotWidth/2 (center-to-edge)
  const edgeClearance = params.edgeClearance ?? 0.1;
  const robotHalfWidth = (params.robotWidth ?? 0.35) / 2;
  const safetyMargin = edgeClearance + robotHalfWidth;

  // Resolve dock path and effective start point
  const { dockPath, dockExitDistance, startPoint } = params;

  // Effective start for mow planning = last point of dock path (garden entry)
  // or startPoint (dock centroid / GPS) if no dock path
  const effectiveStartPoint = dockPath && dockPath.length >= 2
    ? dockPath[dockPath.length - 1]
    : startPoint;

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

  // Save original area before safety buffer (needed for start/return routing
  // because dock/startPoint may lie outside the buffered mowArea)
  const originalArea = mowArea;

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

  const totalArea = turf.area(mowArea);

  // 4. Generate perimeter passes — separated by ring type
  //    First all outer ring passes, then all hole ring passes per hole.
  //    This avoids jumping between outer boundary and exclusion zones.

  // Collect rings separately for each perimeter pass
  const outerPassRings: [number, number][][] = []; // Each entry = one outer ring pass
  const holePassGroups: Map<number, [number, number][][]> = new Map(); // holeIdx → [pass rings]

  let innerAreaFeature = mowArea;
  for (let p = 0; p < perimeterPasses; p++) {
    const offsetMeters = effectiveSpacing * (p + 0.5);
    const buffered = turf.buffer(mowArea, -offsetMeters / 1000, {
      units: "kilometers",
    });
    if (!buffered || turf.area(buffered) < 0.01) break;

    const { outerRings, holeRings } = extractRingsSeparately(buffered);

    // Outer rings
    for (const ring of outerRings) {
      outerPassRings.push(ringToWaypoints(ring));
    }

    // Hole rings — group by hole index to keep each hole's passes together
    holeRings.forEach((ring, hIdx) => {
      if (!holePassGroups.has(hIdx)) holePassGroups.set(hIdx, []);
      holePassGroups.get(hIdx)!.push(ringToWaypoints(ring));
    });

    innerAreaFeature = buffered as Feature<Polygon | MultiPolygon>;
  }

  // Build mow points: outer passes first, then each hole's passes
  // with safe connections between perimeter groups
  const mowPoints: [number, number][] = [];
  const perimeterGroups: [number, number][][] = [];

  // Outer passes as one group
  if (outerPassRings.length > 0) {
    perimeterGroups.push(outerPassRings.flat());
  }

  // Each hole's passes as a separate group
  for (const [, passes] of holePassGroups) {
    perimeterGroups.push(passes.flat());
  }

  // Connect perimeter groups with safe paths
  for (let g = 0; g < perimeterGroups.length; g++) {
    const group = perimeterGroups[g];
    if (g > 0 && mowPoints.length > 0) {
      const from = mowPoints[mowPoints.length - 1];
      const to = group[0];
      if (!isDirectPathInside(from, to, mowArea)) {
        const waypoints = findBestPerimeterPath(from, to, mowArea);
        mowPoints.push(...waypoints);
      }
    }
    mowPoints.push(...group);
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
      const allPoints = addDockPaths(dockPath, dockExitDistance, effectiveStartPoint, mowPoints, originalArea, speed);
      return buildResult(allPoints, speed, 0, totalArea, 0);
    }
  }

  const innerAreaSqm = turf.area(innerAreaFeature);
  const perimeterAreaSqm = Math.max(0, totalArea - innerAreaSqm);

  // 5. Generate parallel stripes with safe connections
  const lastPoint =
    mowPoints.length > 0 ? mowPoints[mowPoints.length - 1] : undefined;

  const { points: stripePoints, stripeCount } = generateParallelStripes(
    innerAreaFeature,
    effectiveSpacing,
    angle,
    mowArea,   // checkArea
    mowArea,   // routeArea — use full mow area for routing
    lastPoint
  );
  mowPoints.push(...stripePoints);

  const turns = Math.max(0, stripeCount - 1);

  // 6. Add dock exit/entry paths and start/return connection
  const allPoints = addDockPaths(dockPath, dockExitDistance, effectiveStartPoint, mowPoints, originalArea, speed);

  return buildResult(allPoints, speed, turns, perimeterAreaSqm, innerAreaSqm);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add dock exit/entry paths around the mow points.
 *
 * Full sequence:
 *   [dock blind exit] → dockPath → startPoint→firstMow connection → mowPoints →
 *   lastMow→startPoint connection → dockPath reversed → [dock blind entry]
 *
 * The blind exit/entry (dockExitDistance) is represented as a dashed
 * segment from the dock zone centroid to the first dockPath point.
 *
 * @param dockPath The drawn dock exit path [[lat, lon], ...]
 * @param dockExitDistance Blind reverse distance in meters (for duration calc)
 * @param startPoint Effective start = last dockPath point or dock centroid
 * @param mowPoints The mowing waypoints
 * @param originalArea Original garden polygon (before safety buffer) for routing
 * @param speed Robot speed for duration calculation
 */
function addDockPaths(
  dockPath: [number, number][] | undefined,
  dockExitDistance: number | undefined,
  startPoint: [number, number] | undefined,
  mowPoints: [number, number][],
  originalArea: Feature<Polygon | MultiPolygon>,
  speed: number
): [number, number][] {
  if (mowPoints.length === 0) return mowPoints;

  const result: [number, number][] = [];

  // --- Exit: Dock → Garden ---
  if (dockPath && dockPath.length >= 2) {
    // Dock exit path (includes blind exit segment visually)
    result.push(...dockPath);
  } else if (startPoint) {
    result.push(startPoint);
  }

  // Connection from start point to first mow point
  if (startPoint && mowPoints.length > 0) {
    const firstMow = mowPoints[0];
    const from = result.length > 0 ? result[result.length - 1] : startPoint;
    if (!isDirectPathInside(from, firstMow, originalArea)) {
      const waypoints = findBestPerimeterPath(from, firstMow, originalArea);
      result.push(...waypoints);
    }
  }

  // All mow points
  result.push(...mowPoints);

  // --- Return: Garden → Dock ---
  if (startPoint && mowPoints.length > 0) {
    const lastMow = mowPoints[mowPoints.length - 1];
    if (!isDirectPathInside(lastMow, startPoint, originalArea)) {
      const waypoints = findBestPerimeterPath(lastMow, startPoint, originalArea);
      result.push(...waypoints);
    }
  }

  if (dockPath && dockPath.length >= 2) {
    // Dock entry path (reverse of exit)
    result.push(...[...dockPath].reverse());
  } else if (startPoint) {
    result.push(startPoint);
  }

  return result;
}

/**
 * Generate parallel mowing stripes across a polygon at a given angle.
 * Stripes are sorted using nearest-neighbor, and connections between
 * stripes that would cross outside the polygon are routed along the
 * best polygon ring (outer or hole).
 */
/**
 * @param checkArea Polygon for isDirectPathInside (full mow area)
 * @param routeArea Polygon whose rings are used for perimeter routing
 */
function generateParallelStripes(
  area: Feature<Polygon | MultiPolygon>,
  spacing: number,
  angleDeg: number,
  checkArea: Feature<Polygon | MultiPolygon>,
  routeArea: Feature<Polygon | MultiPolygon>,
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

      for (let i = 0; i < intersections.length - 1; i += 2) {
        const entry = intersections[i];
        const exit = intersections[i + 1];
        if (!exit) continue;

        let startPt: [number, number];
        let endPt: [number, number];

        if (useRotation) {
          const entryPt = turf.transformRotate(turf.point(entry), angleDeg, {
            pivot: centroid.geometry.coordinates as [number, number],
          });
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

  // --- Nearest-neighbor sorting with safe connections via best ring ---
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

    // Safe connection: route via best ring if direct path is outside
    if (currentPos !== null) {
      const target = stripe[0];
      if (!isDirectPathInside(currentPos, target, checkArea)) {
        const perimeterWaypoints = findBestPerimeterPath(
          currentPos,
          target,
          routeArea
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
