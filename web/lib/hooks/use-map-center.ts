"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/utils/coordinates";

interface MapDefaults {
  center: [number, number];
  zoom: number;
}

/**
 * Loads the default map center and zoom from the config API.
 * Falls back to env-variable defaults if config is unavailable.
 */
export function useMapDefaults(): MapDefaults {
  const [defaults, setDefaults] = useState<MapDefaults>({
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
  });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.map) return;
        const lat = data.map.defaultLat;
        const lon = data.map.defaultLon;
        const zoom = data.map.defaultZoom;

        setDefaults((prev) => ({
          center:
            typeof lat === "number" && typeof lon === "number" && lat !== 0 && lon !== 0
              ? [lat, lon]
              : prev.center,
          zoom: typeof zoom === "number" && zoom >= 1 && zoom <= 22 ? zoom : prev.zoom,
        }));
      })
      .catch(() => {
        // Use defaults
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return defaults;
}
