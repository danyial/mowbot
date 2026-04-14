"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import { useGpsStore } from "@/lib/store/gps-store";
import { useImuStore } from "@/lib/store/imu-store";
import { useScanStore } from "@/lib/store/scan-store";
import { sampleViridis } from "@/lib/viridis";

// One meter in latitude degrees at mid-latitudes (sub-km approximation; see
// RESEARCH P6). Good enough for overlay scaling — the base map is the ground
// truth for geo-accuracy, and 1 m of scan error at the edge is sub-pixel at
// typical dashboard zooms.
const ONE_METER_LAT_DEG = 1 / 111320;

// Fallback range bounds if LaserScan.range_min/max are zero or unset (D-10).
// LD19 publishes 0.0..12.0 m typically; 0..8 m is the useful operating range
// for obstacle viz on a mower and matches the legend labels below.
const RANGE_MIN_FALLBACK_M = 0.0;
const RANGE_MAX_FALLBACK_M = 8.0;

// Per-point draw size (CSS pixels).
const POINT_SIZE_PX = 3;

// Stale threshold per D-09. 1500 ms ≈ 15 missed scans at the driver's 10 Hz
// publish rate — enough slack to absorb one wifi burp without false alarms,
// tight enough to catch a real "/scan stopped" within ~1.5 s.
const STALE_THRESHOLD_MS = 1500;

// Stale-polling interval. 200 ms means worst-case badge-flip latency is
// STALE_THRESHOLD_MS + 200 ms = 1.7 s, well inside the 2.0 s acceptance bound.
const STALE_POLL_MS = 200;

// Structure of the memoized cartesian projection (per D-13).
interface ScanCartesian {
  // Flat [x0, y0, r0, x1, y1, r1, ...] triples in the ROBOT frame (meters).
  // r is preserved so draw() can compute the viridis
  // t = (r - rmin) / rspan without re-reading ranges[].
  xyr: Float32Array;
  count: number; // number of valid triples (xyr.length / 3)
  rmin: number;
  rmax: number;
}

/**
 * Phase 3 Commit B / VIZ-01 / VIZ-03 / VIZ-05.
 *
 * Canvas 2D polar scan overlay. Child of <MapContainer>; renders null.
 * The canvas, badge, and legend are imperatively mounted onto
 * `map.getContainer()` so they layer above the tile layer but inside the
 * Leaflet-managed DOM subtree (so Leaflet's own resize/zoom events drive a
 * redraw reliably).
 *
 * Performance contract (D-13 locked decision):
 *   - Polar→cartesian trig (Math.cos/Math.sin per beam) happens ONCE per scan,
 *     inside a useMemo keyed on the `latest` scan object identity.
 *   - draw() iterates the memoized Float32Array and performs ONLY the
 *     pixels/meter projection, a single 2D yaw rotation (cy/sy computed once
 *     per frame — no trig per point), Y-flip, and viridis color lookup.
 */
export function ScanOverlay() {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Store selectors — subscribed individually so we only re-render when the
  // specific slice we care about changes (Zustand's default shallow compare).
  const latest = useScanStore((s) => s.latest);
  const lat = useGpsStore((s) => s.latitude);
  const lng = useGpsStore((s) => s.longitude);
  const yaw = useImuStore((s) => s.yaw);
  const isStale = useScanStore((s) => s.isStale);

  // ── D-13: memoized polar→cartesian conversion ────────────────────────────
  // Keyed on `latest` object identity. Each new /scan message is a fresh object
  // from the subscribe callback, so identity change == new scan. NaN / ±Infinity
  // / out-of-range beams are filtered here (P7) so draw() can operate on a
  // dense valid buffer with no per-frame isFinite() branching.
  const cartesian = useMemo<ScanCartesian | null>(() => {
    if (!latest) return null;
    const { angle_min, angle_increment, ranges, range_min, range_max } = latest;
    const rmin = range_min > 0 ? range_min : RANGE_MIN_FALLBACK_M;
    const rmax = range_max > 0 ? range_max : RANGE_MAX_FALLBACK_M;

    const n = ranges.length;
    // Over-allocate worst case; trim at the end via `count`.
    const buf = new Float32Array(n * 3);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const r = ranges[i];
      if (!isFinite(r)) continue; // P7: NaN / Infinity sentinels
      if (r < rmin || r > rmax) continue; // out-of-range filter
      const a = angle_min + i * angle_increment;
      buf[count * 3 + 0] = r * Math.cos(a);
      buf[count * 3 + 1] = r * Math.sin(a);
      buf[count * 3 + 2] = r;
      count++;
    }
    return { xyr: buf, count, rmin, rmax };
  }, [latest]);

  // ── Mount canvas + badge + legend into the map container once ────────────
  useEffect(() => {
    const container = map.getContainer();
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.zIndex = "400";
    canvas.style.pointerEvents = "none";
    container.appendChild(canvas);
    canvasRef.current = canvas;

    // Stale badge (shadcn Badge visual language reproduced imperatively; we
    // can't render JSX into an imperatively-created parent without a portal).
    const badge = document.createElement("div");
    badge.style.cssText = `
      position: absolute; top: 8px; right: 8px; z-index: 500;
      padding: 2px 10px; border-radius: 9999px;
      font-size: 12px; font-weight: 600;
      pointer-events: none;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    badge.textContent = "LIDAR: —";
    container.appendChild(badge);
    badgeRef.current = badge;

    // Color-bar legend (D-11: bottom-right, 0 m → 8 m).
    const legend = document.createElement("div");
    legend.style.cssText = `
      position: absolute; bottom: 8px; right: 8px; z-index: 500;
      padding: 4px 8px; border-radius: 6px;
      background: rgba(0,0,0,0.5); color: #fff;
      font-size: 11px; font-family: system-ui, -apple-system, sans-serif;
      pointer-events: none; display: flex; align-items: center; gap: 6px;
    `;
    const bar = document.createElement("canvas");
    bar.width = 100;
    bar.height = 8;
    {
      const bctx = bar.getContext("2d");
      if (bctx) {
        const img = bctx.createImageData(100, 8);
        const tmp = new Uint8ClampedArray(3);
        for (let x = 0; x < 100; x++) {
          sampleViridis(x / 99, tmp, 0);
          for (let y = 0; y < 8; y++) {
            const o = (y * 100 + x) * 4;
            img.data[o] = tmp[0];
            img.data[o + 1] = tmp[1];
            img.data[o + 2] = tmp[2];
            img.data[o + 3] = 255;
          }
        }
        bctx.putImageData(img, 0, 0);
      }
    }
    const lo = document.createElement("span");
    lo.textContent = "0 m";
    const hi = document.createElement("span");
    hi.textContent = `${RANGE_MAX_FALLBACK_M} m`;
    legend.appendChild(lo);
    legend.appendChild(bar);
    legend.appendChild(hi);
    container.appendChild(legend);
    legendRef.current = legend;

    const resize = () => {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
    };
    resize();
    map.on("resize zoom move", resize);

    return () => {
      map.off("resize zoom move", resize);
      if (canvas.parentNode === container) container.removeChild(canvas);
      if (badge.parentNode === container) container.removeChild(badge);
      if (legend.parentNode === container) container.removeChild(legend);
      canvasRef.current = null;
      badgeRef.current = null;
      legendRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [map]);

  // ── Stale-detector interval (D-09) ───────────────────────────────────────
  // Polls every STALE_POLL_MS; flips the store's isStale flag when
  // lastMessageAt is null OR older than STALE_THRESHOLD_MS. Stored in Zustand
  // (not local state) so the badge's own effect below picks it up via the
  // `isStale` selector.
  useEffect(() => {
    const id = setInterval(() => {
      const s = useScanStore.getState();
      const stale =
        s.lastMessageAt === null ||
        Date.now() - s.lastMessageAt > STALE_THRESHOLD_MS;
      if (stale !== s.isStale) s.setStale(stale);
    }, STALE_POLL_MS);
    return () => clearInterval(id);
  }, []);

  // ── Badge text / color — reacts to isStale selector above ────────────────
  useEffect(() => {
    const b = badgeRef.current;
    if (!b) return;
    if (isStale) {
      // mirrors shadcn Badge variant="error"
      b.textContent = "LIDAR: stale";
      b.style.background = "rgba(239,68,68,0.2)";
      b.style.color = "rgb(248,113,113)";
    } else {
      // mirrors shadcn Badge variant="success"
      b.textContent = "LIDAR: live";
      b.style.background = "rgba(34,197,94,0.2)";
      b.style.color = "rgb(74,222,128)";
    }
  }, [isStale]);

  // ── Redraw when scan (memo), pose, or map pose changes ────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    if (lat === null || lng === null) return; // D-05: no fallback; wait for GPS fix
    if (!cartesian) return;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (canvasRef.current) {
        draw(canvasRef.current, map, cartesian, lat, lng, yaw);
      }
      rafRef.current = null;
    });
  }, [cartesian, lat, lng, yaw, map]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing helper — iterate memoized cartesian Float32Array, project to canvas
// pixels (pixels/meter × yaw rotation × Y-flip), viridis-color.
//
// NO polar-trig on ranges here — that happened once inside useMemo. The only
// trig in this function is the two calls used to build the yaw rotation matrix
// (cy, sy), which are reused for every point in the sweep.
// ─────────────────────────────────────────────────────────────────────────────
function draw(
  canvas: HTMLCanvasElement,
  map: import("leaflet").Map,
  cart: ScanCartesian,
  lat: number,
  lng: number,
  yawRad: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Anchor: project robot lat/lng to pixel coords, plus 1 m north to derive
  // pixels-per-meter at the current zoom (Leaflet handles the Mercator math).
  const robotPx = map.latLngToContainerPoint([lat, lng]);
  const oneMNorthPx = map.latLngToContainerPoint([lat + ONE_METER_LAT_DEG, lng]);
  const pxPerMeter = Math.abs(oneMNorthPx.y - robotPx.y);
  if (!isFinite(pxPerMeter) || pxPerMeter <= 0) return;

  // Yaw rotation matrix — two trig calls for the whole frame, not per point.
  const cy = Math.cos(yawRad);
  const sy = Math.sin(yawRad);

  const { xyr, count, rmin, rmax } = cart;
  const rspan = rmax - rmin || 1;
  const rgb = new Uint8ClampedArray(3);

  for (let i = 0; i < count; i++) {
    const xR = xyr[i * 3 + 0];
    const yR = xyr[i * 3 + 1];
    const r = xyr[i * 3 + 2];

    // Rotate robot-frame → world-frame by yaw (single 2D matmul, no trig per point).
    const xW = xR * cy - yR * sy;
    const yW = xR * sy + yR * cy;

    const px = robotPx.x + xW * pxPerMeter;
    const py = robotPx.y - yW * pxPerMeter; // Y-flip (P1): canvas y grows down

    const t = (r - rmin) / rspan;
    sampleViridis(t, rgb, 0);
    ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    ctx.fillRect(
      px - POINT_SIZE_PX / 2,
      py - POINT_SIZE_PX / 2,
      POINT_SIZE_PX,
      POINT_SIZE_PX
    );
  }
}
