import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { GardenPolygon } from "@/lib/types/garden";
import { calculatePolygonArea } from "@/lib/utils/formatting";

const DATA_FILE = path.join(process.cwd(), "data", "garden.json");

async function readGarden(): Promise<GardenPolygon | null> {
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return parsed === null ? null : parsed;
  } catch {
    return null;
  }
}

async function writeGarden(garden: GardenPolygon | null) {
  await fs.writeFile(DATA_FILE, JSON.stringify(garden, null, 2), "utf-8");
}

export async function GET() {
  const garden = await readGarden();
  return NextResponse.json(garden);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, points } = body;

    if (!points || !Array.isArray(points) || points.length < 3) {
      return NextResponse.json(
        { error: "Mindestens 3 Punkte erforderlich" },
        { status: 400 }
      );
    }

    const garden: GardenPolygon = {
      id: `garden-${Date.now()}`,
      name: name || "Hauptgarten",
      points,
      area: calculatePolygonArea(points),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await writeGarden(garden);
    return NextResponse.json(garden, { status: 201 });
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
    const existing = await readGarden();

    if (!existing) {
      return NextResponse.json(
        { error: "Kein Gartenpolygon vorhanden" },
        { status: 404 }
      );
    }

    const updated: GardenPolygon = {
      ...existing,
      ...body,
      area: body.points
        ? calculatePolygonArea(body.points)
        : existing.area,
      updatedAt: new Date().toISOString(),
    };

    await writeGarden(updated);
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json(
      { error: "Ungueltige Daten" },
      { status: 400 }
    );
  }
}
