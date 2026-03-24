"use client";

import { Polygon, CircleMarker, Tooltip } from "react-leaflet";
import { LatLngExpression } from "leaflet";
import * as turf from "@turf/turf";
import { useZoneStore } from "@/lib/store/zone-store";
import { ZONE_TYPE_CONFIG } from "@/lib/types/zones";
import type { Zone } from "@/lib/types/zones";

/**
 * Convert GeoJSON Polygon coordinates [[[lon,lat],...]] to Leaflet LatLng
 */
function geoJSONToLatLngs(
  coordinates: number[][][]
): LatLngExpression[] {
  return coordinates[0].map(([lon, lat]) => [lat, lon] as LatLngExpression);
}

/**
 * Get the centroid of a polygon zone for label placement
 */
function getZoneCentroid(zone: Zone): [number, number] | null {
  if (zone.geometry.type !== "Polygon") return null;
  try {
    const polygon = turf.polygon(
      zone.geometry.coordinates as number[][][]
    );
    const center = turf.centroid(polygon);
    const [lon, lat] = center.geometry.coordinates;
    return [lat, lon];
  } catch {
    return null;
  }
}

/**
 * Format area for display
 */
function formatArea(sqMeters: number): string {
  if (sqMeters < 1) return "< 1 m\u00B2";
  if (sqMeters >= 10000) return `${(sqMeters / 10000).toFixed(2)} ha`;
  return `${Math.round(sqMeters)} m\u00B2`;
}

/**
 * Renders a single zone polygon on the map
 */
function ZonePolygon({ zone }: { zone: Zone }) {
  const { activeZoneId, setActiveZone } = useZoneStore();

  if (zone.geometry.type !== "Polygon") return null;

  const coordinates = zone.geometry.coordinates as number[][][];
  if (!coordinates[0] || coordinates[0].length < 3) return null;

  const config = ZONE_TYPE_CONFIG[zone.properties.zoneType];
  const color = zone.properties.color || config.color;
  const isActive = activeZoneId === zone.id;

  const positions = geoJSONToLatLngs(coordinates);
  const centroid = getZoneCentroid(zone);
  const area = zone.properties.area;

  return (
    <>
      <Polygon
        positions={positions}
        pathOptions={{
          color: isActive ? "#ffffff" : color,
          fillColor: color,
          fillOpacity: isActive
            ? config.fillOpacity + 0.15
            : config.fillOpacity,
          weight: isActive ? 3 : 2,
          dashArray: config.dashArray,
        }}
        eventHandlers={{
          click: () => setActiveZone(isActive ? null : zone.id),
        }}
      >
        <Tooltip
          direction="center"
          permanent={false}
          className="zone-tooltip"
        >
          <div className="text-xs">
            <strong>{zone.properties.name}</strong>
            <br />
            <span className="opacity-70">{config.label}</span>
            {area != null && area > 0 && (
              <>
                <br />
                <span className="opacity-70">{formatArea(area)}</span>
              </>
            )}
          </div>
        </Tooltip>
      </Polygon>

      {/* Show centroid label for active zone */}
      {isActive && centroid && (
        <CircleMarker
          center={centroid}
          radius={0}
          pathOptions={{ opacity: 0 }}
        >
          <Tooltip direction="center" permanent className="zone-label">
            <span className="text-xs font-bold">
              {zone.properties.name}
            </span>
          </Tooltip>
        </CircleMarker>
      )}
    </>
  );
}

/**
 * Renders the drawing-in-progress polygon
 */
function DrawingPreview() {
  const { drawingPoints, newZoneType } = useZoneStore();

  if (drawingPoints.length === 0) return null;

  const config = ZONE_TYPE_CONFIG[newZoneType];
  const positions = drawingPoints.map(
    ([lat, lon]) => [lat, lon] as LatLngExpression
  );

  return (
    <>
      {/* Preview polygon (when 3+ points) */}
      {drawingPoints.length >= 3 && (
        <Polygon
          positions={positions}
          pathOptions={{
            color: config.color,
            fillColor: config.color,
            fillOpacity: 0.1,
            weight: 2,
            dashArray: "5, 10",
          }}
        />
      )}

      {/* Individual points */}
      {drawingPoints.map(([lat, lon], i) => (
        <CircleMarker
          key={i}
          center={[lat, lon]}
          radius={i === 0 ? 6 : 4}
          pathOptions={{
            color: config.color,
            fillColor: i === 0 ? config.color : "#ffffff",
            fillOpacity: 1,
            weight: 2,
          }}
        >
          {i === 0 && drawingPoints.length >= 3 && (
            <Tooltip direction="top" permanent className="text-xs">
              Klick zum Schliessen
            </Tooltip>
          )}
        </CircleMarker>
      ))}
    </>
  );
}

/**
 * Main zone layer component — renders all saved zones + drawing preview
 */
export function ZoneLayer() {
  const { zones, editMode } = useZoneStore();

  return (
    <>
      {/* Saved zones */}
      {zones.map((zone) => (
        <ZonePolygon key={zone.id} zone={zone} />
      ))}

      {/* Drawing preview */}
      {editMode === "draw" && <DrawingPreview />}
    </>
  );
}
