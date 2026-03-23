"use client";

import { Polygon, CircleMarker } from "react-leaflet";
import { useGpsStore } from "@/lib/store/gps-store";
import { pointsToLatLngs } from "@/lib/utils/coordinates";

export function GardenPolygon() {
  const gardenBoundary = useGpsStore((s) => s.gardenBoundary);
  const isRecording = useGpsStore((s) => s.isRecordingBoundary);
  const boundaryPoints = useGpsStore((s) => s.boundaryPoints);

  // Show recording-in-progress polygon
  if (isRecording && boundaryPoints.length > 0) {
    return (
      <>
        {boundaryPoints.length >= 3 && (
          <Polygon
            positions={pointsToLatLngs(boundaryPoints)}
            pathOptions={{
              color: "#ef4444",
              fillColor: "#ef4444",
              fillOpacity: 0.1,
              weight: 2,
              dashArray: "5, 10",
            }}
          />
        )}
        {boundaryPoints.map((point, idx) => (
          <CircleMarker
            key={idx}
            center={[point[0], point[1]]}
            radius={4}
            pathOptions={{
              color: "#ef4444",
              fillColor: "#ef4444",
              fillOpacity: 0.8,
            }}
          />
        ))}
      </>
    );
  }

  // Show saved garden boundary
  if (!gardenBoundary || gardenBoundary.length < 3) return null;

  return (
    <Polygon
      positions={pointsToLatLngs(gardenBoundary)}
      pathOptions={{
        color: "#22c55e",
        fillColor: "#22c55e",
        fillOpacity: 0.15,
        weight: 2,
      }}
    />
  );
}
