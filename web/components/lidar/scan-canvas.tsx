"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { useScanStore } from "@/lib/store/scan-store";
import { useMapStore } from "@/lib/store/map-store";
import { useImuStore } from "@/lib/store/imu-store";
import { callSlamReset } from "@/lib/ros/services";
import { sampleViridis } from "@/lib/viridis";

// ─────────────────────────────────────────────────────────────────────────────
// Shared polar-scan renderer — powers both the map overlay (geo-anchored) and
// the standalone /lidar page (canvas-centered, no GPS).
//
// Quick 260414-w8p. Extracts what used to live inside <ScanOverlay> so the
// /lidar route can reuse the exact same memoization + stale + legend + badge
// behavior without pulling in Leaflet or a GPS fix.
// ─────────────────────────────────────────────────────────────────────────────

// Fallback range bounds if LaserScan.range_min/max are zero or unset.
const RANGE_MIN_FALLBACK_M = 0.0;
const RANGE_MAX_FALLBACK_M = 8.0;

// Stale threshold: 1500 ms ≈ 15 missed scans at 10 Hz.
const STALE_THRESHOLD_MS = 1500;

// Stale-poll cadence — worst-case badge-flip latency is threshold + poll.
const STALE_POLL_MS = 200;

// Standalone layout: put the robot origin at canvas center and fit the sweep
// into ~45% of the shorter canvas dimension so the full range_max is visible
// with a small margin. Matches the spec in the quick brief.
const STANDALONE_FIT_FACTOR = 0.45;

// Standalone-only: LD19's physical returns cluster under ~12 m but the driver
// occasionally reports a bit beyond that. Fit + colorize to 15 m so those
// fringe returns still land on the viridis gradient instead of clamping to
// the max color. Quick 260415-9ww (revised after visual test).
const EFFECTIVE_RANGE_M = 15.0;

// Standalone-only viridis floor: the LUT's index-0 color is RGB(68, 1, 84) —
// near-invisible on the /lidar page's black background. Remap normalized
// distance t ∈ [0, 1] into [VIRIDIS_FLOOR, 1] so near-range points render as
// a clearly visible violet/blue instead of near-black. Anchored mode (on the
// light OSM tile background in /map) still uses the full LUT via viridis.ts.
// Quick 260415-9ww (revised).
const VIRIDIS_FLOOR_STANDALONE = 0.18;

// Standalone zoom/pan clamps. Zoom is a multiplier on the fit-pxPerMeter so
// 1.0 == "fits EFFECTIVE_RANGE_M"; 0.25..64 gives ~8 octaves of navigation —
// at 64× on a 15 m fit that's roughly ~6 cm per screen-pixel, a sensible
// floor given LD19's ~1 cm noise. Quick 260415-9ww.
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 64.0;

// Wheel sensitivity coefficient for the exponential zoom curve:
//   zoom *= exp(-deltaY * WHEEL_ZOOM_K)
// Feels uniform across mouse-wheel notches (deltaY≈100) and trackpad
// continuous scroll (deltaY≈3). Quick 260415-9ww.
const WHEEL_ZOOM_K = 0.0015;

interface ScanCartesian {
  // Flat [x0, y0, r0, x1, y1, r1, ...] in robot frame (meters).
  xyr: Float32Array;
  count: number;
  rmin: number;
  rmax: number;
}

/**
 * A projector maps a robot-frame cartesian point (meters) to container pixels.
 * Returning `null` (or the projection being non-finite) skips the point.
 *
 * In standalone mode the component builds its own projector from the canvas
 * center and `pxPerMeter`. In anchored mode the caller (scan-overlay) supplies
 * a projector that uses Leaflet to map through the current robot lat/lng/yaw.
 */
export type ScanProjector = (
  xMeters: number,
  yMeters: number
) => { px: number; py: number } | null;

/**
 * Phase 4 Plan 04-02 — view transform handed to the standalone `underlay`
 * render-prop. `pxPerMeter` already includes the current viewRef.zoom
 * multiplier so the underlay consumer (MapBitmap) uses IDENTICAL math to
 * the scan projector — zoom/pan "just works" without a shared view-store.
 */
export interface ScanUnderlayTransform {
  pxPerMeter: number;
  panX: number;
  panY: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface ScanCanvasProps {
  /**
   * Anchored mode — when provided, the component mounts its canvas imperatively
   * into `mountTarget` and uses this function for every point. When omitted,
   * the component renders a centered standalone canvas.
   */
  projector?: ScanProjector;

  /**
   * Anchored mode — container the canvas + badge + legend should be appended to
   * (e.g. `map.getContainer()`). Required iff `projector` is provided. The
   * component tracks the container's client size for canvas resize.
   */
  mountTarget?: HTMLElement | null;

  /**
   * Anchored mode — pixels-per-meter at the current map zoom, used only for the
   * legend's implicit scale (projector already bakes in its own scale). May be
   * omitted; unused in the render math.
   */
  pxPerMeter?: number;

  /**
   * Standalone mode — applied to the wrapper `<div>` (e.g. "h-full w-full bg-black").
   */
  className?: string;

  /**
   * Standalone mode only — render function returning JSX to layer UNDER the
   * scan canvas. Called on every redraw with the current view transform.
   * Ignored in anchored (Leaflet) mode — scan-overlay.tsx does not pass this,
   * so `/map` is literally unaffected (no shared view state, no hook changes
   * in the anchored branch). See Plan 04-02 Blocker #1 Option 2.
   */
  underlay?: (t: ScanUnderlayTransform) => React.ReactNode;
}

interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

const IDENTITY_VIEW: ViewTransform = { zoom: 1, panX: 0, panY: 0 };

/**
 * Phase 3 / Quick 260414-w8p.
 *
 * Polar LaserScan canvas — two modes:
 *   • Standalone: renders a full-bleed `<div>` with its own canvas + badge +
 *     legend, origin at canvas center, no GPS required. Used by `/lidar`.
 *   • Anchored:   mounts canvas/badge/legend imperatively into `mountTarget`
 *     (the Leaflet map container) and projects each beam through the supplied
 *     `projector`. Used by `<ScanOverlay>` on `/map`.
 *
 * Performance contract (unchanged from the original overlay):
 *   - Polar→cartesian trig happens ONCE per scan inside a useMemo keyed on the
 *     `latest` scan object identity. NaN / ±Infinity / out-of-range beams are
 *     filtered here so draw() can operate on a dense valid Float32Array.
 *   - draw() does only projection + viridis lookup per point; no per-point trig.
 */
export function ScanCanvas({
  projector,
  mountTarget,
  className,
  underlay,
}: ScanCanvasProps) {
  // Mode is determined by whether the caller supplied a mountTarget (anchored
  // into an external container like Leaflet's map) vs. managing our own
  // wrapper div. Critically: anchored mode does NOT require a projector yet —
  // the canvas still mounts so the /map DOM shape is stable pre-GPS-fix; the
  // draw effect simply no-ops until a projector is supplied.
  const standalone = mountTarget === undefined;

  // Refs to the DOM we manage (differently per mode).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const legendHiRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Standalone-only: view transform lives in a ref so high-frequency wheel/drag
  // updates don't rebuild React trees; a tick counter triggers the draw effect.
  const viewRef = useRef<ViewTransform>({ ...IDENTITY_VIEW });
  const [viewTick, setViewTick] = useState(0);
  const bumpView = () => setViewTick((t) => t + 1);

  // Store selectors.
  const latest = useScanStore((s) => s.latest);
  const isStale = useScanStore((s) => s.isStale);
  // Standalone-only: IMU yaw (deg) drives the robot heading tick. Value is
  // read at draw time from useImuStore so we repaint when it changes.
  const yawDeg = useImuStore((s) => s.yaw);

  // ── Memoized polar→cartesian (NaN-safe, preserves typed-array semantics) ──
  const cartesian = useMemo<ScanCartesian | null>(() => {
    if (!latest) return null;
    const { angle_min, angle_increment, ranges, range_min, range_max } = latest;
    const rmin = range_min > 0 ? range_min : RANGE_MIN_FALLBACK_M;
    const rmax = range_max > 0 ? range_max : RANGE_MAX_FALLBACK_M;

    const n = ranges.length;
    const buf = new Float32Array(n * 3);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const r = ranges[i];
      if (!isFinite(r)) continue; // NaN / Infinity sentinels — per-beam skip
      if (r < rmin || r > rmax) continue;
      const a = angle_min + i * angle_increment;
      buf[count * 3 + 0] = r * Math.cos(a);
      buf[count * 3 + 1] = r * Math.sin(a);
      buf[count * 3 + 2] = r;
      count++;
    }
    return { xyr: buf, count, rmin, rmax };
  }, [latest]);

  // ── Mount DOM (branches on mode) ─────────────────────────────────────────
  useEffect(() => {
    // Anchored mode: mount imperatively into the caller-supplied element.
    // Standalone mode: mount into our own wrapper <div>.
    const host = standalone ? wrapperRef.current : mountTarget ?? null;
    if (!host) return;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.zIndex = "400";
    // Standalone gets interactive canvas (wheel + pointer). Anchored stays
    // click-through so Leaflet owns map interactions.
    canvas.style.pointerEvents = standalone ? "auto" : "none";
    if (standalone) canvas.style.touchAction = "none";
    host.appendChild(canvas);
    canvasRef.current = canvas;

    const badge = document.createElement("div");
    badge.style.cssText = `
      position: absolute; top: 8px; right: 8px; z-index: 500;
      padding: 2px 10px; border-radius: 9999px;
      font-size: 12px; font-weight: 600;
      pointer-events: none;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    badge.textContent = "LIDAR: —";
    host.appendChild(badge);
    badgeRef.current = badge;

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
        // Standalone legend mirrors the draw-loop floor remap so the gradient
        // shown in the legend matches what's actually painted on the canvas.
        // Quick 260415-9ww (revised).
        for (let x = 0; x < 100; x++) {
          const t = x / 99;
          const lutT = standalone
            ? VIRIDIS_FLOOR_STANDALONE + t * (1 - VIRIDIS_FLOOR_STANDALONE)
            : t;
          sampleViridis(lutT, tmp, 0);
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
    host.appendChild(legend);
    legendRef.current = legend;
    legendHiRef.current = hi;

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      canvas.width = w;
      canvas.height = h;
    };
    resize();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => resize());
      ro.observe(host);
    } else {
      window.addEventListener("resize", resize);
    }

    // ── Standalone interactions (wheel zoom + pointer pan) ─────────────────
    // Cleanup tokens captured in closures so unmount can detach.
    type Cleanup = () => void;
    const cleanups: Cleanup[] = [];

    if (standalone && cartesian == null) {
      // cartesian may be null on first mount; the render path also handles the
      // null case, and wheel/pan handlers below still work because they only
      // mutate viewRef (draw reads it lazily). Nothing special needed here.
    }

    if (standalone) {
      // Convert a canvas-local pixel (px,py) into world meters under the
      // current view transform. Inverse of the draw-time projector.
      const canvasToWorld = (
        px: number,
        py: number,
        pxPerMeterBase: number
      ): { xM: number; yM: number } => {
        const w = canvas.width;
        const h = canvas.height;
        const v = viewRef.current;
        const cx = w / 2 + v.panX;
        const cy = h / 2 + v.panY;
        const s = pxPerMeterBase * v.zoom;
        return { xM: (px - cx) / s, yM: -(py - cy) / s };
      };

      // Use the most-recent cartesian to derive base pxPerMeter at wheel-time.
      // We stash a live ref via closure on cartesianRefForHandlers below.
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const w = canvas.width;
        const h = canvas.height;
        // Fit to the EFFECTIVE_RANGE_M floor (LD19's physical 12 m), not the
        // driver-reported range_max which can be 25 m and shrinks everything.
        const rawMax = cartesianRefForHandlers.current?.rmax || RANGE_MAX_FALLBACK_M;
        const effMax = Math.min(EFFECTIVE_RANGE_M, rawMax || EFFECTIVE_RANGE_M);
        const fit = Math.min(w, h) * STANDALONE_FIT_FACTOR;
        const base = fit / (effMax || 1);

        const v = viewRef.current;
        const worldBefore = canvasToWorld(px, py, base);
        // Exponential curve — uniform feel across mouse notches & trackpad.
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_K);
        const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor));
        if (nextZoom === v.zoom) return;

        // Re-anchor pan so the world-point under the cursor stays put.
        const sNew = base * nextZoom;
        const cxNew = w / 2 + v.panX;
        const cyNew = h / 2 + v.panY;
        const pxAfter = cxNew + worldBefore.xM * sNew;
        const pyAfter = cyNew - worldBefore.yM * sNew;
        const dx = px - pxAfter;
        const dy = py - pyAfter;

        viewRef.current = {
          zoom: nextZoom,
          panX: v.panX + dx,
          panY: v.panY + dy,
        };
        bumpView();
      };

      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let activePointerId: number | null = null;

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        dragging = true;
        activePointerId = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!dragging || e.pointerId !== activePointerId) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        const v = viewRef.current;
        viewRef.current = { zoom: v.zoom, panX: v.panX + dx, panY: v.panY + dy };
        bumpView();
      };
      const onPointerUp = (e: PointerEvent) => {
        if (e.pointerId !== activePointerId) return;
        dragging = false;
        activePointerId = null;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // pointer capture may already be released
        }
        canvas.style.cursor = "grab";
      };

      canvas.style.cursor = "grab";
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);

      cleanups.push(() => {
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
      });
    }

    return () => {
      for (const c of cleanups) c();
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
      if (canvas.parentNode === host) host.removeChild(canvas);
      if (badge.parentNode === host) host.removeChild(badge);
      if (legend.parentNode === host) host.removeChild(legend);
      canvasRef.current = null;
      badgeRef.current = null;
      legendRef.current = null;
      legendHiRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone, mountTarget]);

  // Live ref that wheel handlers read — avoids re-binding listeners per scan.
  const cartesianRefForHandlers = useRef<ScanCartesian | null>(null);
  useEffect(() => {
    cartesianRefForHandlers.current = cartesian;
  }, [cartesian]);

  // ── Stale-detector poll (owned here so both modes behave identically) ────
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

  // ── Badge text/color reacts to the stale flag ────────────────────────────
  useEffect(() => {
    const b = badgeRef.current;
    if (!b) return;
    if (isStale) {
      b.textContent = "LIDAR: stale";
      b.style.background = "rgba(239,68,68,0.2)";
      b.style.color = "rgb(248,113,113)";
    } else {
      b.textContent = "LIDAR: live";
      b.style.background = "rgba(34,197,94,0.2)";
      b.style.color = "rgb(74,222,128)";
    }
  }, [isStale]);

  // ── Keep legend's "hi" label in sync with the effective range ────────────
  // In standalone mode we clamp to EFFECTIVE_RANGE_M (12 m physical LD19 max)
  // to match the fit scale. Anchored mode keeps the driver's range_max since
  // its legend is informational only and shouldn't change /map behavior.
  useEffect(() => {
    const hi = legendHiRef.current;
    if (!hi) return;
    const rmaxRaw =
      latest && latest.range_max > 0 ? latest.range_max : RANGE_MAX_FALLBACK_M;
    const rmax = standalone ? Math.min(EFFECTIVE_RANGE_M, rmaxRaw) : rmaxRaw;
    // Show at most one decimal; LD19 effective is 12.0.
    hi.textContent = `${rmax % 1 === 0 ? rmax.toFixed(0) : rmax.toFixed(1)} m`;
  }, [latest, standalone]);

  // ── Redraw on scan memo, projector, or view-transform change ─────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!cartesian) return;

    // Anchored mode with no projector yet (no GPS fix): canvas is mounted but
    // we skip drawing — keeps the DOM shape stable for /map pre-fix without
    // painting a canvas-centered standalone sweep over the tiles.
    if (!standalone && !projector) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!canvasRef.current) {
        rafRef.current = null;
        return;
      }
      drawScan(
        canvasRef.current,
        cartesian,
        projector,
        standalone ? viewRef.current : IDENTITY_VIEW,
        standalone,
        yawDeg
      );
      rafRef.current = null;
    });
  }, [cartesian, projector, standalone, viewTick, yawDeg]);

  // Zoom-control handlers (standalone only).
  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor));
    if (next === v.zoom) return;
    // Zoom around canvas center — pan scales with the origin offset so the
    // center world-point stays put. panNew = panOld * (next/prev).
    const ratio = next / v.zoom;
    viewRef.current = {
      zoom: next,
      panX: v.panX * ratio,
      panY: v.panY * ratio,
    };
    bumpView();
  };
  const resetView = () => {
    viewRef.current = { ...IDENTITY_VIEW };
    bumpView();
  };

  // Plan 04-02: derive the underlay transform each render using the same math
  // as drawScan()'s standalone projector, so MapBitmap composes UNDER scan
  // points with identical scale/pan/zoom. `canvasRef.current` is populated by
  // the DOM-mount effect; on first render it may be null — the underlay simply
  // doesn't render until a tick (no perf issue, same scan-first latency).
  const currentTransform = useMemo<ScanUnderlayTransform | null>(() => {
    if (!standalone) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return null;
    const fit = Math.min(w, h) * STANDALONE_FIT_FACTOR;
    const rawMax = cartesian?.rmax || EFFECTIVE_RANGE_M;
    const effMax = Math.min(EFFECTIVE_RANGE_M, rawMax || EFFECTIVE_RANGE_M);
    const base = fit / (effMax || 1);
    const v = viewRef.current;
    return {
      pxPerMeter: base * v.zoom,
      panX: v.panX,
      panY: v.panY,
      canvasWidth: w,
      canvasHeight: h,
    };
    // viewTick / cartesian / standalone trigger recompute. viewRef.current is
    // mutated in place so viewTick is the actual change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTick, cartesian, standalone]);

  // Anchored mode renders nothing — DOM lives inside the map container.
  if (!standalone) return null;

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{ position: "relative", overflow: "hidden" }}
    >
      {/* Plan 04-02 — standalone-only underlay slot (zIndex 300 < canvas 400).
          /map's scan-overlay never passes `underlay`, so nothing renders here
          in anchored mode. pointerEvents: none so zoom/pan still hit canvas. */}
      {underlay && currentTransform ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 300,
            pointerEvents: "none",
          }}
        >
          {underlay(currentTransform)}
        </div>
      ) : null}

      {/* Plan 04-02 — Reset button (top-left). Clears useMapStore
          optimistically so the bitmap wipes within the P3 2 s assertion
          window even before the next /map publish, then invokes the
          /slam_toolbox/reset service. Does NOT touch viewRef — non-interference
          invariant with ⌂ (P3.1). Moved from bottom-right to top-left to avoid
          overlap with the viridis legend. Quick 260414-fix. */}
      <button
        type="button"
        onClick={async () => {
          // Optimistic clear — removing this breaks P3's "within 2 s"
          // assertion because MapBitmap would wait for the next /map
          // publish (up to map_update_interval = 2 s).
          useMapStore.getState().clear();
          try {
            await callSlamReset();
          } catch (e) {
            console.error("[lidar] /slam_toolbox/reset failed:", e);
          }
        }}
        title="Reset map"
        aria-label="Reset map"
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          zIndex: 600,
          width: 32,
          height: 32,
          borderRadius: 6,
          background: "rgba(0,0,0,0.6)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Eraser size={16} />
      </button>

      {/* Zoom controls — bottom-left, pointer-events enabled so they overlay
          the interactive canvas without the canvas eating the clicks. */}
      <div
        style={{
          position: "absolute",
          left: 8,
          bottom: 8,
          zIndex: 600,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <ZoomBtn label="+" onClick={() => zoomBy(1.25)} title="Zoom in" />
        <ZoomBtn label="−" onClick={() => zoomBy(1 / 1.25)} title="Zoom out" />
        <ZoomBtn label="⌂" onClick={resetView} title="Reset view" />
        {/* Live zoom-level readout — updates via viewTick. Quick 260415-9ww. */}
        <div
          style={{
            width: 32,
            padding: "2px 0",
            borderRadius: 6,
            background: "rgba(0,0,0,0.6)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            fontSize: 11,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            textAlign: "center",
            lineHeight: 1.2,
          }}
          aria-label="current zoom level"
          // viewTick is read via closure; include it to satisfy exhaustive-deps
          // when React re-renders this element after bumpView().
          data-view-tick={viewTick}
        >
          {viewRef.current.zoom.toFixed(1)}×
        </div>
      </div>
    </div>
  );
}

function ZoomBtn({
  label,
  onClick,
  title,
}: {
  label: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        background: "rgba(0,0,0,0.6)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.2)",
        fontSize: 16,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "system-ui, -apple-system, sans-serif",
        lineHeight: 1,
        padding: 0,
      }}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// draw helper — iterates the memoized Float32Array, projects, and viridis-colors.
// Projector path (anchored) delegates to the caller; standalone path builds a
// canvas-centered projector here so pxPerMeter fits the sweep into the canvas,
// then applies the user's zoom/pan transform.
// ─────────────────────────────────────────────────────────────────────────────
function drawScan(
  canvas: HTMLCanvasElement,
  cart: ScanCartesian,
  projector: ScanProjector | undefined,
  view: ViewTransform,
  standalone: boolean,
  yawDeg: number
) {
  // willReadFrequently: Playwright/probe-friendly, also cheap when we don't
  // actually read back. Quick 260414-restore.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  // Standalone background — keep it near-black (page supplies bg; paint a
  // transparent clear so the wrapper's bg-black shows through).
  ctx.clearRect(0, 0, w, h);

  // Build an effective projector.
  let project: ScanProjector;
  if (projector) {
    project = projector;
  } else {
    // Standalone: canvas center is the robot origin; Y-flip so positive Y_robot
    // (left of forward) maps "up" on screen, matching the map overlay convention.
    // Apply user zoom/pan on top of the fit scale so /map is unaffected.
    const cx = w / 2 + view.panX;
    const cy = h / 2 + view.panY;
    const fit = Math.min(w, h) * STANDALONE_FIT_FACTOR;
    // Fit to LD19's physical 12 m range, not the driver-reported 25 m, so the
    // useful sweep fills the canvas by default. Quick 260415-9ww.
    const effMax = Math.min(EFFECTIVE_RANGE_M, cart.rmax || EFFECTIVE_RANGE_M);
    const pxPerMeter = (fit / (effMax || 1)) * view.zoom;
    project = (xM, yM) => ({
      px: cx + xM * pxPerMeter,
      py: cy - yM * pxPerMeter,
    });
  }

  const { xyr, count, rmin, rmax } = cart;
  const rspan = rmax - rmin || 1;
  const rgb = new Uint8ClampedArray(3);

  // Per-point draw size: anchored mode keeps the original 3 px dots.
  // Standalone scales gently with zoom and clamps to [1, 3] — so deep-zoom
  // renders as small dots (not blobs) and default zoom renders as ~2 px dots.
  // Quick 260415-9ww.
  const pointSize = standalone && !projector
    ? Math.max(4, Math.min(9, view.zoom * 0.4))
    : 3;

  // Standalone: draw a 1 px black outline ring around each viridis point so
  // the light-violet floor-remapped near-range dots stay readable against the
  // black page background. Anchored mode skips this (OSM tiles are already
  // bright enough that the viridis color is visible on its own).
  // Quick 260414-restore.
  const drawOutline = standalone && !projector;

  for (let i = 0; i < count; i++) {
    const xR = xyr[i * 3 + 0];
    const yR = xyr[i * 3 + 1];
    const r = xyr[i * 3 + 2];

    const p = project(xR, yR);
    if (!p) continue;
    if (!isFinite(p.px) || !isFinite(p.py)) continue;

    const t = (r - rmin) / rspan;
    // Standalone-only: lift near-range points off the near-black low end of
    // the viridis LUT so they're visible on the /lidar page's black bg.
    // Anchored mode (/map, light OSM tiles) keeps the full gradient.
    // Quick 260415-9ww (revised).
    const lutT =
      standalone && !projector
        ? VIRIDIS_FLOOR_STANDALONE + Math.max(0, Math.min(1, t)) * (1 - VIRIDIS_FLOOR_STANDALONE)
        : t;
    sampleViridis(lutT, rgb, 0);
    if (drawOutline) {
      ctx.fillStyle = "rgb(0, 0, 0)";
      ctx.fillRect(
        p.px - pointSize / 2 - 1,
        p.py - pointSize / 2 - 1,
        pointSize + 2,
        pointSize + 2
      );
    }
    ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    ctx.fillRect(
      p.px - pointSize / 2,
      p.py - pointSize / 2,
      pointSize,
      pointSize
    );
  }

  // Robot marker — standalone only, drawn LAST so it sits on top of scan +
  // map. 8 px filled blue circle with a white 2 px border and a 12 px
  // heading-tick line from center in the +x direction of base_link (IMU
  // yaw). The marker stays at canvas center (the anchor for everything
  // else) — pan shifts it with the world via view.panX/Y.
  // Quick 260414-restore.
  if (standalone && !projector) {
    const w = canvas.width;
    const h = canvas.height;
    const mcx = w / 2 + view.panX;
    const mcy = h / 2 + view.panY;

    // Heading tick. ROS yaw is CCW-positive in the x-forward/y-left body
    // frame; canvas +y is south, so we negate sin to flip the screen y-axis.
    const yawRad = (yawDeg * Math.PI) / 180;
    const tickLen = 12;
    const tx = mcx + Math.cos(yawRad) * tickLen;
    const ty = mcy - Math.sin(yawRad) * tickLen;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mcx, mcy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // Filled blue disc with white border.
    ctx.beginPath();
    ctx.arc(mcx, mcy, 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(59, 130, 246, 0.9)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.stroke();
  }
}
