"use client";

import { Polyline } from "react-leaflet";
import { useGpsStore } from "@/lib/store/gps-store";
import { pointsToLatLngs } from "@/lib/utils/coordinates";

export function TrackLayer() {
  const track = useGpsStore((s) => s.track);

  if (track.length < 2) return null;

  return (
    <Polyline
      positions={pointsToLatLngs(track)}
      pathOptions={{
        color: "#6b7280",
        weight: 2,
        opacity: 0.7,
      }}
    />
  );
}
