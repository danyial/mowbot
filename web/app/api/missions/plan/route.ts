import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { ZoneCollection } from "@/lib/types/zones";
import { generateMowPath } from "@/lib/mow-planner";

const ZONES_FILE = path.join(process.cwd(), "data", "zones.json");
const CONFIG_FILE = path.join(process.cwd(), "data", "config.json");

async function readEdgeClearance(): Promise<number> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const config = JSON.parse(data);
    const cm = config?.robot?.edgeClearance;
    if (typeof cm === "number" && cm >= 0) return cm / 100;
  } catch {
    // fallback
  }
  return 0.1;
}

async function readZones(): Promise<ZoneCollection> {
  try {
    const data = await fs.readFile(ZONES_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

/**
 * POST /api/missions/plan
 * Preview endpoint — calculates a mow path without saving.
 * Returns { pathPoints, estimatedDistance, estimatedDuration }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const zones = await readZones();
    const edgeClearance = await readEdgeClearance();

    const zoneIds: string[] = body.zoneIds || ["all"];
    const spacing = body.spacing ?? 0.2;
    const overlap = body.overlap ?? 0.1;
    const speed = body.speed ?? 0.3;
    const perimeterPasses = body.perimeterPasses ?? 2;
    const angle = body.angle ?? 0;
    const startPoint: [number, number] | undefined = body.startPoint ?? undefined;

    const isAll = zoneIds.length === 1 && zoneIds[0] === "all";
    const allZones = zones.features;

    const mowZones = isAll
      ? allZones.filter(
          (z) =>
            z.geometry.type === "Polygon" &&
            (z.properties.zoneType === "garden" || z.properties.zoneType === "mow")
        )
      : allZones.filter(
          (z) => z.geometry.type === "Polygon" && zoneIds.includes(z.id)
        );

    const mowPolygons = mowZones.map(
      (z) => z.geometry.coordinates as number[][][]
    );

    const exclusionPolygons = allZones
      .filter(
        (z) =>
          z.geometry.type === "Polygon" && z.properties.zoneType === "exclusion"
      )
      .map((z) => z.geometry.coordinates as number[][][]);

    const result = generateMowPath({
      zonePolygons: mowPolygons,
      exclusionPolygons,
      spacing,
      overlap,
      perimeterPasses,
      angle,
      speed,
      startPoint,
      edgeClearance,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[missions/plan] error:", err);
    return NextResponse.json(
      { error: "Planungsfehler" },
      { status: 500 }
    );
  }
}
