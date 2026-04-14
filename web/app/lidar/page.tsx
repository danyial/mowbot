"use client";

import dynamic from "next/dynamic";

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

/**
 * Quick 260414-w8p.
 *
 * Standalone LiDAR view: no Leaflet, no GPS requirement, just the polar /scan
 * sweep centered on a fixed origin. Useful indoors when the mower has no fix
 * but the sensor stack is live.
 */
export default function LidarPage() {
  return (
    <div className="h-full w-full bg-black">
      <ScanCanvas className="h-full w-full bg-black" />
    </div>
  );
}
