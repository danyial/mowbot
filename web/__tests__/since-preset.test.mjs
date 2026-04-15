import { test } from "node:test";
import assert from "node:assert/strict";

const PRESETS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
};

test("parseSincePreset returns now - <seconds> for every declared preset", async () => {
  const { parseSincePreset } = await import("../lib/server/since-preset.js");
  for (const [preset, seconds] of Object.entries(PRESETS)) {
    const now = Math.floor(Date.now() / 1000);
    const got = parseSincePreset(preset);
    assert.ok(
      Math.abs(got - (now - seconds)) <= 1,
      `parseSincePreset(${preset}) expected within ±1 of ${now - seconds}, got ${got}`
    );
  }
});

test("parseSincePreset(null) returns null (no-filter passthrough)", async () => {
  const { parseSincePreset } = await import("../lib/server/since-preset.js");
  assert.equal(parseSincePreset(null), null);
});

test("parseSincePreset('bogus') returns null (graceful unknown)", async () => {
  const { parseSincePreset } = await import("../lib/server/since-preset.js");
  assert.equal(parseSincePreset("bogus"), null);
});
