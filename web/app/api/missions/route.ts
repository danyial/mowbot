import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { Mission } from "@/lib/types/mission";
import type { ZoneCollection } from "@/lib/types/zones";
import { generateMowPath } from "@/lib/mow-planner";

const DATA_FILE = path.join(process.cwd(), "data", "missions.json");
const ZONES_FILE = path.join(process.cwd(), "data", "zones.json");
const CONFIG_FILE = path.join(process.cwd(), "data", "config.json");

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

async function readEdgeClearance(): Promise<number> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const config = JSON.parse(data);
    const cm = config?.robot?.edgeClearance;
    if (typeof cm === "number" && cm >= 0) return cm / 100; // cm → meters
  } catch {
    // fallback
  }
  return 0.1; // default 10cm = 0.1m
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
 * Resolve zone IDs to polygon coordinates for the planner.
 * If zoneIds is ["all"], uses all garden + mow zones.
 */
function resolveZones(
  zoneCollection: ZoneCollection,
  zoneIds: string[]
): { mowPolygons: number[][][][]; exclusionPolygons: number[][][][] } {
  const isAll = zoneIds.length === 1 && zoneIds[0] === "all";
  const allZones = zoneCollection.features;

  // Mow targets: either specific zones or all garden+mow zones
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

  // Exclusion zones always apply
  const exclusionPolygons = allZones
    .filter(
      (z) =>
        z.geometry.type === "Polygon" && z.properties.zoneType === "exclusion"
    )
    .map((z) => z.geometry.coordinates as number[][][]);

  return { mowPolygons, exclusionPolygons };
}

export async function GET() {
  const missions = await readMissions();
  return NextResponse.json(missions);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const missions = await readMissions();
    const zones = await readZones();
    const edgeClearance = await readEdgeClearance();

    const zoneIds: string[] = body.zoneIds || ["all"];
    const spacing = body.spacing ?? 0.2;
    const overlap = body.overlap ?? 0.1;
    const speed = body.speed ?? 0.3;
    const perimeterPasses = body.perimeterPasses ?? 2;
    const angle = body.angle ?? 0;
    const angleIncrement = body.angleIncrement ?? 45;
    const startPoint: [number, number] | undefined = body.startPoint ?? undefined;

    // Resolve zones to polygons
    const { mowPolygons, exclusionPolygons } = resolveZones(zones, zoneIds);

    // Generate mow path
    const planResult = generateMowPath({
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

    const mission: Mission = {
      id: `mission-${Date.now()}`,
      name: body.name || "Neuer Auftrag",
      zoneIds,
      spacing,
      overlap,
      speed,
      perimeterPasses,
      angle,
      angleIncrement,
      executionCount: 0,
      status: "planned",
      progress: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      pathPoints: planResult.pathPoints,
      completedPoints: [],
      estimatedDuration: planResult.estimatedDuration,
      estimatedDistance: planResult.estimatedDistance,
      turns: planResult.turns,
      perimeterArea: planResult.perimeterArea,
      innerArea: planResult.innerArea,
      startPoint,
      edgeClearance,
    };

    missions.push(mission);
    await writeMissions(missions);
    return NextResponse.json(mission, { status: 201 });
  } catch (err) {
    console.error("[missions] POST error:", err);
    return NextResponse.json(
      { error: "Ungueltige Daten" },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const missions = await readMissions();

    const idx = missions.findIndex((m) => m.id === body.id);
    if (idx === -1) {
      return NextResponse.json(
        { error: "Auftrag nicht gefunden" },
        { status: 404 }
      );
    }

    missions[idx] = { ...missions[idx], ...body };
    await writeMissions(missions);
    return NextResponse.json(missions[idx]);
  } catch {
    return NextResponse.json(
      { error: "Ungueltige Daten" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "ID erforderlich" },
        { status: 400 }
      );
    }

    let missions = await readMissions();
    missions = missions.filter((m) => m.id !== id);
    await writeMissions(missions);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Fehler beim Loeschen" },
      { status: 500 }
    );
  }
}
