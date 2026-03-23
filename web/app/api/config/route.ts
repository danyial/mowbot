import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "config.json");

async function readConfig(): Promise<Record<string, unknown>> {
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function writeConfig(config: Record<string, unknown>) {
  await fs.writeFile(DATA_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export async function GET() {
  const config = await readConfig();
  return NextResponse.json(config);
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const existing = await readConfig();

    // Deep merge
    const merged = deepMerge(existing, body);
    await writeConfig(merged);
    return NextResponse.json(merged);
  } catch {
    return NextResponse.json(
      { error: "Ungueltige Daten" },
      { status: 400 }
    );
  }
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      output[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else {
      output[key] = source[key];
    }
  }
  return output;
}
