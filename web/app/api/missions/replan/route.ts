import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { Mission } from "@/lib/types/mission";
import type { ZoneCollection } from "@/lib/types/zones";
import { generateMowPath } from "@/lib/mow-planner";

const DATA_FILE = path.join(process.cwd(), "data", "missions.json");
const ZONES_FILE = path.join(process.cwd(), "data", "zones.json");

async function readMissions(): Promise<Mission[]> {
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeMissions(missions: Mission[]) {
  await fs.writeFile(DATA_FILE, JSON.stringify(missions, null, 2), "utf-8");
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
 * POST /api/missions/replan
 * Re-plan a mission with incremented angle.
 * Body: { id: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Mission-ID erforderlich" },
        { status: 400 }
      );
    }

    const missions = await readMissions();
    const idx = missions.findIndex((m) => m.id === id);
    if (idx === -1) {
      return NextResponse.json(
        { error: "Auftrag nicht gefunden" },
        { status: 404 }
      );
    }

    const mission = missions[idx];
    const zones = await readZones();

    // Increment execution count and calculate new angle
    const newExecutionCount = (mission.executionCount || 0) + 1;
    const newAngle =
      ((mission.angle || 0) +
        (mission.angleIncrement || 0) * newExecutionCount) %
      360;

    // Resolve zones
    const zoneIds = mission.zoneIds || ["all"];
    const isAll = zoneIds.length === 1 && zoneIds[0] === "all";
    const allZones = zones.features;

    const mowZones = isAll
      ? allZones.filter(
          (z) =>
            z.geometry.type === "Polygon" &&
            (z.properties.zoneType === "garden" ||
              z.properties.zoneType === "mow")
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
          z.geometry.type === "Polygon" &&
          z.properties.zoneType === "exclusion"
      )
      .map((z) => z.geometry.coordinates as number[][][]);

    // Re-generate path with new angle
    const planResult = generateMowPath({
      zonePolygons: mowPolygons,
      exclusionPolygons,
      spacing: mission.spacing,
      overlap: mission.overlap,
      perimeterPasses: mission.perimeterPasses,
      angle: newAngle,
      speed: mission.speed,
    });

    // Update mission
    missions[idx] = {
      ...mission,
      executionCount: newExecutionCount,
      status: "planned",
      progress: 0,
      startedAt: null,
      completedAt: null,
      completedPoints: [],
      pathPoints: planResult.pathPoints,
      estimatedDistance: planResult.estimatedDistance,
      estimatedDuration: planResult.estimatedDuration,
      turns: planResult.turns,
      perimeterArea: planResult.perimeterArea,
      innerArea: planResult.innerArea,
    };

    await writeMissions(missions);
    return NextResponse.json(missions[idx]);
  } catch (err) {
    console.error("[missions/replan] error:", err);
    return NextResponse.json(
      { error: "Fehler bei Neuplanung" },
      { status: 500 }
    );
  }
}
