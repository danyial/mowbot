/**
 * Cross-boundary types shared between the Node sidecar (server.mjs + adapter)
 * and the browser client (Plan 03 viewer). No runtime code — types only.
 *
 * Phase 6 — WebUI Container-Logs View
 */

export interface ContainerSummary {
  /** short id (first 12 chars) — used in URLs and list identity */
  id: string;
  /** container name without leading "/" */
  name: string;
  /** full image tag (e.g. "ghcr.io/danyial/mowbot/web:latest") */
  image: string;
  /** dockerode state enum */
  state: "running" | "exited" | "created" | "paused" | "restarting" | "dead";
}

export interface LogFrame {
  /** epoch milliseconds (parsed from Docker's RFC3339 timestamp prefix) */
  ts: number;
  /** which Docker stream this line came from */
  stream: "stdout" | "stderr";
  /** one log line, no trailing "\n"; ANSI escape sequences preserved */
  line: string;
}

export type SincePreset = "1m" | "5m" | "15m" | "1h" | "6h" | "24h";
