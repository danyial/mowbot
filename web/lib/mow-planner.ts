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
 * 7. Connect stripes via safeRoute() — projects onto polygon edges for safe routing
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

// ─────────────────────────────────────────────────────────────────────────────
// Safe routing — project onto polygon EDGES, not just vertices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Project a [lat, lon] point onto the nearest EDGE of a ring [[lon, lat], ...].
 * Returns the projected point as [lat, lon] and the index of the edge's
 * start vertex. This ensures the connection from the original point to
 * the projected point is a short perpendicular segment that stays inside
 * the polygon (unlike jumping to the nearest vertex which may be around
 * a concave corner).
 */
function projectPointOntoRing(
  point: [number, number],
  ring: number[][]
): { projected: [number, number]; edgeStartIdx: number } {
  const [lat, lon] = point;
  const n = ring.length - 1; // exclude closing point (same as first)
  if (n <= 0) return { projected: point, edgeStartIdx: 0 };

  let bestDist = Infinity;
  let bestProjected: [number, number] = point;
  let bestEdgeIdx = 0;

  for (let i = 0; i < n; i++) {
    const ax = ring[i][0],
      ay = ring[i][1]; // [lon, lat]
    const j = (i + 1) % n;
    const bx = ring[j][0],
      by = ring[j][1];

    // Project point [lon, lat] onto segment A→B
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-20) continue;

    let t = ((lon - ax) * dx + (lat - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const px = ax + t * dx;
    const py = ay + t * dy;
    const dist = (lon - px) * (lon - px) + (lat - py) * (lat - py);

    if (dist < bestDist) {
      bestDist = dist;
      bestProjected = [py, px]; // [lat, lon]
      bestEdgeIdx = i;
    }
  }

  return { projected: bestProjected, edgeStartIdx: bestEdgeIdx };
}

/**
 * Route safely from A to B within the polygon.
 *
 * 1. If a direct line A→B stays inside the polygon → returns [].
 * 2. Otherwise, for each ring of routeArea:
 *    - Projects A and B onto the nearest EDGE of that ring
 *    - Builds two candidate paths around the ring (forward + backward)
 *    - Each candidate: projectedA → ring vertices → projectedB
 * 3. Picks the shortest overall path across all rings and directions.
 *
 * Returns intermediate waypoints to insert between A and B.
 * Does NOT include A or B themselves in the result.
 */
function safeRoute(
  from: [number, number],
  to: [number, number],
  checkArea: Feature<Polygon | MultiPolygon>,
  routeArea: Feature<Polygon | MultiPolygon>
): [number, number][] {
  // Direct path is fine — no routing needed
  if (isDirectPathInside(from, to, checkArea)) {
    return [];
  }

  const allRings = getAllRings(routeArea);
  if (allRings.length === 0) return [];

  let bestPath: [number, number][] = [];
  let bestLength = Infinity;

  for (const ring of allRings) {
    const n = ring.length - 1; // exclude closing point
    if (n < 3) continue;

    // Project both endpoints onto this ring's nearest EDGE
    const fromProj = projectPointOntoRing(from, ring);
    const toProj = projectPointOntoRing(to, ring);

    const fromEdge = fromProj.edgeStartIdx;
    const toEdge = toProj.edgeStartIdx;

    // Build two candidate paths around the ring between the projections
    // Forward: fromProj → walk vertices forward → toProj
    const fwdPath: [number, number][] = [fromProj.projected];
    {
      // Start from vertex AFTER fromEdge, walk to vertex AFTER toEdge
      let v = (fromEdge + 1) % n;
      const stopV = (toEdge + 1) % n;
      let steps = 0;
      while (v !== stopV && steps <= n) {
        fwdPath.push([ring[v][1], ring[v][0]]); // [lat, lon]
        v = (v + 1) % n;
        steps++;
      }
      fwdPath.push(toProj.projected);
    }

    // Backward: fromProj → walk vertices backward → toProj
    const bwdPath: [number, number][] = [fromProj.projected];
    {
      let v = fromEdge % n;
      const stopV = toEdge % n;
      let steps = 0;
      while (v !== stopV && steps <= n) {
        bwdPath.push([ring[v][1], ring[v][0]]); // [lat, lon]
        v = (v - 1 + n) % n;
        steps++;
      }
      bwdPath.push(toProj.projected);
    }

    // Evaluate both candidates (total path including from→candidate→to)
    for (const candidate of [fwdPath, bwdPath]) {
      const fullPath: [number, number][] = [from, ...candidate, to];
      let len = 0;
      for (let i = 1; i < fullPath.length; i++) {
        const dLat = fullPath[i][0] - fullPath[i - 1][0];
        const dLon = fullPath[i][1] - fullPath[i - 1][1];
        len += Math.sqrt(dLat * dLat + dLon * dLon);
      }
      if (len < bestLength) {
        bestLength = len;
        bestPath = candidate;
      }
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

/**
 * Connect a sequence of ring waypoint arrays with safe routing between them.
 * Used for perimeter pass rings that may come from separate polygons
 * (MultiPolygon buffers) and need validated connections.
 */
function connectRingsWithSafeRoute(
  rings: [number, number][][],
  routeArea: Feature<Polygon | MultiPolygon>
): [number, number][] {
  if (rings.length === 0) return [];
  const result: [number, number][] = [...rings[0]];

  for (let i = 1; i < rings.length; i++) {
    const from = result[result.length - 1];
    const to = rings[i][0];
    const waypoints = safeRoute(from, to, routeArea, routeArea);
    result.push(...waypoints);
    result.push(...rings[i]);
  }

  return result;
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

  // Save mowArea after safety buffer + exclusion subtraction.
  // This polygon has the correct boundaries AND exclusion holes,
  // used for all routing (perimeter connections, stripe connections, dock paths).
  const safeAreaWithHoles = mowArea;

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

  // Outer passes — connect individual rings safely (handles MultiPolygon)
  if (outerPassRings.length > 0) {
    perimeterGroups.push(connectRingsWithSafeRoute(outerPassRings, mowArea));
  }

  // Each hole's passes — connect individual rings safely
  for (const [, passes] of holePassGroups) {
    perimeterGroups.push(connectRingsWithSafeRoute(passes, mowArea));
  }

  // Connect perimeter groups with safe routes
  for (let g = 0; g < perimeterGroups.length; g++) {
    const group = perimeterGroups[g];
    if (g > 0 && mowPoints.length > 0) {
      const from = mowPoints[mowPoints.length - 1];
      const to = group[0];
      const waypoints = safeRoute(from, to, mowArea, mowArea);
      mowPoints.push(...waypoints);
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
      const allPoints = addDockPaths(dockPath, dockExitDistance, effectiveStartPoint, mowPoints, safeAreaWithHoles, speed);
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
  const allPoints = addDockPaths(dockPath, dockExitDistance, effectiveStartPoint, mowPoints, safeAreaWithHoles, speed);

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
 * @param safeArea Polygon with safety buffer + exclusion holes for routing
 * @param speed Robot speed for duration calculation
 */
function addDockPaths(
  dockPath: [number, number][] | undefined,
  dockExitDistance: number | undefined,
  startPoint: [number, number] | undefined,
  mowPoints: [number, number][],
  safeArea: Feature<Polygon | MultiPolygon>,
  speed: number
): [number, number][] {
  if (mowPoints.length === 0) return mowPoints;

  const result: [number, number][] = [];

  // --- Exit: Dock → Garden ---
  if (dockPath && dockPath.length >= 2) {
    result.push(...dockPath);
  } else if (startPoint) {
    result.push(startPoint);
  }

  // Connection from start point to first mow point
  if (startPoint && mowPoints.length > 0) {
    const firstMow = mowPoints[0];
    const from = result.length > 0 ? result[result.length - 1] : startPoint;
    const waypoints = safeRoute(from, firstMow, safeArea, safeArea);
    result.push(...waypoints);
  }

  // All mow points
  result.push(...mowPoints);

  // --- Return: Garden → Dock ---
  if (startPoint && mowPoints.length > 0) {
    const lastMow = mowPoints[mowPoints.length - 1];
    const waypoints = safeRoute(lastMow, startPoint, safeArea, safeArea);
    result.push(...waypoints);
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
 * stripes that would cross outside the polygon are routed safely via
 * safeRoute() — projecting onto polygon edges instead of just vertices.
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

  // --- Nearest-neighbor sorting with safe connections via edge projection ---
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

    // Safe connection: route via polygon edge projection if direct path is outside
    if (currentPos !== null) {
      const target = stripe[0];
      const routeWaypoints = safeRoute(currentPos, target, checkArea, routeArea);
      result.push(...routeWaypoints);
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
