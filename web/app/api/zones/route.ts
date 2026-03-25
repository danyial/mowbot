import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import * as turf from "@turf/turf";
import type { Zone, ZoneCollection } from "@/lib/types/zones";
import { isLineZoneType } from "@/lib/types/zones";

const ZONES_FILE = path.join(process.cwd(), "data", "zones.json");

async function readZones(): Promise<ZoneCollection> {
  try {
    const content = await fs.readFile(ZONES_FILE, "utf-8");
    const data = JSON.parse(content);
    if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
      return data as ZoneCollection;
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return { type: "FeatureCollection", features: [] };
}

async function writeZones(collection: ZoneCollection): Promise<void> {
  await fs.writeFile(ZONES_FILE, JSON.stringify(collection, null, 2), "utf-8");
}

/**
 * Calculate area for a polygon zone using Turf.js (geodesic, WGS84)
 */
function calculateArea(zone: Zone): number {
  if (zone.geometry.type !== "Polygon") return 0;
  try {
    const polygon = turf.polygon(zone.geometry.coordinates as number[][][]);
    return turf.area(polygon); // Square meters
  } catch {
    return 0;
  }
}

/**
 * Validate a polygon geometry using Turf.js
 */
function validatePolygon(
  coordinates: number[][][]
): { valid: boolean; error?: string } {
  try {
    const ring = coordinates[0];
    if (!ring || ring.length < 4) {
      return {
        valid: false,
        error: "Mindestens 3 Punkte erforderlich (+ Schlusspunkt)",
      };
    }

    // Check if ring is closed
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return { valid: false, error: "Polygon muss geschlossen sein" };
    }

    // Validate with Turf
    const polygon = turf.polygon(coordinates);
    const kinked = turf.kinks(polygon);
    if (kinked.features.length > 0) {
      return {
        valid: false,
        error: "Polygon hat Selbstueberschneidungen",
      };
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Ungueltige Geometrie",
    };
  }
}

/**
 * Convert lat/lon points array to GeoJSON Polygon coordinates.
 * GeoJSON uses [longitude, latitude] order.
 * Input points are [latitude, longitude] (Leaflet convention).
 */
function pointsToGeoJSONPolygon(
  points: [number, number][]
): number[][][] {
  const ring = points.map(([lat, lon]) => [lon, lat]);
  // Close the ring if not already closed
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] ||
      ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([...ring[0]]);
  }
  return [ring];
}

function pointsToGeoJSONLineString(
  points: [number, number][]
): number[][] {
  return points.map(([lat, lon]) => [lon, lat]);
}

/**
 * GET /api/zones — Load all zones
 */
export async function GET() {
  const collection = await readZones();

  // Enrich each zone with calculated area
  const enriched = collection.features.map((zone) => ({
    ...zone,
    properties: {
      ...zone.properties,
      area: calculateArea(zone),
    },
  }));

  return NextResponse.json({
    type: "FeatureCollection",
    features: enriched,
  });
}

/**
 * POST /api/zones — Create a new zone
 *
 * Body: { name, zoneType, points?, coordinates?, color?, mowHeight? }
 *
 * Accepts either:
 * - points: [[lat, lon], ...] — Leaflet convention, will be converted
 * - coordinates: [[[lon, lat], ...]] — GeoJSON convention, used directly
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { name, zoneType, points, coordinates, color, mowHeight } = body;

    if (!name || !zoneType) {
      return NextResponse.json(
        { error: "name und zoneType erforderlich" },
        { status: 400 }
      );
    }

    const isLine = isLineZoneType(zoneType);
    let geomType: "Polygon" | "LineString" | "Point" = isLine ? "LineString" : "Polygon";
    let geomCoordinates: number[][][] | number[][] | number[];

    if (zoneType === "dock" && body.position) {
      // Dock zone is a Point
      geomType = "Point";
      const [lat, lon] = body.position;
      geomCoordinates = [lon, lat]; // GeoJSON [lon, lat]
    } else if (coordinates) {
      // GeoJSON coordinates provided directly
      geomCoordinates = coordinates;
    } else if (isLine && points && Array.isArray(points) && points.length >= 2) {
      // LineString: Convert Leaflet [lat, lon] points to GeoJSON LineString
      geomCoordinates = pointsToGeoJSONLineString(points);
    } else if (!isLine && points && Array.isArray(points) && points.length >= 3) {
      // Polygon: Convert Leaflet [lat, lon] points to GeoJSON Polygon
      geomCoordinates = pointsToGeoJSONPolygon(points);
    } else {
      const minPoints = isLine ? 2 : 3;
      return NextResponse.json(
        { error: `Mindestens ${minPoints} Punkte erforderlich` },
        { status: 400 }
      );
    }

    // Validate polygon geometry (skip for LineString and Point)
    if (geomType === "Polygon") {
      const validation = validatePolygon(
        geomCoordinates as number[][][]
      );
      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error },
          { status: 400 }
        );
      }
    }

    const now = new Date().toISOString();
    const zone: Zone = {
      type: "Feature",
      id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      properties: {
        name,
        zoneType,
        ...(color && { color }),
        ...(mowHeight != null && { mowHeight }),
        createdAt: now,
        updatedAt: now,
      },
      geometry: {
        type: geomType,
        coordinates: geomCoordinates,
      },
    };

    const collection = await readZones();
    collection.features.push(zone);
    await writeZones(collection);

    return NextResponse.json(
      {
        ...zone,
        properties: {
          ...zone.properties,
          area: calculateArea(zone),
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Fehler beim Erstellen der Zone" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/zones — Update an existing zone
 *
 * Body: { id, ...updates }
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Zone-ID erforderlich" },
        { status: 400 }
      );
    }

    const collection = await readZones();
    const index = collection.features.findIndex((z) => z.id === id);

    if (index === -1) {
      return NextResponse.json(
        { error: "Zone nicht gefunden" },
        { status: 404 }
      );
    }

    const existing = collection.features[index];

    // Update coordinates if points or coordinates provided
    if (updates.points) {
      if (existing.geometry.type === "LineString") {
        existing.geometry.coordinates = pointsToGeoJSONLineString(updates.points);
      } else {
        existing.geometry.coordinates = pointsToGeoJSONPolygon(updates.points);
      }
      delete updates.points;
    } else if (updates.coordinates) {
      existing.geometry.coordinates = updates.coordinates;
      delete updates.coordinates;
    }

    // Validate updated polygon
    if (existing.geometry.type === "Polygon") {
      const validation = validatePolygon(
        existing.geometry.coordinates as number[][][]
      );
      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error },
          { status: 400 }
        );
      }
    }

    // Merge property updates
    existing.properties = {
      ...existing.properties,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    collection.features[index] = existing;
    await writeZones(collection);

    return NextResponse.json({
      ...existing,
      properties: {
        ...existing.properties,
        area: calculateArea(existing),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Fehler beim Aktualisieren der Zone" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/zones — Delete a zone
 *
 * Body: { id }
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Zone-ID erforderlich" },
        { status: 400 }
      );
    }

    const collection = await readZones();
    const index = collection.features.findIndex((z) => z.id === id);

    if (index === -1) {
      return NextResponse.json(
        { error: "Zone nicht gefunden" },
        { status: 404 }
      );
    }

    const removed = collection.features.splice(index, 1)[0];
    await writeZones(collection);

    return NextResponse.json({ success: true, deleted: removed.id });
  } catch {
    return NextResponse.json(
      { error: "Fehler beim Loeschen der Zone" },
      { status: 500 }
    );
  }
}
