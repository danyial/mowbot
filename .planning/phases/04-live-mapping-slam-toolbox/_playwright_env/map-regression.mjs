// Phase 4 Plan 04-02 Task 5a — /map regression sentinel (Blocker #1 guard).
// Headless Chromium via Playwright. Asserts the anchored Leaflet /map route
// is visually + structurally unchanged after the /lidar underlay work.
import { chromium } from "playwright";

const URL_MAP = "http://10.10.40.23:3000/map";
const URL_LIDAR = "http://10.10.40.23:3000/lidar";

let failed = 0;
const log = (tag, msg) => console.log(`[${tag}] ${msg}`);
const pass = (name) => log("PASS", name);
const fail = (name, err) => {
  failed++;
  log("FAIL", `${name}: ${err}`);
};

const browser = await chromium.launch({ channel: undefined });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const consoleErrors = [];
const consoleWarns = [];
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") consoleErrors.push(m.text());
  else if (t === "warning") consoleWarns.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  await page.goto(URL_MAP, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Wait for Leaflet container
  await page.waitForSelector(".leaflet-container", { timeout: 15000 });
  pass("A1: .leaflet-container mounted");

  // Give scan-overlay time to mount canvas imperatively
  await page.waitForTimeout(3500);

  const canvasInfo = await page.evaluate(() => {
    const canvases = Array.from(
      document.querySelectorAll(".leaflet-container canvas")
    );
    return canvases.map((c) => ({
      width: c.width,
      height: c.height,
      classList: Array.from(c.classList),
    }));
  });
  log("INFO", `canvases inside .leaflet-container: ${JSON.stringify(canvasInfo)}`);

  const count = canvasInfo.length;
  if (count >= 2 && count <= 3) {
    pass(`A2: canvas count inside .leaflet-container is ${count} (expected 2-3)`);
  } else {
    fail("A2", `canvas count ${count}, expected 2-3 (MapBitmap leak?)`);
  }

  // MapBitmap's visible canvas has 100% width/height of its slot. In anchored
  // mode no slot exists because scan-overlay never passes `underlay`. Sanity-check:
  // none of /map's canvases should have pointer-events: none + position absolute
  // + inset 0 WITH an alpha-180 unknown pixel pattern. We just check canvas count.

  if (consoleErrors.length > 0) {
    fail("A3", `console errors: ${JSON.stringify(consoleErrors)}`);
  } else {
    pass(`A3: no console errors (${consoleWarns.length} warns, acceptable)`);
  }

  // Also cross-check: /lidar should have MapBitmap canvas (2 canvases: MapBitmap + ScanCanvas).
  const consoleErrors2 = [];
  page.removeAllListeners("console");
  page.removeAllListeners("pageerror");
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors2.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors2.push(`pageerror: ${e.message}`));

  await page.goto(URL_LIDAR, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  const lidarCanvasInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("canvas")).map((c) => ({
      width: c.width,
      height: c.height,
      inlineStyle: c.getAttribute("style") || "",
    }));
  });
  log("INFO", `/lidar canvases: ${JSON.stringify(lidarCanvasInfo)}`);

  // Expect at least 2 canvases visible on /lidar (MapBitmap + ScanCanvas primary)
  // plus possibly the legend-bar canvas. 2-4 is acceptable.
  if (lidarCanvasInfo.length >= 2 && lidarCanvasInfo.length <= 4) {
    pass(`A4: /lidar has ${lidarCanvasInfo.length} canvases (expected 2-4; MapBitmap + ScanCanvas + legend-bar)`);
  } else {
    fail("A4", `/lidar canvas count ${lidarCanvasInfo.length}, expected 2-4`);
  }

  if (consoleErrors2.length > 0) {
    fail("A5", `/lidar console errors: ${JSON.stringify(consoleErrors2)}`);
  } else {
    pass("A5: /lidar no console errors");
  }

  // Eraser button present
  const eraserCount = await page
    .locator('button[aria-label="Reset map"]')
    .count();
  if (eraserCount === 1) {
    pass("A6: Eraser/Reset map button present on /lidar");
  } else {
    fail("A6", `expected 1 Reset map button, got ${eraserCount}`);
  }
} catch (e) {
  fail("EXCEPTION", e?.stack || String(e));
} finally {
  await browser.close();
}

if (failed > 0) {
  console.log(`\nFAIL: ${failed} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("\nPASS: all regression assertions passed");
  process.exit(0);
}
