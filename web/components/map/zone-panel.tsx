"use client";

import {
  Pencil,
  Trash2,
  Crosshair,
  X,
  Fence,
  TreePine,
  Scissors,
  ArrowRightLeft,
  BatteryCharging,
  MoveRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useZoneStore } from "@/lib/store/zone-store";
import { ZONE_TYPE_CONFIG } from "@/lib/types/zones";
import type { ZoneType, Zone } from "@/lib/types/zones";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";

const ZONE_TYPE_ICONS: Record<ZoneType, typeof Fence> = {
  garden: Fence,
  mow: Scissors,
  exclusion: TreePine,
  corridor: ArrowRightLeft,
  dock: BatteryCharging,
  dockPath: MoveRight,
};

/**
 * Format area for display
 */
function formatArea(sqMeters: number): string {
  if (sqMeters < 1) return "< 1 m\u00B2";
  if (sqMeters >= 10000) return `${(sqMeters / 10000).toFixed(2)} ha`;
  return `${Math.round(sqMeters)} m\u00B2`;
}

interface ZonePanelProps {
  open: boolean;
  onClose: () => void;
  onFocusZone: (lat: number, lon: number) => void;
}

/**
 * Zone list row
 */
function ZoneRow({
  zone,
  onFocusZone,
}: {
  zone: Zone;
  onFocusZone: (lat: number, lon: number) => void;
}) {
  const activeZoneId = useZoneStore((s) => s.activeZoneId);
  const setActiveZone = useZoneStore((s) => s.setActiveZone);
  const startEditing = useZoneStore((s) => s.startEditing);
  const deleteZone = useZoneStore((s) => s.deleteZone);
  const editMode = useZoneStore((s) => s.editMode);

  const config = ZONE_TYPE_CONFIG[zone.properties.zoneType];
  const color = zone.properties.color || config.color;
  const isActive = activeZoneId === zone.id;
  const isBusy = editMode !== "none";

  const handleFocus = () => {
    setActiveZone(zone.id);
    // Calculate centroid for centering
    if (zone.geometry.type === "Polygon") {
      const coords = zone.geometry.coordinates as number[][][];
      const ring = coords[0].slice(0, -1);
      const avgLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      const avgLon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      onFocusZone(avgLat, avgLon);
    } else if (zone.geometry.type === "LineString") {
      const coords = zone.geometry.coordinates as number[][];
      const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      const avgLon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      onFocusZone(avgLat, avgLon);
    }
  };

  const handleEdit = () => {
    if (zone.geometry.type !== "Polygon") return;
    startEditing(zone.id);
  };

  const handleDelete = async () => {
    const success = await deleteZone(zone.id);
    if (success) {
      toast({
        title: "Zone geloescht",
        description: `"${zone.properties.name}" entfernt.`,
      });
    }
  };

  const Icon = ZONE_TYPE_ICONS[zone.properties.zoneType];
  const area = zone.properties.area;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors",
        isActive
          ? "bg-accent/50 ring-1 ring-accent-foreground/20"
          : "hover:bg-accent/30"
      )}
    >
      {/* Color dot + icon */}
      <div
        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
        style={{ backgroundColor: color + "30", border: `2px solid ${color}` }}
      >
        <Icon className="h-2.5 w-2.5" style={{ color }} />
      </div>

      {/* Name + info */}
      <button
        className="flex-1 min-w-0 text-left"
        onClick={handleFocus}
      >
        <div className="text-xs font-medium truncate">
          {zone.properties.name}
        </div>
        {area != null && area > 0 && (
          <div className="text-[10px] text-muted-foreground">
            {formatArea(area)}
          </div>
        )}
      </button>

      {/* Action buttons */}
      <div className="flex-shrink-0 flex gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          title="Zentrieren"
          onClick={handleFocus}
          disabled={isBusy}
        >
          <Crosshair className="h-3 w-3" />
        </Button>
        {zone.geometry.type === "Polygon" && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title="Bearbeiten"
            onClick={handleEdit}
            disabled={isBusy}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-destructive hover:text-destructive"
          title="Loeschen"
          onClick={handleDelete}
          disabled={isBusy}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Zone management panel — shows a list of all zones for selection,
 * editing, moving, and deletion. Solves the overlapping zone problem.
 */
export function ZonePanel({ open, onClose, onFocusZone }: ZonePanelProps) {
  const zones = useZoneStore((s) => s.zones);

  if (!open) return null;

  // Group zones by type
  const typeOrder: ZoneType[] = ["garden", "mow", "exclusion", "corridor", "dock", "dockPath"];
  const grouped = typeOrder
    .map((type) => ({
      type,
      config: ZONE_TYPE_CONFIG[type],
      zones: zones.filter((z) => z.properties.zoneType === type),
    }))
    .filter((g) => g.zones.length > 0);

  return (
    <div className="absolute top-3 left-3 bottom-16 z-[1001] w-56 bg-background/95 backdrop-blur rounded-lg shadow-lg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold">Zonen ({zones.length})</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Zone list */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-2">
        {zones.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            Keine Zonen vorhanden
          </div>
        )}

        {grouped.map(({ type, config, zones: typeZones }) => (
          <div key={type}>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
              {config.label} ({typeZones.length})
            </div>
            {typeZones.map((zone) => (
              <ZoneRow
                key={zone.id}
                zone={zone}
                onFocusZone={onFocusZone}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
