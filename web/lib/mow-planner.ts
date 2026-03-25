/**
 * Mow path planner — generates waypoints for parallel stripe mowing.
 *
 * Algorithm:
 * 1. Merge all target zone polygons into one
 * 2. Apply safety margin (spacing/2 inward buffer)
 * 3. Expand exclusion zones by spacing/2, then subtract from mow area
 * 4. Generate perimeter passes — outer ring passes first (all passes),
 *    then hole ring passes (all passes per hole) separately
 * 5. Generate parallel stripes using angled scan lines (no rotation)
 * 6. Sort stripes by nearest-neighbor for shortest travel between stripes
 * 7. Connect stripes via safeRoute() — projects onto polygon edges for safe routing
 * 8. Add start/return path from dock or GPS position
 * 9. Return waypoints + distance estimate + area stats + dock path lengths
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
 * start vertex.
 */
function projectPointOntoRing(
  point: [number, number],
  ring: number[][]
): { projected: [number, number]; edgeStartIdx: number } {
  const [lat, lon] = point;
  const n = ring.length - 1; // exclude closing point
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
 * 1. If a direct line A→B stays inside → returns [].
 * 2. Otherwise, for each ring: projects A and B onto the nearest EDGE,
 *    builds two candidate paths around the ring, picks shortest.
 *
 * Returns intermediate waypoints (does NOT include A or B themselves).
 */
function safeRoute(
  from: [number, number],
  to: [number, number],
  checkArea: Feature<Polygon | MultiPolygon>,
  routeArea: Feature<Polygon | MultiPolygon>
): [number, number][] {
  if (isDirectPathInside(from, to, checkArea)) {
    return [];
  }

  const allRings = getAllRings(routeArea);
  if (allRings.length === 0) return [];

  let bestPath: [number, number][] = [];
  let bestLength = Infinity;

  for (const ring of allRings) {
    const n = ring.length - 1;
    if (n < 3) continue;

    const fromProj = projectPointOntoRing(from, ring);
    const toProj = projectPointOntoRing(to, ring);

    const fromEdge = fromProj.edgeStartIdx;
    const toEdge = toProj.edgeStartIdx;

    // Forward path: fromProj → walk vertices forward → toProj
    const fwdPath: [number, number][] = [fromProj.projected];
    {
      let v = (fromEdge + 1) % n;
      const stopV = (toEdge + 1) % n;
      let steps = 0;
      while (v !== stopV && steps <= n) {
        fwdPath.push([ring[v][1], ring[v][0]]);
        v = (v + 1) % n;
        steps++;
      }
      fwdPath.push(toProj.projected);
    }

    // Backward path: fromProj → walk vertices backward → toProj
    const bwdPath: [number, number][] = [fromProj.projected];
    {
      let v = fromEdge % n;
      const stopV = toEdge % n;
      let steps = 0;
      while (v !== stopV && steps <= n) {
        bwdPath.push([ring[v][1], ring[v][0]]);
        v = (v - 1 + n) % n;
        steps++;
      }
      bwdPath.push(toProj.projected);
    }

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
    dockExitLength: 0,
    dockEntryLength: 0,
  };

  if (zonePolygons.length === 0) return emptyResult;

  const effectiveSpacing = spacing * (1 - overlap);
  if (effectiveSpacing <= 0) return emptyResult;

  const edgeClearance = params.edgeClearance ?? 0.1;
  const robotHalfWidth = (params.robotWidth ?? 0.35) / 2;
  const safetyMargin = edgeClearance + robotHalfWidth;

  const { dockPath, dockExitDistance, startPoint } = params;

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

  // 2. Apply safety margin: shrink mow area inward
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

  const safeAreaWithHoles = mowArea;

  if (turf.area(mowArea) < 0.01) return emptyResult;

  const totalArea = turf.area(mowArea);

  // 4. Generate perimeter passes
  const outerPassRings: [number, number][][] = [];
  const holePassGroups: Map<number, [number, number][][]> = new Map();

  let innerAreaFeature = mowArea;
  for (let p = 0; p < perimeterPasses; p++) {
    const offsetMeters = effectiveSpacing * (p + 0.5);
    const buffered = turf.buffer(mowArea, -offsetMeters / 1000, {
      units: "kilometers",
    });
    if (!buffered || turf.area(buffered) < 0.01) break;

    const { outerRings, holeRings } = extractRingsSeparately(buffered);

    for (const ring of outerRings) {
      outerPassRings.push(ringToWaypoints(ring));
    }

    holeRings.forEach((ring, hIdx) => {
      if (!holePassGroups.has(hIdx)) holePassGroups.set(hIdx, []);
      holePassGroups.get(hIdx)!.push(ringToWaypoints(ring));
    });

    innerAreaFeature = buffered as Feature<Polygon | MultiPolygon>;
  }

  const mowPoints: [number, number][] = [];
  const perimeterGroups: [number, number][][] = [];

  if (outerPassRings.length > 0) {
    perimeterGroups.push(connectRingsWithSafeRoute(outerPassRings, mowArea));
  }

  for (const [, passes] of holePassGroups) {
    perimeterGroups.push(connectRingsWithSafeRoute(passes, mowArea));
  }

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

  if (perimeterPasses > 0) {
    const innerOffset = effectiveSpacing * perimeterPasses;
    const shrunk = turf.buffer(mowArea, -innerOffset / 1000, {
      units: "kilometers",
    });
    if (shrunk && turf.area(shrunk) > 0.01) {
      innerAreaFeature = shrunk as Feature<Polygon | MultiPolygon>;
    } else {
      const { points: allPoints, dockExitLength, dockEntryLength } =
        addDockPaths(dockPath, dockExitDistance, effectiveStartPoint, mowPoints, safeAreaWithHoles);
      return buildResult(allPoints, speed, 0, totalArea, 0, dockExitLength, dockEntryLength);
    }
  }

  const innerAreaSqm = turf.area(innerAreaFeature);
  const perimeterAreaSqm = Math.max(0, totalArea - innerAreaSqm);

  // 5. Generate parallel stripes with angled scan lines (no rotation)
  const lastPoint =
    mowPoints.length > 0 ? mowPoints[mowPoints.length - 1] : undefined;

  const { points: stripePoints, stripeCount } = generateParallelStripes(
    innerAreaFeature,
    effectiveSpacing,
    angle,
    mowArea,
    mowArea,
    lastPoint
  );
  mowPoints.push(...stripePoints);

  const turns = Math.max(0, stripeCount - 1);

  // 6. Add dock exit/entry paths
  const { points: allPoints, dockExitLength, dockEntryLength } =
    addDockPaths(dockPath, dockExitDistance, effectiveStartPoint, mowPoints, safeAreaWithHoles);

  return buildResult(allPoints, speed, turns, perimeterAreaSqm, innerAreaSqm, dockExitLength, dockEntryLength);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add dock exit/entry paths around the mow points.
 * Returns the full path AND the number of points belonging to dock exit/entry.
 */
function addDockPaths(
  dockPath: [number, number][] | undefined,
  dockExitDistance: number | undefined,
  startPoint: [number, number] | undefined,
  mowPoints: [number, number][],
  safeArea: Feature<Polygon | MultiPolygon>
): { points: [number, number][]; dockExitLength: number; dockEntryLength: number } {
  if (mowPoints.length === 0) {
    return { points: mowPoints, dockExitLength: 0, dockEntryLength: 0 };
  }

  const exitPart: [number, number][] = [];
  const entryPart: [number, number][] = [];

  // --- Exit: Dock → Garden ---
  if (dockPath && dockPath.length >= 2) {
    exitPart.push(...dockPath);
  } else if (startPoint) {
    exitPart.push(startPoint);
  }

  // Connection from start point to first mow point
  if (startPoint && mowPoints.length > 0) {
    const firstMow = mowPoints[0];
    const from = exitPart.length > 0 ? exitPart[exitPart.length - 1] : startPoint;
    const waypoints = safeRoute(from, firstMow, safeArea, safeArea);
    exitPart.push(...waypoints);
  }

  // --- Return: Garden → Dock ---
  if (startPoint && mowPoints.length > 0) {
    const lastMow = mowPoints[mowPoints.length - 1];
    const waypoints = safeRoute(lastMow, startPoint, safeArea, safeArea);
    entryPart.push(...waypoints);
  }

  if (dockPath && dockPath.length >= 2) {
    entryPart.push(...[...dockPath].reverse());
  } else if (startPoint) {
    entryPart.push(startPoint);
  }

  const result: [number, number][] = [...exitPart, ...mowPoints, ...entryPart];

  return {
    points: result,
    dockExitLength: exitPart.length,
    dockEntryLength: entryPart.length,
  };
}

/**
 * Generate parallel mowing stripes across a polygon at a given angle.
 *
 * Uses ANGLED SCAN LINES directly in the original coordinate system
 * instead of rotating the polygon. This eliminates floating-point errors
 * from rotate/unrotate transforms that caused stripes to extend outside
 * the polygon boundary.
 *
 * The scan lines are perpendicular to the mowing direction (angle).
 * Intersection points with the polygon boundary are computed via
 * turf.lineIntersect and lie exactly on the polygon edges.
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
  const [cLon, cLat] = centroid.geometry.coordinates;

  // Convert angle to radians
  // angleDeg = 0 means N-S stripes → scan lines go E-W
  // angleDeg = 45 means NE-SW stripes → scan lines go NW-SE
  const angleRad = (angleDeg * Math.PI) / 180;

  // Mowing direction unit vector (in [lon, lat] space, corrected for latitude)
  const cosLat = Math.cos(cLat * (Math.PI / 180));
  // "step" direction: perpendicular to scan lines, along which we space stripes
  // This is the mowing direction rotated by 0° (the direction stripes are offset)
  const stepDLon = (Math.sin(angleRad) / cosLat); // normalized direction
  const stepDLat = Math.cos(angleRad);
  const stepLen = Math.sqrt(stepDLon * stepDLon + stepDLat * stepDLat);
  const stepNLon = stepDLon / stepLen;
  const stepNLat = stepDLat / stepLen;

  // Scan line direction: perpendicular to step direction (rotate 90°)
  const scanDLon = -stepNLat;
  const scanDLat = stepNLon;

  // Spacing in degrees (approximate)
  const spacingDeg = spacing / 111320;

  // Determine how far we need to go in the step direction
  // Project all bbox corners onto the step axis to find min/max
  const [minLon, minLat, maxLon, maxLat] = turf.bbox(area);
  const corners: [number, number][] = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
  ];

  // Project each corner onto the step axis (dot product with step normal)
  const projections = corners.map(
    ([lon, lat]) => (lon - cLon) * stepNLon + (lat - cLat) * stepNLat
  );
  const minProj = Math.min(...projections);
  const maxProj = Math.max(...projections);

  // Scan line half-length: project corners onto scan axis for extent
  const scanProjections = corners.map(
    ([lon, lat]) => (lon - cLon) * scanDLon + (lat - cLat) * scanDLat
  );
  const scanExtent =
    Math.max(...scanProjections) - Math.min(...scanProjections);
  const scanHalf = scanExtent / 2 + 0.001; // small margin

  const stripes: [number, number][][] = [];

  // Step from minProj to maxProj, generating scan lines
  let d = minProj + spacingDeg / 2;
  while (d < maxProj) {
    // Center of this scan line
    const lineCenterLon = cLon + d * stepNLon;
    const lineCenterLat = cLat + d * stepNLat;

    // Scan line endpoints (long enough to cross the entire polygon)
    const lineCoords: Position[] = [
      [
        lineCenterLon - scanHalf * scanDLon,
        lineCenterLat - scanHalf * scanDLat,
      ],
      [
        lineCenterLon + scanHalf * scanDLon,
        lineCenterLat + scanHalf * scanDLat,
      ],
    ];

    const scanLine = turf.lineString(lineCoords);
    const intersections = findLinePolygonIntersections(scanLine, area);

    if (intersections.length >= 2) {
      // Sort intersections along the scan direction
      intersections.sort((a, b) => {
        const projA = (a[0] - lineCenterLon) * scanDLon + (a[1] - lineCenterLat) * scanDLat;
        const projB = (b[0] - lineCenterLon) * scanDLon + (b[1] - lineCenterLat) * scanDLat;
        return projA - projB;
      });

      // Take pairwise (entry/exit) as stripe segments
      for (let i = 0; i < intersections.length - 1; i += 2) {
        const entry = intersections[i];
        const exit = intersections[i + 1];
        if (!exit) continue;

        // Intersection points are in [lon, lat] (GeoJSON), convert to [lat, lon]
        const startPt: [number, number] = [entry[1], entry[0]];
        const endPt: [number, number] = [exit[1], exit[0]];

        stripes.push([startPt, endPt]);
      }
    }

    d += spacingDeg;
  }

  if (stripes.length === 0) {
    return { points: [], stripeCount: 0 };
  }

  // --- Nearest-neighbor sorting with safe connections ---
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

    // Safe connection via polygon edge projection
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
  innerArea: number = 0,
  dockExitLength: number = 0,
  dockEntryLength: number = 0
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
    dockExitLength,
    dockEntryLength,
  };
}
