"use client";

import dynamic from "next/dynamic";
import type { ScanUnderlayTransform } from "@/components/lidar/scan-canvas";

// Dynamic import with SSR off — <ScanCanvas> reaches for `document` and
// `ResizeObserver` during mount. Mirrors how `/map` imports <RobotMap>.
const ScanCanvas = dynamic(
  () =>
    import("@/components/lidar/scan-canvas").then((m) => ({
      default: m.ScanCanvas,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-black flex items-center justify-center">
        <span className="text-muted-foreground text-sm">
          LiDAR wird geladen...
        </span>
      </div>
    ),
  }
);

// Plan 04-02 (MAP-04) — OccupancyGrid bitmap, mounted as the underlay child
// of ScanCanvas so it composes UNDER the polar scan points with identical
// view transform (zoom/pan/reset-view all "just work").
const MapBitmap = dynamic(
  () =>
    import("@/components/lidar/map-bitmap").then((m) => ({
      default: m.MapBitmap,
    })),
  { ssr: false }
);

/**
 * Quick 260414-w8p / Phase 4 Plan 04-02.
 *
 * Standalone LiDAR view: the polar /scan sweep centered on a fixed origin,
 * layered OVER a live slam_toolbox OccupancyGrid bitmap. Reset button
 * (bottom-right) wipes the map via /slam_toolbox/reset. No Leaflet, no GPS
 * requirement. Useful indoors when the mower has no fix but the sensor stack
 * is live.
 */
export default function LidarPage() {
  return (
    <ScanCanvas
      className="h-full w-full bg-black"
      underlay={(t: ScanUnderlayTransform) => <MapBitmap transform={t} />}
    />
  );
}
