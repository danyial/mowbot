import { test } from "node:test";
import assert from "node:assert/strict";

test("docker-adapter exports ONLY listContainers, getContainer, getEvents (allowlist)", async () => {
  // Import path after Plan 02 lands. Until then this throws ENOENT → RED → correct.
  const mod = await import("../lib/server/docker-adapter.js");
  const keys = new Set(Object.keys(mod));
  assert.deepEqual(
    keys,
    new Set(["listContainers", "getContainer", "getEvents"]),
    `docker-adapter exports must match the allowlist exactly. Found: ${[...keys].join(", ")}`
  );
});

test("getContainer facade exposes ONLY inspect, logs, modem", async () => {
  const mod = await import("../lib/server/docker-adapter.js");
  const facade = mod.getContainer("fake-id");
  const keys = Object.keys(facade).sort();
  assert.deepEqual(
    keys,
    ["inspect", "logs", "modem"],
    `getContainer facade must expose only {inspect, logs, modem}. Found: ${keys.join(", ")}`
  );
});
