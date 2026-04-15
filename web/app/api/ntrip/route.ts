import { NextResponse } from "next/server";
import { promises as fs } from "fs";

const NTRIP_ENV_PATH =
  process.env.NTRIP_ENV_PATH || "/app/config/ntrip.env";

interface NtripConfig {
  host: string;
  port: number;
  mountpoint: string;
  username: string;
  password: string;
}

/**
 * Validate an env value — reject newlines, control chars
 */
function sanitizeEnvValue(value: string, fieldName: string): string {
  const s = String(value).trim();
  if (!s) throw new Error(`${fieldName} darf nicht leer sein`);
  if (/[\n\r\0]/.test(s))
    throw new Error(`${fieldName} enthaelt ungueltige Zeichen`);
  return s;
}

/**
 * Parse a .env file into a key-value object
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Convert env vars to NtripConfig
 */
function envToConfig(env: Record<string, string>): NtripConfig {
  // Parse host and port from NTRIP_HOST (might include port)
  const hostRaw = env.NTRIP_HOST || "";
  let host = hostRaw;
  let port = parseInt(env.NTRIP_PORT || "2101", 10);

  // If host contains a colon, extract port
  if (hostRaw.includes(":")) {
    const parts = hostRaw.split(":");
    host = parts[0];
    port = parseInt(parts[1], 10) || port;
  }

  return {
    host,
    port,
    mountpoint: env.NTRIP_MOUNT || "",
    username: env.NTRIP_USER || "",
    password: env.NTRIP_PASS || "",
  };
}

/**
 * Convert NtripConfig to .env file content
 */
function configToEnv(config: NtripConfig): string {
  return [
    `NTRIP_USER=${config.username}`,
    `NTRIP_PASS=${config.password}`,
    `NTRIP_HOST=${config.host}`,
    `NTRIP_PORT=${config.port}`,
    `NTRIP_MOUNT=${config.mountpoint}`,
    "",
  ].join("\n");
}

/**
 * GET /api/ntrip — Read current NTRIP configuration
 */
export async function GET() {
  try {
    const content = await fs.readFile(NTRIP_ENV_PATH, "utf-8");
    const env = parseEnvFile(content);
    const config = envToConfig(env);
    return NextResponse.json(config);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // File doesn't exist yet — return defaults
      return NextResponse.json({
        host: "",
        port: 2101,
        mountpoint: "",
        username: "",
        password: "",
      });
    }
    return NextResponse.json(
      { error: "Fehler beim Lesen der NTRIP-Konfiguration" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/ntrip — Update NTRIP configuration and restart the Docker container
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();

    // Validate all fields
    const safeHost = sanitizeEnvValue(body.host || "", "NTRIP_HOST");
    const safePort = body.port
      ? sanitizeEnvValue(String(body.port), "NTRIP_PORT")
      : "2101";
    const safeMount = sanitizeEnvValue(
      body.mountpoint || "",
      "NTRIP_MOUNT"
    );
    const safeUser = sanitizeEnvValue(body.username || "", "NTRIP_USER");
    const safePass = sanitizeEnvValue(body.password || "", "NTRIP_PASS");

    // Port must be numeric
    if (!/^\d+$/.test(safePort)) {
      return NextResponse.json(
        { error: "NTRIP_PORT muss eine Zahl sein" },
        { status: 400 }
      );
    }

    const config: NtripConfig = {
      host: safeHost,
      port: parseInt(safePort, 10),
      mountpoint: safeMount,
      username: safeUser,
      password: safePass,
    };

    // Write the .env file. The ntrip container watches this file via
    // inotifywait on /config/ntrip.env and restarts str2str with the new
    // values automatically — no docker.sock access or explicit restart
    // call needed from the web container.
    const envContent = configToEnv(config);
    await fs.writeFile(NTRIP_ENV_PATH, envContent, "utf-8");

    return NextResponse.json({
      success: true,
      serviceRestarted: true,
      config,
    });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json(
      { error: msg },
      { status: 400 }
    );
  }
}
