"use client";

import { useEffect, useMemo, useState } from "react";
import { useMap } from "react-leaflet";
import { useGpsStore } from "@/lib/store/gps-store";
import { useImuStore } from "@/lib/store/imu-store";
import { ScanCanvas, type ScanProjector } from "@/components/lidar/scan-canvas";

// One meter in latitude degrees at mid-latitudes (sub-km approximation). Good
// enough for overlay scaling — the base map is the ground truth for geo-
// accuracy, and 1 m of scan error at the edge is sub-pixel at typical zooms.
const ONE_METER_LAT_DEG = 1 / 111320;

/**
 * Phase 3 Commit B / VIZ-01, refactored Quick 260414-w8p.
 *
 * Thin wrapper: pulls the robot lat/lng/yaw + Leaflet map anchor, builds a
 * projector closure that maps robot-frame cartesian (meters) to the map's
 * container-pixel coords, and hands it to <ScanCanvas>. All rendering,
 * memoization, stale detection, badge, and legend live in ScanCanvas — so
 * the standalone /lidar page and this overlay share one code path.
 *
 * Mount target is `map.getContainer()` so the canvas layers above tiles but
 * inside Leaflet's managed DOM subtree (Leaflet's resize/zoom events drive a
 * redraw through the projector identity change below).
 */
export function ScanOverlay() {
  const map = useMap();

  // Store <mountTarget> in state so <ScanCanvas>'s effect re-runs once the map
  // container is available (and only once — the ref itself is stable).
  const [mountTarget, setMountTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setMountTarget(map.getContainer());
    return () => setMountTarget(null);
  }, [map]);

  const lat = useGpsStore((s) => s.latitude);
  const lng = useGpsStore((s) => s.longitude);
  const yaw = useImuStore((s) => s.yaw);

  // Bump an epoch whenever Leaflet tells us the view changed, so the projector
  // identity refreshes and <ScanCanvas> re-runs its redraw effect. Without this
  // the canvas would only redraw on new scans, not on pan/zoom.
  const [viewEpoch, setViewEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setViewEpoch((n) => n + 1);
    map.on("resize zoom move", bump);
    return () => {
      map.off("resize zoom move", bump);
    };
  }, [map]);

  // Projector: robot-frame meters → Leaflet container pixels.
  // Memoized so the ScanCanvas redraw effect only fires when the anchor
  // (lat/lng/yaw) or the Leaflet view (viewEpoch) actually changes.
  const projector = useMemo<ScanProjector | undefined>(() => {
    if (lat === null || lng === null) return undefined;
    // Reference viewEpoch so the memo re-keys on Leaflet view changes (the
    // actual projection math reads from `map` directly).
    void viewEpoch;

    const robotPx = map.latLngToContainerPoint([lat, lng]);
    const oneMNorthPx = map.latLngToContainerPoint([
      lat + ONE_METER_LAT_DEG,
      lng,
    ]);
    const pxPerMeter = Math.abs(oneMNorthPx.y - robotPx.y);
    if (!isFinite(pxPerMeter) || pxPerMeter <= 0) return undefined;

    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);

    return (xR, yR) => {
      // Rotate robot-frame → world-frame by yaw, then scale + Y-flip into
      // container pixels anchored at the robot.
      const xW = xR * cy - yR * sy;
      const yW = xR * sy + yR * cy;
      return {
        px: robotPx.x + xW * pxPerMeter,
        py: robotPx.y - yW * pxPerMeter,
      };
    };
  }, [map, lat, lng, yaw, viewEpoch]);

  // Always mount ScanCanvas in anchored mode — even before a GPS fix arrives.
  // Passing `mountTarget` (possibly null, until the map mounts) puts ScanCanvas
  // into anchored mode so it will NOT fall back to the canvas-centered
  // standalone layout over the tiles; when `projector` is undefined the draw
  // effect simply no-ops until a fix arrives.
  return <ScanCanvas projector={projector} mountTarget={mountTarget} />;
}
