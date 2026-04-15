"use client";

import { useEffect, useRef } from "react";
import { useMapStore } from "@/lib/store/map-store";
import type { ScanUnderlayTransform } from "@/components/lidar/scan-canvas";

export interface MapBitmapProps {
  transform: ScanUnderlayTransform;
}

/**
 * Phase 4 Plan 04-02 (MAP-04).
 *
 * OccupancyGrid bitmap renderer, composed as the `underlay` child of
 * <ScanCanvas> on the standalone /lidar route. Receives the view transform
 * as a prop on every redraw — NO shared view-store, NO coupling to /map's
 * anchored ScanCanvas branch.
 *
 * Rendering strategy (see 04-RESEARCH §Canvas):
 *   - Offscreen "backing" canvas sized info.width × info.height cells.
 *     putImageData() runs ONCE per new useMapStore.latest identity (~1 Hz).
 *   - Visible canvas fills the parent slot; drawImage(backing, ...) runs
 *     every transform prop change. At 10 Hz scan × modest grid sizes
 *     (~200-800 cells per side) this is cheap GPU work.
 *
 * v0 anchor limitation (Flag G — documented in Plan 04-02): this component
 * renders the map-frame OccupancyGrid anchored at `info.origin.position`,
 * with the robot assumed near the map-frame origin (true immediately
 * post-/slam_toolbox/reset). Once the mower moves, scan (base_link frame)
 * and bitmap (map frame) will drift apart — tracking robot-in-map via
 * /tf or /odometry/filtered is a v1 follow-up. Under SC#4 (stationary
 * verification) and P1 (freshly-reset map) this is invisible.
 */
export function MapBitmap({ transform }: MapBitmapProps) {
  const visibleRef = useRef<HTMLCanvasElement | null>(null);
  const backingRef = useRef<HTMLCanvasElement | null>(null);
  const latest = useMapStore((s) => s.latest);
  // Quick fix (2026-04-14, revised): render map in MAP frame (north-up, fixed).
  // Prior attempt rotated the bitmap by -IMU yaw around canvas center to fake
  // a base_link-frame view, but the anchor math in drawImage uses
  // `info.origin.position` offset from canvas center — that assumes the robot
  // sits AT the map origin, which is only true immediately post-reset. Adding
  // rotation on top of an already-wrong anchor just spun a misplaced bitmap
  // around the wrong pivot (Playwright probe 260414 confirmed grey "unknown"
  // box drifted 85 px from scan centroid). Simplified approach: both scan and
  // map live in the world/map frame, north-up, with the robot at canvas
  // center. Scan will "spin" around the robot as it turns — bird's-eye UX,
  // more useful for mapping than first-person.

  // Repaint backing on new OccupancyGrid identity (the expensive O(W*H) step).
  useEffect(() => {
    if (!latest) {
      backingRef.current = null;
      return;
    }
    const { info, data } = latest;
    if (info.width <= 0 || info.height <= 0) return;
    if (data.length !== info.width * info.height) {
      console.warn(
        "[map-bitmap] data length mismatch",
        data.length,
        info.width * info.height
      );
      return;
    }

    let backing = backingRef.current;
    if (
      !backing ||
      backing.width !== info.width ||
      backing.height !== info.height
    ) {
      backing = document.createElement("canvas");
      backing.width = info.width;
      backing.height = info.height;
      backingRef.current = backing;
    }
    const bctx = backing.getContext("2d");
    if (!bctx) return;

    const img = bctx.createImageData(info.width, info.height);
    // Nav2/rviz-style greyscale colormap — unknown cells now FULLY TRANSPARENT
    // so the page's black background shows through (no more grey rectangular
    // "box" overwhelming the scan). Free/occupied cells stay opaque.
    //   v < 0 unknown  -> alpha 0 (invisible)
    //   v == 0 free    -> RGB 240 (light)
    //   v >= 65 occ    -> RGB 20  (dark)
    //   middle         -> linear ramp ~200 - v*1.8
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      let r = 96,
        g = 96,
        b = 96,
        a = 255;
      if (v < 0) {
        r = g = b = 0;
        a = 0;
      } else if (v === 0) {
        r = g = b = 240;
      } else if (v >= 65) {
        r = g = b = 20;
      } else {
        const k = Math.round(200 - v * 1.8);
        r = g = b = k;
      }
      const o = i * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = a;
    }
    bctx.putImageData(img, 0, 0);
  }, [latest]);

  // Composite backing -> visible on every transform prop change OR new map.
  useEffect(() => {
    const canvas = visibleRef.current;
    if (!canvas) return;

    // Keep visible canvas sized to the parent slot (ScanCanvas owns the
    // ResizeObserver and hands us its current canvas dims each render).
    if (canvas.width !== transform.canvasWidth)
      canvas.width = transform.canvasWidth;
    if (canvas.height !== transform.canvasHeight)
      canvas.height = transform.canvasHeight;

    // willReadFrequently silences the Playwright/Chromium warning we hit when
    // probes call getImageData() on this canvas. Small perf polish.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const backing = backingRef.current;
    if (!backing || !latest) return;

    const { info } = latest;
    const { pxPerMeter, panX, panY, canvasWidth, canvasHeight } = transform;
    const cx = canvasWidth / 2 + panX;
    const cy = canvasHeight / 2 + panY;
    const cellPx = info.resolution * pxPerMeter;
    const dw = info.width * cellPx;
    const dh = info.height * cellPx;

    // Flip Y: ROS +y north vs canvas +y south. The backing bitmap has row 0
    // at the bottom of the map (cell index 0 = origin), so drawing it in
    // canvas space requires anchoring at (origin.x, origin.y + h) then
    // letting canvas's +y-south render the image as-is.
    const dx = cx + info.origin.position.x * pxPerMeter;
    const dy = cy - (info.origin.position.y * pxPerMeter + dh);

    // Map-frame render (no rotation). Scan (also drawn unrotated by
    // ScanCanvas) lives in laser_frame = base_link ≈ map frame for a freshly
    // reset SLAM map with the robot near the map origin. Both render
    // north-up, world-fixed — the robot marker (drawn by ScanCanvas) is the
    // anchor at canvas center.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(backing, dx, dy, dw, dh);
  }, [latest, transform]);

  return (
    <canvas
      ref={visibleRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}
