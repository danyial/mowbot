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
 * 7. Connect stripes via safeRoute() — visibility graph with clearance enforcement
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
    outerRings.push(coords[0]);
    for (let i = 1; i < coords.length; i++) {
      holeRings.push(coords[i]);
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

/** Collect unique [lat, lon] vertices from a polygon's rings */
function collectVertices(area: Feature<Polygon | MultiPolygon>): [number, number][] {
  const verts: [number, number][] = [];
  for (const ring of getAllRings(area)) {
    const n = ring.length - 1;
    for (let i = 0; i < n; i++) {
      verts.push([ring[i][1], ring[i][0]]);
    }
  }
  return verts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified safe routing — visibility graph with clearance enforcement
// ─────────────────────────────────────────────────────────────────────────────

/** ~2m in degrees — segments shorter than this are allowed near the edge */
const SHORT_SEGMENT_DEG = 2.0 / 111320;

/**
 * Route safely from A to B within the polygon using a visibility graph.
 *
 * Unified routing for ALL path types (stripe connections, perimeter groups,
 * dock connections). The same clearance rules apply everywhere:
 *
 * 1. If a direct line A→B stays inside insetArea (or checkArea if no inset)
 *    → returns [] (direct connection is fine).
 * 2. Otherwise, builds a visibility graph using vertices from routeArea
 *    AND insetArea (if provided) as waypoint candidates.
 * 3. canConnect rules:
 *    - All segments must stay inside checkArea (the mowArea boundary).
 *    - Long segments (>2m) must ALSO stay inside insetArea (maintains extra
 *      clearance from boundaries and exclusion zones).
 *    - Short segments (<2m) are allowed in the edge corridor (for hops from
 *      edge vertices to interior vertices).
 * 4. Finds shortest valid path via Dijkstra.
 *
 * @param checkArea  Polygon for basic validity — segments must be inside this.
 *                   Typically the mowArea (safetyMargin-inset garden minus exclusions).
 * @param routeArea  Polygon whose vertices are used as Dijkstra nodes.
 *                   Typically the same as checkArea.
 * @param insetArea  Optional further-inset polygon. When provided:
 *                   - Its vertices are added as additional Dijkstra nodes.
 *                   - Long segments must stay inside this area.
 *                   This forces connections to route through the interior,
 *                   maintaining extra clearance from boundaries.
 *
 * Returns intermediate waypoints (does NOT include A or B themselves).
 */
function safeRoute(
  from: [number, number],
  to: [number, number],
  checkArea: Feature<Polygon | MultiPolygon>,
  routeArea: Feature<Polygon | MultiPolygon>,
  insetArea?: Feature<Polygon | MultiPolygon>
): [number, number][] {
  // If insetArea is provided, prefer direct paths that stay inside it
  const directCheckArea = insetArea ?? checkArea;
  if (isDirectPathInside(from, to, directCheckArea)) {
    return [];
  }

  // Collect nodes: from + to + routeArea vertices + insetArea vertices
  const nodes: [number, number][] = [from, to];
  nodes.push(...collectVertices(routeArea));
  if (insetArea) {
    nodes.push(...collectVertices(insetArea));
  }

  const N = nodes.length;
  const hasInset = !!insetArea;

  function canConnect(a: [number, number], b: [number, number]): boolean {
    const [lat1, lon1] = a;
    const [lat2, lon2] = b;
    if (Math.abs(lat1 - lat2) < 1e-12 && Math.abs(lon1 - lon2) < 1e-12) return true;

    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const segLenDeg = Math.sqrt(dLat * dLat + dLon * dLon);
    const isLong = hasInset && segLenDeg > SHORT_SEGMENT_DEG;

    // More samples for long segments to catch small exclusion zones
    const samples = isLong
      ? [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
         0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
      : [0.25, 0.5, 0.75];

    for (const t of samples) {
      const sLat = lat1 + dLat * t;
      const sLon = lon1 + dLon * t;
      const pt = turf.point([sLon, sLat]);
      // Must always be inside checkArea
      if (!turf.booleanPointInPolygon(pt, checkArea)) return false;
      // Long segments must also be inside insetArea (extra clearance)
      if (isLong && !turf.booleanPointInPolygon(pt, insetArea!)) return false;
    }
    return true;
  }

  // Dijkstra's algorithm
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const visited = new Uint8Array(N);
  dist[0] = 0;

  for (let iter = 0; iter < N; iter++) {
    let u = -1;
    let uDist = Infinity;
    for (let i = 0; i < N; i++) {
      if (!visited[i] && dist[i] < uDist) {
        uDist = dist[i];
        u = i;
      }
    }
    if (u === -1 || u === 1) break;
    visited[u] = 1;

    for (let v = 0; v < N; v++) {
      if (visited[v]) continue;
      if (!canConnect(nodes[u], nodes[v])) continue;

      const dLat = nodes[v][0] - nodes[u][0];
      const dLon = nodes[v][1] - nodes[u][1];
      const edgeDist = Math.sqrt(dLat * dLat + dLon * dLon);
      const newDist = dist[u] + edgeDist;

      if (newDist < dist[v]) {
        dist[v] = newDist;
        prev[v] = u;
      }
    }
  }

  if (dist[1] === Infinity) return [];

  const pathIndices: number[] = [];
  let cur = 1;
  while (cur !== 0 && cur !== -1) {
    pathIndices.push(cur);
    cur = prev[cur];
  }
  pathIndices.reverse();

  const waypoints: [number, number][] = [];
  for (const idx of pathIndices) {
    if (idx !== 1) waypoints.push(nodes[idx]);
  }

  return waypoints;
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
  routeArea: Feature<Polygon | MultiPolygon>,
  insetArea?: Feature<Polygon | MultiPolygon>
): [number, number][] {
  if (rings.length === 0) return [];
  const result: [number, number][] = [...rings[0]];

  for (let i = 1; i < rings.length; i++) {
    const from = result[result.length - 1];
    const to = rings[i][0];
    const waypoints = safeRoute(from, to, routeArea, routeArea, insetArea);
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

  // Create inset area for routing clearance enforcement.
  // All long connection segments (>2m) must stay inside this further-inset polygon,
  // ensuring they maintain extra clearance from boundaries and exclusion zones.
  // This applies uniformly to stripe connections, perimeter connections, and dock connections.
  let routeInsetArea: Feature<Polygon | MultiPolygon> | undefined;
  const inset = turf.buffer(mowArea, -(effectiveSpacing * 0.5) / 1000, {
    units: "kilometers",
  });
  if (inset && turf.area(inset) > 0.01) {
    routeInsetArea = inset as Feature<Polygon | MultiPolygon>;
  }

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
    perimeterGroups.push(connectRingsWithSafeRoute(outerPassRings, mowArea, routeInsetArea));
  }

  for (const [, passes] of holePassGroups) {
    perimeterGroups.push(connectRingsWithSafeRoute(passes, mowArea, routeInsetArea));
  }

  for (let g = 0; g < perimeterGroups.length; g++) {
    const group = perimeterGroups[g];
    if (g > 0 && mowPoints.length > 0) {
      const from = mowPoints[mowPoints.length - 1];
      const to = group[0];
      const waypoints = safeRoute(from, to, mowArea, mowArea, routeInsetArea);
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
        addDockPaths(dockPath, dockExitDistance, effectiveStartPoint, mowPoints, safeAreaWithHoles, routeInsetArea);
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
    lastPoint,
    routeInsetArea
  );
  mowPoints.push(...stripePoints);

  const turns = Math.max(0, stripeCount - 1);

  // 6. Add dock exit/entry paths
  const { points: allPoints, dockExitLength, dockEntryLength } =
    addDockPaths(dockPath, dockExitDistance, effectiveStartPoint, mowPoints, safeAreaWithHoles, routeInsetArea);

  return buildResult(allPoints, speed, turns, perimeterAreaSqm, innerAreaSqm, dockExitLength, dockEntryLength);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add dock exit/entry paths around the mow points.
 * Returns the full path AND the number of points belonging to dock exit/entry.
 *
 * The dock path itself (the user-drawn LineString from dock to garden entry)
 * is used as-is — it may cross garden boundaries because the dock is at the edge.
 * The CONNECTION from dock path end to the first mow point uses safeRoute with
 * insetArea to maintain clearance from boundaries.
 */
function addDockPaths(
  dockPath: [number, number][] | undefined,
  dockExitDistance: number | undefined,
  startPoint: [number, number] | undefined,
  mowPoints: [number, number][],
  safeArea: Feature<Polygon | MultiPolygon>,
  insetArea?: Feature<Polygon | MultiPolygon>
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

  // Connection from dock/start to first mow point — uses unified safeRoute
  if (startPoint && mowPoints.length > 0) {
    const firstMow = mowPoints[0];
    const from = exitPart.length > 0 ? exitPart[exitPart.length - 1] : startPoint;
    const waypoints = safeRoute(from, firstMow, safeArea, safeArea, insetArea);
    exitPart.push(...waypoints);
  }

  // --- Return: Garden → Dock ---
  if (startPoint && mowPoints.length > 0) {
    const lastMow = mowPoints[mowPoints.length - 1];
    const waypoints = safeRoute(lastMow, startPoint, safeArea, safeArea, insetArea);
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
 * Uses ANGLED SCAN LINES directly in the original coordinate system.
 * Intersection points with the polygon boundary are computed via
 * turf.lineIntersect and lie exactly on the polygon edges.
 */
function generateParallelStripes(
  area: Feature<Polygon | MultiPolygon>,
  spacing: number,
  angleDeg: number,
  checkArea: Feature<Polygon | MultiPolygon>,
  routeArea: Feature<Polygon | MultiPolygon>,
  startFrom?: [number, number],
  insetArea?: Feature<Polygon | MultiPolygon>
): { points: [number, number][]; stripeCount: number } {
  const centroid = turf.centroid(area);
  const [cLon, cLat] = centroid.geometry.coordinates;

  const angleRad = (angleDeg * Math.PI) / 180;

  const cosLat = Math.cos(cLat * (Math.PI / 180));
  const stepDLon = (Math.sin(angleRad) / cosLat);
  const stepDLat = Math.cos(angleRad);
  const stepLen = Math.sqrt(stepDLon * stepDLon + stepDLat * stepDLat);
  const stepNLon = stepDLon / stepLen;
  const stepNLat = stepDLat / stepLen;

  const scanDLon = -stepNLat;
  const scanDLat = stepNLon;

  const spacingDeg = spacing / 111320;

  const [minLon, minLat, maxLon, maxLat] = turf.bbox(area);
  const corners: [number, number][] = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
  ];

  const projections = corners.map(
    ([lon, lat]) => (lon - cLon) * stepNLon + (lat - cLat) * stepNLat
  );
  const minProj = Math.min(...projections);
  const maxProj = Math.max(...projections);

  const scanProjections = corners.map(
    ([lon, lat]) => (lon - cLon) * scanDLon + (lat - cLat) * scanDLat
  );
  const scanExtent =
    Math.max(...scanProjections) - Math.min(...scanProjections);
  const scanHalf = scanExtent / 2 + 0.001;

  const stripes: [number, number][][] = [];

  let d = minProj + spacingDeg / 2;
  while (d < maxProj) {
    const lineCenterLon = cLon + d * stepNLon;
    const lineCenterLat = cLat + d * stepNLat;

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
      intersections.sort((a, b) => {
        const projA = (a[0] - lineCenterLon) * scanDLon + (a[1] - lineCenterLat) * scanDLat;
        const projB = (b[0] - lineCenterLon) * scanDLon + (b[1] - lineCenterLat) * scanDLat;
        return projA - projB;
      });

      for (let i = 0; i < intersections.length - 1; i += 2) {
        const entry = intersections[i];
        const exit = intersections[i + 1];
        if (!exit) continue;

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

    // Safe connection — uses unified safeRoute with insetArea for clearance
    if (currentPos !== null) {
      const target = stripe[0];
      const routeWaypoints = safeRoute(currentPos, target, checkArea, routeArea, insetArea);
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
