/**
 * Zone types for garden management.
 * Based on GeoJSON (RFC 7946) with custom properties.
 */

export type ZoneType =
  | "garden" // Gartengrenze (aeussere Begrenzung)
  | "mow" // Maehzone
  | "exclusion" // Ausschlusszone (Beet, Baum, Teich)
  | "corridor" // Verbindungsweg zwischen Zonen
  | "dock"; // Ladestationsbereich

export interface ZoneProperties {
  name: string;
  zoneType: ZoneType;
  color?: string;
  mowHeight?: number; // Nur fuer mow-Zonen (mm)
  area?: number; // Flaeche in m² (berechnet von der API)
  createdAt: string;
  updatedAt: string;
}

/** A single zone as a GeoJSON Feature */
export interface Zone {
  type: "Feature";
  id: string;
  properties: ZoneProperties;
  geometry: {
    type: "Polygon" | "Point";
    coordinates: number[][][] | number[]; // Polygon: [[[lon,lat],...]], Point: [lon,lat]
  };
}

/** All zones as a GeoJSON FeatureCollection */
export interface ZoneCollection {
  type: "FeatureCollection";
  features: Zone[];
}

/** Zone type display configuration */
export const ZONE_TYPE_CONFIG: Record<
  ZoneType,
  {
    label: string;
    color: string;
    fillOpacity: number;
    dashArray?: string;
    icon?: string;
  }
> = {
  garden: {
    label: "Gartengrenze",
    color: "#22c55e",
    fillOpacity: 0.1,
  },
  mow: {
    label: "Maehzone",
    color: "#3b82f6",
    fillOpacity: 0.2,
  },
  exclusion: {
    label: "Ausschlusszone",
    color: "#ef4444",
    fillOpacity: 0.2,
    dashArray: "8, 4",
  },
  corridor: {
    label: "Korridor",
    color: "#eab308",
    fillOpacity: 0.1,
    dashArray: "5, 10",
  },
  dock: {
    label: "Ladestation",
    color: "#f97316",
    fillOpacity: 0.3,
  },
};

export type EditMode = "none" | "draw" | "record" | "edit";
