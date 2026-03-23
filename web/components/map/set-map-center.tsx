"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

interface SetMapCenterProps {
  center: [number, number];
  zoom: number;
  active: boolean; // only move map when active (e.g. no GPS fix)
}

/**
 * Imperatively sets the map center and zoom when they change.
 * Must be a child of MapContainer.
 * Only moves the map when `active` is true (typically when no GPS fix is available).
 */
export function SetMapCenter({ center, zoom, active }: SetMapCenterProps) {
  const map = useMap();
  const prevCenter = useRef<[number, number]>(center);
  const prevZoom = useRef<number>(zoom);

  useEffect(() => {
    if (!active) return;

    const centerChanged =
      center[0] !== prevCenter.current[0] ||
      center[1] !== prevCenter.current[1];
    const zoomChanged = zoom !== prevZoom.current;

    if (centerChanged || zoomChanged) {
      prevCenter.current = center;
      prevZoom.current = zoom;
      map.setView(center, zoom, { animate: true });
    }
  }, [center, zoom, active, map]);

  return null;
}
