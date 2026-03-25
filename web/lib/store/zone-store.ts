import { create } from "zustand";
import * as turf from "@turf/turf";
import type { Zone, ZoneType, EditMode } from "@/lib/types/zones";
import { isLineZoneType } from "@/lib/types/zones";

interface ZoneState {
  // Data
  zones: Zone[];
  activeZoneId: string | null;
  loaded: boolean;

  // Edit/Draw state
  editMode: EditMode;
  drawingPoints: [number, number][]; // [lat, lon] pairs
  newZoneType: ZoneType;

  // Edit state (editing existing zones)
  editingZoneId: string | null;
  editingPoints: [number, number][]; // Working copy of zone points during edit

  // Actions — Data
  loadZones: () => Promise<void>;
  addZone: (zone: {
    name: string;
    zoneType: ZoneType;
    points: [number, number][];
    color?: string;
    mowHeight?: number;
  }) => Promise<Zone | null>;
  updateZone: (
    id: string,
    updates: Partial<{
      name: string;
      points: [number, number][];
      color: string;
      mowHeight: number;
    }>
  ) => Promise<boolean>;
  deleteZone: (id: string) => Promise<boolean>;
  setActiveZone: (id: string | null) => void;

  // Actions — Drawing
  startDrawing: (type: ZoneType) => void;
  addDrawingPoint: (lat: number, lon: number) => void;
  undoDrawingPoint: () => void;
  finishDrawing: (name: string) => Promise<Zone | null>;
  cancelDrawing: () => void;

  // Actions — Editing
  startEditing: (zoneId: string) => void;
  moveEditingPoint: (index: number, lat: number, lon: number) => void;
  moveAllEditingPoints: (deltaLat: number, deltaLon: number) => void;
  addEditingPoint: (afterIndex: number, lat: number, lon: number) => void;
  removeEditingPoint: (index: number) => void;
  finishEditing: () => Promise<boolean>;
  cancelEditing: () => void;

  // Helpers
  getZoneArea: (id: string) => number;
  isPointInZone: (lat: number, lon: number, zoneId: string) => boolean;
  isPointInAnyExclusion: (lat: number, lon: number) => boolean;
  simplifyPoints: (
    points: [number, number][],
    tolerance?: number
  ) => [number, number][];
}

export const useZoneStore = create<ZoneState>((set, get) => ({
  // Initial state
  zones: [],
  activeZoneId: null,
  loaded: false,
  editMode: "none",
  drawingPoints: [],
  newZoneType: "garden",
  editingZoneId: null,
  editingPoints: [],

  // --- Data Actions ---

  loadZones: async () => {
    try {
      const res = await fetch("/api/zones");
      if (!res.ok) return;
      const data = await res.json();
      if (data?.features) {
        set({ zones: data.features, loaded: true });
      }
    } catch (err) {
      console.error("[zones] Failed to load:", err);
    }
  },

  addZone: async (zoneData) => {
    try {
      const res = await fetch("/api/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(zoneData),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error("[zones] Failed to add:", err.error);
        return null;
      }
      const zone = (await res.json()) as Zone;
      set((state) => ({ zones: [...state.zones, zone] }));
      return zone;
    } catch (err) {
      console.error("[zones] Failed to add:", err);
      return null;
    }
  },

  updateZone: async (id, updates) => {
    try {
      const res = await fetch("/api/zones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
      });
      if (!res.ok) return false;
      const updated = (await res.json()) as Zone;
      set((state) => ({
        zones: state.zones.map((z) => (z.id === id ? updated : z)),
      }));
      return true;
    } catch {
      return false;
    }
  },

  deleteZone: async (id) => {
    try {
      const res = await fetch("/api/zones", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) return false;
      set((state) => ({
        zones: state.zones.filter((z) => z.id !== id),
        activeZoneId:
          state.activeZoneId === id ? null : state.activeZoneId,
      }));
      return true;
    } catch {
      return false;
    }
  },

  setActiveZone: (id) => set({ activeZoneId: id }),

  // --- Drawing Actions ---

  startDrawing: (type) =>
    set({
      editMode: "draw",
      drawingPoints: [],
      newZoneType: type,
      activeZoneId: null,
    }),

  addDrawingPoint: (lat, lon) =>
    set((state) => ({
      drawingPoints: [...state.drawingPoints, [lat, lon]],
    })),

  undoDrawingPoint: () =>
    set((state) => ({
      drawingPoints: state.drawingPoints.slice(0, -1),
    })),

  finishDrawing: async (name) => {
    const { drawingPoints, newZoneType, simplifyPoints } = get();

    const minPoints = isLineZoneType(newZoneType) ? 2 : 3;
    if (drawingPoints.length < minPoints) return null;

    // Simplify if many points (from GPS recording)
    const simplified =
      drawingPoints.length > 50
        ? simplifyPoints(drawingPoints, 0.5)
        : drawingPoints;

    const zone = await get().addZone({
      name,
      zoneType: newZoneType,
      points: simplified,
    });

    if (zone) {
      set({
        editMode: "none",
        drawingPoints: [],
        activeZoneId: zone.id,
      });
    }

    return zone;
  },

  cancelDrawing: () =>
    set({
      editMode: "none",
      drawingPoints: [],
    }),

  // --- Editing Actions ---

  startEditing: (zoneId) => {
    const zone = get().zones.find((z) => z.id === zoneId);
    if (!zone || zone.geometry.type !== "Polygon") return;

    // Convert GeoJSON [lon, lat] coordinates to [lat, lon] for editing
    const coords = zone.geometry.coordinates as number[][][];
    const ring = coords[0];
    // Remove the closing point (last === first in GeoJSON)
    const points: [number, number][] = ring
      .slice(0, -1)
      .map(([lon, lat]) => [lat, lon] as [number, number]);

    set({
      editMode: "edit",
      editingZoneId: zoneId,
      editingPoints: points,
      activeZoneId: zoneId,
    });
  },

  moveEditingPoint: (index, lat, lon) =>
    set((state) => {
      const points = [...state.editingPoints];
      points[index] = [lat, lon];
      return { editingPoints: points };
    }),

  moveAllEditingPoints: (deltaLat, deltaLon) =>
    set((state) => ({
      editingPoints: state.editingPoints.map(
        ([lat, lon]) => [lat + deltaLat, lon + deltaLon] as [number, number]
      ),
    })),

  addEditingPoint: (afterIndex, lat, lon) =>
    set((state) => {
      const points = [...state.editingPoints];
      points.splice(afterIndex + 1, 0, [lat, lon]);
      return { editingPoints: points };
    }),

  removeEditingPoint: (index) =>
    set((state) => {
      if (state.editingPoints.length <= 3) return state; // Minimum 3 points
      const points = state.editingPoints.filter((_, i) => i !== index);
      return { editingPoints: points };
    }),

  finishEditing: async () => {
    const { editingZoneId, editingPoints, updateZone } = get();
    if (!editingZoneId || editingPoints.length < 3) return false;

    const success = await updateZone(editingZoneId, {
      points: editingPoints,
    });

    if (success) {
      set({
        editMode: "none",
        editingZoneId: null,
        editingPoints: [],
      });
    }

    return success;
  },

  cancelEditing: () =>
    set({
      editMode: "none",
      editingZoneId: null,
      editingPoints: [],
    }),

  // --- Helpers ---

  getZoneArea: (id) => {
    const zone = get().zones.find((z) => z.id === id);
    if (!zone || zone.geometry.type !== "Polygon") return 0;
    try {
      const polygon = turf.polygon(
        zone.geometry.coordinates as number[][][]
      );
      return turf.area(polygon);
    } catch {
      return 0;
    }
  },

  isPointInZone: (lat, lon, zoneId) => {
    const zone = get().zones.find((z) => z.id === zoneId);
    if (!zone || zone.geometry.type !== "Polygon") return false;
    try {
      const point = turf.point([lon, lat]);
      const polygon = turf.polygon(
        zone.geometry.coordinates as number[][][]
      );
      return turf.booleanPointInPolygon(point, polygon);
    } catch {
      return false;
    }
  },

  isPointInAnyExclusion: (lat, lon) => {
    const exclusions = get().zones.filter(
      (z) => z.properties.zoneType === "exclusion"
    );
    const point = turf.point([lon, lat]);

    return exclusions.some((zone) => {
      try {
        const polygon = turf.polygon(
          zone.geometry.coordinates as number[][][]
        );
        return turf.booleanPointInPolygon(point, polygon);
      } catch {
        return false;
      }
    });
  },

  simplifyPoints: (points, tolerance = 0.5) => {
    if (points.length < 4) return points;
    try {
      // Convert to GeoJSON LineString for simplification
      const line = turf.lineString(
        points.map(([lat, lon]) => [lon, lat])
      );
      const simplified = turf.simplify(line, {
        tolerance: tolerance / 111320, // meters to degrees (approx)
        highQuality: true,
      });
      return simplified.geometry.coordinates.map(
        ([lon, lat]) => [lat, lon] as [number, number]
      );
    } catch {
      return points;
    }
  },
}));
