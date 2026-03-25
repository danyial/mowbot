"use client";

import { useMapEvents } from "react-leaflet";
import { useZoneStore } from "@/lib/store/zone-store";

/**
 * Handles map click events during zone drawing mode.
 * Each click adds a point. Closing the polygon is done
 * via the "Fertig" button in map-controls.
 */
export function ZoneDrawHandler() {
  useMapEvents({
    click(e) {
      const { editMode, addDrawingPoint } = useZoneStore.getState();
      if (editMode !== "draw") return;
      addDrawingPoint(e.latlng.lat, e.latlng.lng);
    },
  });

  return null;
}
