"use client";

import { useMapEvents } from "react-leaflet";
import { useZoneStore } from "@/lib/store/zone-store";

/**
 * Handles map click events during zone drawing mode.
 * 
 * - Single click: adds a point to the drawing
 * - Click near first point (< 15m): closes the polygon
 */
export function ZoneDrawHandler() {
  const { editMode, drawingPoints, addDrawingPoint } = useZoneStore();

  useMapEvents({
    click(e) {
      if (editMode !== "draw") return;

      const { lat, lng: lon } = e.latlng;

      // If 3+ points and click is near the first point, close the polygon
      if (drawingPoints.length >= 3) {
        const [firstLat, firstLon] = drawingPoints[0];
        const distToFirst = Math.sqrt(
          (lat - firstLat) ** 2 + (lon - firstLon) ** 2
        );
        // ~15m threshold at mid-latitudes
        const threshold = 15 / 111320;
        if (distToFirst < threshold) {
          // Don't add the point — the finish action will be handled
          // by the UI button or this close-detection
          // Trigger finish via a custom event
          window.dispatchEvent(
            new CustomEvent("zone-drawing-close-requested")
          );
          return;
        }
      }

      addDrawingPoint(lat, lon);
    },
  });

  return null;
}
