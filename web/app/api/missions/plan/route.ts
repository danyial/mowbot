import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { ZoneCollection } from "@/lib/types/zones";
import { generateMowPath } from "@/lib/mow-planner";

const ZONES_FILE = path.join(process.cwd(), "data", "zones.json");
const CONFIG_FILE = path.join(process.cwd(), "data", "config.json");

async function readRobotConfig(): Promise<{
  edgeClearance: number;
  robotWidth: number;
  dockExitDistance: number;
}> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const config = JSON.parse(data);
    const ec = config?.robot?.edgeClearance;
    const rw = config?.robot?.robotWidth;
    const ded = config?.robot?.dockExitDistance;
    return {
      edgeClearance: (typeof ec === "number" && ec >= 0) ? ec / 100 : 0.1,
      robotWidth: (typeof rw === "number" && rw > 0) ? rw / 100 : 0.35,
      dockExitDistance: (typeof ded === "number" && ded > 0) ? ded / 100 : 1.5,
    };
  } catch {
    return { edgeClearance: 0.1, robotWidth: 0.35, dockExitDistance: 1.5 };
  }
}

function extractDockPath(zones: import("@/lib/types/zones").ZoneCollection): [number, number][] | undefined {
  const dockPathZone = zones.features.find(
    (z) => z.properties.zoneType === "dockPath" && z.geometry.type === "LineString"
  );
  if (!dockPathZone) return undefined;
  const coords = dockPathZone.geometry.coordinates as number[][];
  if (coords.length < 2) return undefined;
  return coords.map(([lon, lat]) => [lat, lon] as [number, number]);
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
    const { edgeClearance, robotWidth, dockExitDistance } = await readRobotConfig();
    const dockPath = extractDockPath(zones);

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
      robotWidth,
      dockPath,
      dockExitDistance,
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
