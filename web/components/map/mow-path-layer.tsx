"use client";

import { Polyline } from "react-leaflet";
import { useMissionStore } from "@/lib/store/mission-store";
import { pointsToLatLngs } from "@/lib/utils/coordinates";

export function MowPathLayer() {
  const { missions, activeMission } = useMissionStore();
  const active = missions.find((m) => m.id === activeMission);

  if (!active) return null;

  const exitLen = active.dockExitLength ?? 0;
  const entryLen = active.dockEntryLength ?? 0;
  const pts = active.pathPoints;

  const exitPath = exitLen > 0
    ? pointsToLatLngs(pts.slice(0, exitLen + 1))
    : [];
  const mowPath = pointsToLatLngs(
    pts.slice(
      Math.max(0, exitLen),
      entryLen > 0 ? pts.length - entryLen + 1 : pts.length
    )
  );
  const entryPath = entryLen > 0
    ? pointsToLatLngs(pts.slice(pts.length - entryLen - 1))
    : [];

  return (
    <>
      {/* Dock exit path — purple dashed */}
      {exitPath.length >= 2 && (
        <Polyline
          positions={exitPath}
          pathOptions={{
            color: "#a855f7",
            weight: 2,
            opacity: 0.5,
            dashArray: "5, 5",
          }}
        />
      )}

      {/* Planned mow path — blue dashed */}
      {mowPath.length >= 2 && (
        <Polyline
          positions={mowPath}
          pathOptions={{
            color: "#3b82f6",
            weight: 2,
            opacity: 0.5,
            dashArray: "5, 5",
          }}
        />
      )}

      {/* Dock entry path — purple dashed */}
      {entryPath.length >= 2 && (
        <Polyline
          positions={entryPath}
          pathOptions={{
            color: "#a855f7",
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
