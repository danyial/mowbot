"use client";

import { useEffect, useRef } from "react";
import { useMapStore } from "@/lib/store/map-store";
import { useImuStore } from "@/lib/store/imu-store";
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
  // Quick fix (2026-04-14): render map-frame bitmap in base_link frame so it
  // aligns with the scan (which is drawn unrotated in laser_frame ≈ base_link).
  // v0 approximation: robot_yaw_in_map ≈ IMU yaw. Live TF probe on 260414
  // confirmed `map→odom` is identity while EKF is IMU-only and stationary
  // (`z=8e-17, w=1.0`), so `odom→base_link` yaw ≈ `map→base_link` yaw.
  // When the mower starts moving (or slam_toolbox corrects `map→odom`), a v1
  // follow-up should subscribe to /tf and use the composed `map→base_link`
  // transform directly. Until then, this Option B rotation keeps map and scan
  // locked together around the robot (canvas center).
  const yawDeg = useImuStore((s) => s.yaw);

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
    // Nav2/rviz-style greyscale colormap:
    //   v < 0 unknown  -> RGB 96 (alpha 180 so it dims against black bg)
    //   v == 0 free    -> RGB 240
    //   v >= 65 occ    -> RGB 20
    //   middle         -> linear ramp ~200 - v*1.8
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      let r = 96,
        g = 96,
        b = 96,
        a = 255;
      if (v < 0) {
        r = g = b = 96;
        a = 180;
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

    const ctx = canvas.getContext("2d");
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

    // v0 base_link-frame render: rotate the whole map around the canvas center
    // (which is where the robot is drawn by ScanCanvas) by -yaw, so the map
    // spins as the IMU yaw drifts while scan stays facing "up-right" (laser
    // +x = canvas +x) — keeping the two visually locked on a stationary mower.
    // Negated because canvas +y is south: a ROS-CCW yaw rotates the world
    // clockwise on screen if we want the map's frame to follow base_link.
    const yawRad = (yawDeg * Math.PI) / 180;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-yawRad);
    ctx.translate(-cx, -cy);
    ctx.drawImage(backing, dx, dy, dw, dh);
    ctx.restore();
  }, [latest, transform, yawDeg]);

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
