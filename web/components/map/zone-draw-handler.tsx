"use client";

import { useMapEvents } from "react-leaflet";
import { useZoneStore } from "@/lib/store/zone-store";

/**
 * Handles map click events during zone drawing mode.
 * 
 * - Single click: adds a point to the drawing
 * - Click near first point (< 15m): closes the polygon
 * 
 * IMPORTANT: We read state via getState() inside the click handler
 * to avoid stale closure issues with useMapEvents.
 */
export function ZoneDrawHandler() {
  useMapEvents({
    click(e) {
      // Always read fresh state to avoid stale closures
      const { editMode, drawingPoints, addDrawingPoint } =
        useZoneStore.getState();

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
