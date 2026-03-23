"use client";

import { Polyline } from "react-leaflet";
import { useMissionStore } from "@/lib/store/mission-store";
import { pointsToLatLngs } from "@/lib/utils/coordinates";

export function MowPathLayer() {
  const { missions, activeMission } = useMissionStore();
  const active = missions.find((m) => m.id === activeMission);

  if (!active) return null;

  return (
    <>
      {/* Planned path */}
      {active.pathPoints.length >= 2 && (
        <Polyline
          positions={pointsToLatLngs(active.pathPoints)}
          pathOptions={{
            color: "#3b82f6",
            weight: 2,
            opacity: 0.5,
            dashArray: "5, 5",
          }}
        />
      )}

      {/* Completed path */}
      {active.completedPoints.length >= 2 && (
        <Polyline
          positions={pointsToLatLngs(active.completedPoints)}
          pathOptions={{
            color: "#22c55e",
            weight: 3,
            opacity: 0.8,
          }}
        />
      )}
    </>
  );
}
