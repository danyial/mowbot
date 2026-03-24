"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Polygon, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import type { Mission } from "@/lib/types/mission";
import { useZoneStore } from "@/lib/store/zone-store";
import { ZONE_TYPE_CONFIG } from "@/lib/types/zones";

/**
 * Auto-fit the map to the path bounds
 */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (points.length >= 2 && !fitted.current) {
      const bounds = L.latLngBounds(
        points.map(([lat, lon]) => [lat, lon] as [number, number])
      );
      map.fitBounds(bounds, { padding: [20, 20] });
      fitted.current = true;
    }
  }, [points, map]);

  return null;
}

interface MissionPreviewMapProps {
  mission: Mission;
}

export default function MissionPreviewMap({ mission }: MissionPreviewMapProps) {
  const zones = useZoneStore((s) => s.zones);

  // Get the zones assigned to this mission
  const isAll = mission.zoneIds.length === 1 && mission.zoneIds[0] === "all";
  const missionZones = isAll
    ? zones.filter(
        (z) =>
          z.geometry.type === "Polygon" &&
          (z.properties.zoneType === "garden" || z.properties.zoneType === "mow")
      )
    : zones.filter((z) => mission.zoneIds.includes(z.id));

  const exclusionZones = zones.filter(
    (z) =>
      z.geometry.type === "Polygon" && z.properties.zoneType === "exclusion"
  );

  // Use path center or fallback
  const pathPoints = mission.pathPoints;
  const defaultCenter: [number, number] =
    pathPoints.length > 0 ? pathPoints[0] : [48.2, 16.3];

  return (
    <div className="h-64 w-full rounded-md overflow-hidden border border-border">
      <MapContainer
        center={defaultCenter}
        zoom={19}
        maxZoom={22}
        className="h-full w-full"
        zoomControl={false}
        attributionControl={false}
        dragging={true}
        scrollWheelZoom={true}
        doubleClickZoom={false}
        touchZoom={true}
      >
        <TileLayer
          url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
          maxZoom={22}
          maxNativeZoom={20}
        />

        {/* Mission zones */}
        {missionZones.map((zone) => {
          const coords = zone.geometry.coordinates as number[][][];
          const positions = coords[0].map(
            ([lon, lat]) => [lat, lon] as LatLngExpression
          );
          const config = ZONE_TYPE_CONFIG[zone.properties.zoneType];
          return (
            <Polygon
              key={zone.id}
              positions={positions}
              interactive={false}
              pathOptions={{
                color: config.color,
                fillColor: config.color,
                fillOpacity: 0.1,
                weight: 1,
              }}
            />
          );
        })}

        {/* Exclusion zones */}
        {exclusionZones.map((zone) => {
          const coords = zone.geometry.coordinates as number[][][];
          const positions = coords[0].map(
            ([lon, lat]) => [lat, lon] as LatLngExpression
          );
          return (
            <Polygon
              key={zone.id}
              positions={positions}
              interactive={false}
              pathOptions={{
                color: "#ef4444",
                fillColor: "#ef4444",
                fillOpacity: 0.2,
                weight: 1,
                dashArray: "4, 4",
              }}
            />
          );
        })}

        {/* Planned path */}
        {pathPoints.length >= 2 && (
          <Polyline
            positions={pathPoints.map(
              ([lat, lon]) => [lat, lon] as LatLngExpression
            )}
            pathOptions={{
              color: "#3b82f6",
              weight: 2,
              opacity: 0.7,
            }}
          />
        )}

        {/* Completed path */}
        {mission.completedPoints.length >= 2 && (
          <Polyline
            positions={mission.completedPoints.map(
              ([lat, lon]) => [lat, lon] as LatLngExpression
            )}
            pathOptions={{
              color: "#22c55e",
              weight: 3,
              opacity: 0.9,
            }}
          />
        )}

        <FitBounds points={pathPoints} />
      </MapContainer>
    </div>
  );
}
