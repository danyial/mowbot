"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Polygon, CircleMarker, Marker, Tooltip, useMapEvents } from "react-leaflet";
import L, { LatLngExpression } from "leaflet";
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
      {/* Preview polygon (when 3+ points) — interactive=false so clicks pass through to map */}
      {drawingPoints.length >= 3 && (
        <Polygon
          positions={positions}
          interactive={false}
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
          interactive={false}
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
 * Create a Leaflet DivIcon for draggable vertex markers
 */
function createVertexIcon(color: string, isActive: boolean) {
  const size = isActive ? 14 : 10;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background: #ffffff;
      border: 2.5px solid ${color};
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      cursor: grab;
    "></div>`,
  });
}

/**
 * Create a Leaflet DivIcon for midpoint markers (add point between vertices)
 */
function createMidpointIcon(color: string) {
  return L.divIcon({
    className: "",
    iconSize: [8, 8],
    iconAnchor: [4, 4],
    html: `<div style="
      width: 8px;
      height: 8px;
      background: ${color};
      opacity: 0.5;
      border-radius: 50%;
      cursor: pointer;
    "></div>`,
  });
}

/**
 * A single draggable vertex marker
 */
function DraggableVertex({
  position,
  index,
  color,
  onMove,
  onRemove,
}: {
  position: [number, number];
  index: number;
  color: string;
  onMove: (index: number, lat: number, lon: number) => void;
  onRemove: (index: number) => void;
}) {
  const markerRef = useRef<L.Marker>(null);
  const icon = useMemo(() => createVertexIcon(color, false), [color]);

  const handleDrag = useCallback(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const { lat, lng } = marker.getLatLng();
    onMove(index, lat, lng);
  }, [index, onMove]);

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      draggable
      eventHandlers={{
        drag: handleDrag,
        dragend: handleDrag,
        contextmenu: (e) => {
          L.DomEvent.stopPropagation(e);
          onRemove(index);
        },
      }}
    />
  );
}

/**
 * Handles drag-to-move for the entire editing polygon.
 * Listens for mousedown on the polygon, then tracks mousemove on the map
 * to shift all editing points by the drag delta.
 */
function PolygonDragHandler({
  onMove,
}: {
  onMove: (deltaLat: number, deltaLon: number) => void;
}) {
  const dragStart = useRef<{ lat: number; lon: number } | null>(null);

  useMapEvents({
    mousemove(e) {
      if (!dragStart.current) return;
      const { lat, lng: lon } = e.latlng;
      const dLat = lat - dragStart.current.lat;
      const dLon = lon - dragStart.current.lon;
      dragStart.current = { lat, lon };
      onMove(dLat, dLon);
    },
    mouseup() {
      if (dragStart.current) {
        dragStart.current = null;
      }
    },
  });

  // Expose a way to start dragging (called from polygon mousedown)
  // We attach this to the window so the Polygon event handler can trigger it
  // This is cleaner than lifting state — the handler is local to the edit session
  (PolygonDragHandler as unknown as { start: (lat: number, lon: number) => void }).start =
    (lat: number, lon: number) => {
      dragStart.current = { lat, lon };
    };

  return null;
}

/**
 * Renders the editing overlay for an existing zone.
 * Shows:
 *  - The polygon with current editing points (draggable to move entire zone)
 *  - Draggable vertex markers at each point
 *  - Midpoint markers between vertices to add new points
 */
export function EditingOverlay() {
  const {
    editingPoints,
    editingZoneId,
    zones,
    moveEditingPoint,
    moveAllEditingPoints,
    addEditingPoint,
    removeEditingPoint,
  } = useZoneStore();
  const [isDragging, setIsDragging] = useState(false);

  const zone = zones.find((z) => z.id === editingZoneId);
  if (!zone || editingPoints.length < 3) return null;

  const config = ZONE_TYPE_CONFIG[zone.properties.zoneType];
  const color = zone.properties.color || config.color;

  const positions = editingPoints.map(
    ([lat, lon]) => [lat, lon] as LatLngExpression
  );

  // Calculate midpoints between consecutive vertices
  const midpoints: { position: [number, number]; afterIndex: number }[] = [];
  for (let i = 0; i < editingPoints.length; i++) {
    const next = (i + 1) % editingPoints.length;
    const [lat1, lon1] = editingPoints[i];
    const [lat2, lon2] = editingPoints[next];
    midpoints.push({
      position: [(lat1 + lat2) / 2, (lon1 + lon2) / 2],
      afterIndex: i,
    });
  }

  const midpointIcon = createMidpointIcon(color);

  return (
    <>
      {/* Polygon drag handler (listens for map mousemove/mouseup) */}
      <PolygonDragHandler onMove={moveAllEditingPoints} />

      {/* Editing polygon — draggable to move entire zone */}
      <Polygon
        positions={positions}
        pathOptions={{
          color,
          fillColor: color,
          fillOpacity: 0.15,
          weight: 2,
          dashArray: isDragging ? undefined : "6, 6",
          className: "cursor-move",
        }}
        eventHandlers={{
          mousedown: (e) => {
            L.DomEvent.stopPropagation(e);
            const { lat, lng: lon } = e.latlng;
            (PolygonDragHandler as unknown as { start: (lat: number, lon: number) => void }).start(lat, lon);
            setIsDragging(true);
            // Disable map dragging while moving the polygon
            e.target._map?.dragging.disable();
          },
          mouseup: (e) => {
            setIsDragging(false);
            e.target._map?.dragging.enable();
          },
        }}
      />

      {/* Draggable vertex markers */}
      {editingPoints.map(([lat, lon], i) => (
        <DraggableVertex
          key={`v-${i}`}
          position={[lat, lon]}
          index={i}
          color={color}
          onMove={moveEditingPoint}
          onRemove={removeEditingPoint}
        />
      ))}

      {/* Midpoint markers — click to insert a new vertex */}
      {midpoints.map(({ position, afterIndex }) => (
        <Marker
          key={`m-${afterIndex}`}
          position={position}
          icon={midpointIcon}
          eventHandlers={{
            click: () => {
              addEditingPoint(afterIndex, position[0], position[1]);
            },
          }}
        />
      ))}
    </>
  );
}

/**
 * Main zone layer component — renders all saved zones + drawing preview
 */
export function ZoneLayer() {
  const { zones, editMode, editingZoneId } = useZoneStore();

  return (
    <>
      {/* Saved zones (hide the one being edited) */}
      {zones.map((zone) =>
        editMode === "edit" && zone.id === editingZoneId ? null : (
          <ZonePolygon key={zone.id} zone={zone} />
        )
      )}

      {/* Drawing preview */}
      {editMode === "draw" && <DrawingPreview />}

      {/* Editing overlay */}
      {editMode === "edit" && <EditingOverlay />}
    </>
  );
}
