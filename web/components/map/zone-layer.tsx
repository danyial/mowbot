"use client";

import { useCallback, useMemo, useRef } from "react";
import { Polygon, CircleMarker, Marker, Tooltip } from "react-leaflet";
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
 * Renders the editing overlay for an existing zone.
 * Shows:
 *  - The polygon with current editing points
 *  - Draggable vertex markers at each point
 *  - Midpoint markers between vertices to add new points
 */
export function EditingOverlay() {
  const {
    editingPoints,
    editingZoneId,
    zones,
    moveEditingPoint,
    addEditingPoint,
    removeEditingPoint,
  } = useZoneStore();

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
      {/* Editing polygon preview */}
      <Polygon
        positions={positions}
        interactive={false}
        pathOptions={{
          color,
          fillColor: color,
          fillOpacity: 0.15,
          weight: 2,
          dashArray: "6, 6",
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

      {/* Midpoint markers — click or drag to insert a new vertex */}
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
 * Create a Leaflet DivIcon for the move handle (center drag marker)
 */
function createMoveIcon() {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="
      width: 28px;
      height: 28px;
      background: rgba(255,255,255,0.95);
      border: 2px solid #3b82f6;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      cursor: grab;
    "><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
    </svg></div>`,
  });
}

/**
 * Renders the moving overlay for an existing zone.
 * Shows the polygon shifted by the current offset + a draggable center marker.
 */
export function MovingOverlay() {
  const { movingZoneId, moveOffset, zones, setMoveOffset } = useZoneStore();
  const markerRef = useRef<L.Marker>(null);

  const zone = zones.find((z) => z.id === movingZoneId);
  if (!zone || zone.geometry.type !== "Polygon") return null;

  const config = ZONE_TYPE_CONFIG[zone.properties.zoneType];
  const color = zone.properties.color || config.color;
  const coords = zone.geometry.coordinates as number[][][];
  const ring = coords[0];

  // Calculate centroid of original zone
  const ringNoClose = ring.slice(0, -1);
  const centroidLat = ringNoClose.reduce((s, c) => s + c[1], 0) / ringNoClose.length;
  const centroidLon = ringNoClose.reduce((s, c) => s + c[0], 0) / ringNoClose.length;

  const [dLat, dLon] = moveOffset;

  // Shifted polygon positions
  const shiftedPositions: LatLngExpression[] = ring.map(
    ([lon, lat]) => [lat + dLat, lon + dLon] as LatLngExpression
  );

  // Drag handle position (shifted centroid)
  const handlePosition: [number, number] = [centroidLat + dLat, centroidLon + dLon];

  const moveIcon = useMemo(() => createMoveIcon(), []);

  const handleDrag = useCallback(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const { lat, lng } = marker.getLatLng();
    // New offset = (new position - original centroid)
    setMoveOffset(lat - centroidLat, lng - centroidLon);
  }, [centroidLat, centroidLon, setMoveOffset]);

  return (
    <>
      {/* Ghost of original position */}
      <Polygon
        positions={ring.map(([lon, lat]) => [lat, lon] as LatLngExpression)}
        interactive={false}
        pathOptions={{
          color: color,
          fillColor: color,
          fillOpacity: 0.05,
          weight: 1,
          dashArray: "4, 8",
          opacity: 0.4,
        }}
      />

      {/* Shifted polygon preview */}
      <Polygon
        positions={shiftedPositions}
        interactive={false}
        pathOptions={{
          color,
          fillColor: color,
          fillOpacity: 0.2,
          weight: 2,
          dashArray: "6, 6",
        }}
      />

      {/* Drag handle at centroid */}
      <Marker
        ref={markerRef}
        position={handlePosition}
        icon={moveIcon}
        draggable
        eventHandlers={{ drag: handleDrag, dragend: handleDrag }}
      />
    </>
  );
}

/**
 * Main zone layer component — renders all saved zones + drawing preview
 */
export function ZoneLayer() {
  const { zones, editMode, editingZoneId, movingZoneId } = useZoneStore();

  return (
    <>
      {/* Saved zones (hide the one being edited/moved) */}
      {zones.map((zone) => {
        if (editMode === "edit" && zone.id === editingZoneId) return null;
        if (editMode === "move" && zone.id === movingZoneId) return null;
        return <ZonePolygon key={zone.id} zone={zone} />;
      })}

      {/* Drawing preview */}
      {editMode === "draw" && <DrawingPreview />}

      {/* Editing overlay */}
      {editMode === "edit" && <EditingOverlay />}

      {/* Moving overlay */}
      {editMode === "move" && <MovingOverlay />}
    </>
  );
}
