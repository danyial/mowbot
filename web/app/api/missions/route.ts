import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { Mission } from "@/lib/types/mission";

const DATA_FILE = path.join(process.cwd(), "data", "missions.json");

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

export async function GET() {
  const missions = await readMissions();
  return NextResponse.json(missions);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const missions = await readMissions();

    const mission: Mission = {
      id: `mission-${Date.now()}`,
      name: body.name || "Neuer Auftrag",
      gardenPolygonId: body.gardenPolygonId || "",
      pattern: body.pattern || "parallel",
      spacing: body.spacing ?? 0.2,
      overlap: body.overlap ?? 0.1,
      speed: body.speed ?? 0.3,
      status: "planned",
      progress: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      pathPoints: body.pathPoints || [],
      completedPoints: [],
      estimatedDuration: body.estimatedDuration || 0,
      estimatedDistance: body.estimatedDistance || 0,
    };

    missions.push(mission);
    await writeMissions(missions);
    return NextResponse.json(mission, { status: 201 });
  } catch {
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
