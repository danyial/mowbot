import { NextResponse } from "next/server";
import { listContainers } from "@/lib/server/docker-adapter.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const containers = await listContainers();
    return NextResponse.json(containers, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[logs/containers] GET error:", err);
    return NextResponse.json(
      { error: "Docker nicht erreichbar" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
