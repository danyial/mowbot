/**
 * Mow path planner — generates waypoints for parallel stripe mowing.
 *
 * Algorithm:
 * 1. Merge all target zone polygons into one (or use individually)
 * 2. Subtract exclusion zones from the mow area
 * 3. Generate perimeter passes (inward polygon offsets)
 * 4. Generate parallel stripes at the given angle over the remaining inner area
 * 5. Sort stripes in boustrophedon (serpentine) order
 * 6. Return waypoints + distance estimate
 */

import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon, Position } from "geojson";
import type { PlanResult } from "./types/mission";

/**
 * Generate a complete mow path for the given parameters.
 */
export function generateMowPath(params: {
  /** Polygons of zones to mow (GeoJSON coordinates) */
  zonePolygons: number[][][][]; // Array of GeoJSON Polygon coordinate arrays
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
    pathPoints: [], estimatedDistance: 0, estimatedDuration: 0,
    turns: 0, perimeterArea: 0, innerArea: 0,
  };

  if (zonePolygons.length === 0) return emptyResult;

  const effectiveSpacing = spacing * (1 - overlap);
  if (effectiveSpacing <= 0) return emptyResult;

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

  // 2. Subtract exclusion zones
  for (const exCoords of exclusionPolygons) {
    try {
      const exclusion = turf.polygon(exCoords);
      const diff = turf.difference(turf.featureCollection([mowArea, exclusion]));
      if (diff) mowArea = diff as Feature<Polygon | MultiPolygon>;
    } catch {
      // Skip invalid exclusions
    }
  }

  const allPoints: [number, number][] = [];
  const totalArea = turf.area(mowArea); // m²

  // 3. Generate perimeter passes
  let innerAreaFeature = mowArea;
  for (let p = 0; p < perimeterPasses; p++) {
    const offsetMeters = effectiveSpacing * (p + 0.5); // Half-spacing for first pass, then full increments
    const buffered = turf.buffer(mowArea, -offsetMeters / 1000, { units: "kilometers" });
    if (!buffered || turf.area(buffered) < 0.01) break; // Too small, stop

    // Extract the perimeter ring(s) as waypoints
    const perimeterPoints = extractPerimeterPoints(buffered);
    allPoints.push(...perimeterPoints);

    // The inner area is the last valid buffer
    innerAreaFeature = buffered as Feature<Polygon | MultiPolygon>;
  }

  // If we had perimeter passes, shrink the inner area one more time
  if (perimeterPasses > 0) {
    const innerOffset = effectiveSpacing * perimeterPasses;
    const shrunk = turf.buffer(mowArea, -innerOffset / 1000, { units: "kilometers" });
    if (shrunk && turf.area(shrunk) > 0.01) {
      innerAreaFeature = shrunk as Feature<Polygon | MultiPolygon>;
    } else {
      // Entire area covered by perimeter passes
      const innerAreaSqm = 0;
      const perimeterAreaSqm = totalArea;
      return buildResult(allPoints, speed, 0, perimeterAreaSqm, innerAreaSqm);
    }
  }

  // Calculate areas
  const innerAreaSqm = turf.area(innerAreaFeature);
  const perimeterAreaSqm = Math.max(0, totalArea - innerAreaSqm);

  // 4. Generate parallel stripes over the inner area
  const { points: stripePoints, stripeCount } = generateParallelStripes(
    innerAreaFeature, effectiveSpacing, angle
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
    // Outer ring only
    const ring = coords[0];
    for (const [lon, lat] of ring) {
      points.push([lat, lon]);
    }
  }
  return points;
}

/**
 * Generate parallel mowing stripes across a polygon at a given angle.
 * Returns waypoints in boustrophedon (serpentine) order.
 */
function generateParallelStripes(
  area: Feature<Polygon | MultiPolygon>,
  spacing: number, // meters
  angleDeg: number
): { points: [number, number][]; stripeCount: number } {
  // Get the bounding box and centroid for rotation
  const bbox = turf.bbox(area);
  const centroid = turf.centroid(area);
  const [minLon, minLat, maxLon, maxLat] = bbox;

  // Convert spacing from meters to approximate degrees
  // At the centroid latitude
  const centerLat = centroid.geometry.coordinates[1];
  const spacingDeg = spacing / 111320; // meters to degrees latitude
  const spacingDegLon = spacing / (111320 * Math.cos((centerLat * Math.PI) / 180));

  // If angle is non-zero, we rotate the polygon to align stripes with 0°,
  // generate stripes, then rotate the points back.
  const angleRad = (angleDeg * Math.PI) / 180;
  const useRotation = Math.abs(angleDeg % 360) > 0.1;

  let workArea = area;
  if (useRotation) {
    // Rotate the polygon so that stripes at `angle` become horizontal (0°)
    workArea = turf.transformRotate(area, -angleDeg, {
      pivot: centroid.geometry.coordinates as [number, number],
    }) as Feature<Polygon | MultiPolygon>;
  }

  // Get bbox of the (possibly rotated) work area
  const workBbox = turf.bbox(workArea);
  const [wMinLon, wMinLat, wMaxLon, wMaxLat] = workBbox;

  // Generate horizontal scan lines across the work area
  const stripes: [number, number][][] = []; // Each stripe is an array of [lat, lon] intersections

  let y = wMinLat + spacingDeg / 2;
  while (y < wMaxLat) {
    // Create a horizontal line across the full bbox width
    const lineCoords: Position[] = [
      [wMinLon - 0.001, y],
      [wMaxLon + 0.001, y],
    ];
    const scanLine = turf.lineString(lineCoords);

    // Find intersections with the work area boundary
    const intersections = findLinePolygonIntersections(scanLine, workArea);

    if (intersections.length >= 2) {
      // Sort intersections by longitude
      intersections.sort((a, b) => a[0] - b[0]);

      // Create segments (pairs of entry/exit points)
      const stripePoints: [number, number][] = [];
      for (let i = 0; i < intersections.length - 1; i += 2) {
        const entry = intersections[i];
        const exit = intersections[i + 1];
        if (exit) {
          if (useRotation) {
            // Rotate points back
            const entryPt = turf.transformRotate(
              turf.point(entry),
              angleDeg,
              { pivot: centroid.geometry.coordinates as [number, number] }
            );
            const exitPt = turf.transformRotate(
              turf.point(exit),
              angleDeg,
              { pivot: centroid.geometry.coordinates as [number, number] }
            );
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
      }

      if (stripePoints.length > 0) {
        stripes.push(stripePoints);
      }
    }

    y += spacingDeg;
  }

  // Boustrophedon order: alternate direction of each stripe
  const result: [number, number][] = [];
  for (let i = 0; i < stripes.length; i++) {
    if (i % 2 === 1) {
      // Reverse every other stripe
      result.push(...stripes[i].reverse());
    } else {
      result.push(...stripes[i]);
    }
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
  innerArea: number = 0,
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
