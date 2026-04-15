import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_MJS = path.resolve(__dirname, "..", "server.mjs");

test("server.mjs has exactly one server.on('upgrade') listener", () => {
  const src = readFileSync(SERVER_MJS, "utf8");
  const matches = src.match(/server\.on\("upgrade"/g) || [];
  assert.equal(
    matches.length,
    1,
    `Expected exactly 1 server.on("upgrade") listener, found ${matches.length}. ` +
      `A second listener shadows /rosbridge — see CONTEXT.md §Architecture decision 4.`
  );
});

test("server.mjs preserves the /rosbridge branch", () => {
  const src = readFileSync(SERVER_MJS, "utf8");
  assert.ok(
    src.includes('"/rosbridge"'),
    "rosbridge branch removed — v2.1 regression"
  );
});

test("server.mjs adds the /logs/stream/ branch (Plan 02 gate)", () => {
  const src = readFileSync(SERVER_MJS, "utf8");
  assert.ok(
    src.includes("/logs/stream/"),
    "Plan 02 must add the /logs/stream/ branch to the upgrade handler"
  );
});
