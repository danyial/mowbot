/**
 * Thin dockerode wrapper — narrow method allowlist.
 *
 * Security boundary (Phase 6 T-06-05 mitigation):
 *   - Exports EXACTLY: listContainers, getContainer, getEvents.
 *   - getContainer() facade exposes EXACTLY: inspect, logs, modem.
 *     Any other dockerode Container method (start, stop, kill, exec,
 *     remove, update, …) is not reachable from consumer code.
 *
 * The allowlist is enforced at runtime by Wave 0 tests
 * (`web/__tests__/docker-adapter.test.mjs`). Plus the :ro bind mount
 * on /var/run/docker.sock is the UNIX-socket-level boundary; this
 * adapter is defense-in-depth.
 *
 * @module web/lib/server/docker-adapter
 */

import Docker from "dockerode";

/**
 * Compose project label filter. Defaults to the `mowerbot` project set
 * via COMPOSE_PROJECT_NAME in docker-compose.yml. `MOWER_COMPOSE_LABEL`
 * overrides for local testing outside the compose project.
 */
const DEFAULT_PROJECT = process.env.COMPOSE_PROJECT_NAME || "mowerbot";
const LABEL_FILTER =
  process.env.MOWER_COMPOSE_LABEL ||
  `com.docker.compose.project=${DEFAULT_PROJECT}`;

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

/**
 * List containers belonging to the mower Compose project.
 * @returns {Promise<import("@/lib/types/logs").ContainerSummary[]>}
 */
export async function listContainers() {
  const raw = await docker.listContainers({
    all: true,
    filters: { label: [LABEL_FILTER] },
  });
  return raw.map((c) => ({
    id: String(c.Id).slice(0, 12),
    name: (Array.isArray(c.Names) && c.Names[0] ? c.Names[0] : String(c.Id)).replace(/^\//, ""),
    image: c.Image,
    state: c.State || "exited",
  }));
}

/**
 * Narrow facade around dockerode.getContainer(). Only `inspect`, `logs`,
 * and `modem` are reachable; all other container methods are hidden.
 *
 * @param {string} id - full or short (12-char) container id
 * @returns {{ inspect: () => Promise<any>, logs: (opts: any) => Promise<NodeJS.ReadableStream>, modem: { demuxStream: Function } }}
 */
export function getContainer(id) {
  const c = docker.getContainer(id);
  return {
    inspect: () => c.inspect(),
    logs: (opts) => c.logs(opts),
    modem: c.modem,
  };
}

/**
 * Subscribe to Docker container lifecycle events (start|die|destroy) for
 * the mower Compose project. Caller owns the reconnect loop — this
 * function resolves the raw Readable once per call. On close/error, the
 * caller should call `getEvents()` again with exponential backoff
 * (500 ms → 5000 ms cap — matches ros-client.ts).
 *
 * @returns {Promise<NodeJS.ReadableStream>}
 */
export async function getEvents() {
  return docker.getEvents({
    filters: {
      type: ["container"],
      event: ["start", "die", "destroy"],
      label: [LABEL_FILTER],
    },
  });
}
