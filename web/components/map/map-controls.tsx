"use client";

import { MutableRefObject, useState } from "react";
import {
  Crosshair,
  Navigation,
  Circle,
  Layers,
  Trash2,
  MapPin,
  Route,
  Map,
  Globe,
  Plus,
  Undo2,
  Check,
  X,
  Fence,
  TreePine,
  Scissors,
  ArrowRightLeft,
  BatteryCharging,
  List,
} from "lucide-react";
import type { MapLayerType } from "./robot-map";
import { Button } from "@/components/ui/button";
import { useGpsStore } from "@/lib/store/gps-store";
import { useZoneStore } from "@/lib/store/zone-store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import type { ZoneType } from "@/lib/types/zones";
import { ZONE_TYPE_CONFIG } from "@/lib/types/zones";

interface MapControlsProps {
  following: boolean;
  onToggleFollow: () => void;
  showTrack: boolean;
  onToggleTrack: () => void;
  showZones: boolean;
  onToggleZones: () => void;
  showPaths: boolean;
  onTogglePaths: () => void;
  mapLayer: MapLayerType;
  onChangeLayer: (layer: MapLayerType) => void;
  mapRef: MutableRefObject<L.Map | null>;
  showZonePanel: boolean;
  onToggleZonePanel: () => void;
}

const ZONE_TYPE_ICONS: Record<ZoneType, typeof Fence> = {
  garden: Fence,
  mow: Scissors,
  exclusion: TreePine,
  corridor: ArrowRightLeft,
  dock: BatteryCharging,
};

export function MapControls({
  following,
  onToggleFollow,
  showTrack,
  onToggleTrack,
  showZones,
  onToggleZones,
  showPaths,
  onTogglePaths,
  mapLayer,
  onChangeLayer,
  mapRef,
  showZonePanel,
  onToggleZonePanel,
}: MapControlsProps) {
  const latitude = useGpsStore((s) => s.latitude);
  const longitude = useGpsStore((s) => s.longitude);
  const fixStatus = useGpsStore((s) => s.fixStatus);
  const isRecordingBoundary = useGpsStore((s) => s.isRecordingBoundary);
  const startBoundaryRecording = useGpsStore((s) => s.startBoundaryRecording);
  const stopBoundaryRecording = useGpsStore((s) => s.stopBoundaryRecording);
  const cancelBoundaryRecording = useGpsStore(
    (s) => s.cancelBoundaryRecording
  );
  const clearTrack = useGpsStore((s) => s.clearTrack);

  const editMode = useZoneStore((s) => s.editMode);
  const drawingPoints = useZoneStore((s) => s.drawingPoints);
  const newZoneType = useZoneStore((s) => s.newZoneType);
  const startDrawing = useZoneStore((s) => s.startDrawing);
  const undoDrawingPoint = useZoneStore((s) => s.undoDrawingPoint);
  const finishDrawing = useZoneStore((s) => s.finishDrawing);
  const cancelDrawing = useZoneStore((s) => s.cancelDrawing);
  const zones = useZoneStore((s) => s.zones);
  const editingPoints = useZoneStore((s) => s.editingPoints);
  const finishEditing = useZoneStore((s) => s.finishEditing);
  const cancelEditing = useZoneStore((s) => s.cancelEditing);

  const [showZoneMenu, setShowZoneMenu] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);

  const handleCenterOnRobot = () => {
    if (latitude !== null && longitude !== null && mapRef.current) {
      mapRef.current.setView([latitude, longitude], mapRef.current.getZoom(), {
        animate: true,
      });
    }
  };

  const handleStartDrawing = (type: ZoneType) => {
    startDrawing(type);
    setShowZoneMenu(false);
    toast({
      title: `${ZONE_TYPE_CONFIG[type].label} zeichnen`,
      description: "Tippe auf die Karte um Punkte zu setzen.",
    });
  };

  const handleFinishDrawing = async () => {
    const name = zoneName.trim() || ZONE_TYPE_CONFIG[newZoneType].label;
    const zone = await finishDrawing(name);
    setShowNameInput(false);
    setZoneName("");
    if (zone) {
      toast({
        title: "Zone gespeichert",
        description: `"${zone.properties.name}" mit ${drawingPoints.length} Punkten erstellt.`,
        variant: "success",
      });
    } else {
      toast({
        title: "Fehler",
        description: "Zone konnte nicht gespeichert werden.",
        variant: "destructive",
      });
    }
  };

  const handleGpsRecordToggle = async () => {
    if (isRecordingBoundary) {
      const points = stopBoundaryRecording();
      if (points.length >= 3) {
        // Use the zone store to save via the new API
        const zone = await useZoneStore.getState().addZone({
          name: "GPS-Aufnahme",
          zoneType: "garden",
          points,
        });
        if (zone) {
          toast({
            title: "Zone gespeichert",
            description: `${points.length} GPS-Punkte aufgezeichnet.`,
            variant: "success",
          });
        } else {
          toast({
            title: "Fehler beim Speichern",
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Zu wenige Punkte",
          description: "Mindestens 3 Punkte erforderlich.",
          variant: "destructive",
        });
      }
    } else {
      startBoundaryRecording();
      toast({
        title: "GPS-Aufnahme gestartet",
        description: "Fahre den Rand ab. Tippe erneut zum Beenden.",
      });
    }
  };

  const fixBadgeVariant: Record<
    string,
    "success" | "warning" | "error" | "info" | "secondary"
  > = {
    no_fix: "error",
    autonomous: "warning",
    dgps: "warning",
    rtk_float: "info",
    rtk_fixed: "success",
  };

  const handleFinishEditing = async () => {
    const success = await finishEditing();
    if (success) {
      toast({
        title: "Zone aktualisiert",
        description: "Aenderungen gespeichert.",
        variant: "success",
      });
    } else {
      toast({
        title: "Fehler",
        description: "Zone konnte nicht aktualisiert werden.",
        variant: "destructive",
      });
    }
  };

  const handleCancelEditing = () => {
    cancelEditing();
    toast({ title: "Bearbeitung abgebrochen" });
  };

  const isDrawing = editMode === "draw";
  const isEditing = editMode === "edit";
  const isIdle = editMode === "none";

  return (
    <>
      {/* Top-right: GPS Status */}
      <div className="absolute top-3 right-3 z-[1000]">
        <Badge variant={fixBadgeVariant[fixStatus] || "secondary"}>
          <MapPin className="h-3 w-3 mr-1" />
          {fixStatus.replace("_", " ").toUpperCase()}
        </Badge>
      </div>

      {/* Bottom-left: Navigation controls */}
      <div className="absolute bottom-3 left-3 z-[1000] flex flex-col gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCenterOnRobot}
          className="shadow-lg"
        >
          <Crosshair className="h-4 w-4 mr-1" /> Zentrieren
        </Button>
        <Button
          size="sm"
          variant={following ? "default" : "secondary"}
          onClick={onToggleFollow}
          className="shadow-lg"
        >
          <Navigation className="h-4 w-4 mr-1" />
          {following ? "Folgen An" : "Folgen Aus"}
        </Button>
      </div>

      {/* Bottom-right: Zone & Layer controls */}
      <div className="absolute bottom-3 right-3 z-[1000] flex flex-col gap-2 items-end">
        {/* Drawing mode controls */}
        {isDrawing && (
          <>
            {/* Name input dialog */}
            {showNameInput ? (
              <div className="bg-background/95 backdrop-blur rounded-lg p-3 shadow-lg flex flex-col gap-2 w-56">
                <label className="text-xs font-medium">Zonenname</label>
                <input
                  type="text"
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  placeholder={ZONE_TYPE_CONFIG[newZoneType].label}
                  className="h-8 px-2 text-sm rounded border border-border bg-background"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleFinishDrawing();
                    if (e.key === "Escape") setShowNameInput(false);
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleFinishDrawing}
                    className="flex-1 h-7"
                  >
                    <Check className="h-3 w-3 mr-1" /> Speichern
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowNameInput(false)}
                    className="h-7"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-background/90 backdrop-blur rounded-lg px-3 py-1.5 shadow-lg">
                  <span className="text-xs">
                    {ZONE_TYPE_CONFIG[newZoneType].label} zeichnen
                    {drawingPoints.length > 0 &&
                      ` (${drawingPoints.length} Punkte)`}
                  </span>
                </div>
                <div className="flex gap-1">
                  {drawingPoints.length >= 3 && (
                    <Button
                      size="sm"
                      onClick={() => setShowNameInput(true)}
                      className="shadow-lg"
                    >
                      <Check className="h-4 w-4 mr-1" /> Fertig
                    </Button>
                  )}
                  {drawingPoints.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={undoDrawingPoint}
                      className="shadow-lg"
                    >
                      <Undo2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      cancelDrawing();
                      setShowNameInput(false);
                      setZoneName("");
                    }}
                    className="shadow-lg"
                  >
                    <X className="h-4 w-4 mr-1" /> Abbrechen
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {/* Editing mode controls */}
        {isEditing && (
          <>
            <div className="bg-background/90 backdrop-blur rounded-lg px-3 py-1.5 shadow-lg">
              <span className="text-xs">
                Zone bearbeiten ({editingPoints.length} Punkte)
              </span>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Punkte oder Flaeche ziehen, Mittelpunkte antippen
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                onClick={handleFinishEditing}
                className="shadow-lg"
              >
                <Check className="h-4 w-4 mr-1" /> Speichern
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleCancelEditing}
                className="shadow-lg"
              >
                <X className="h-4 w-4 mr-1" /> Abbrechen
              </Button>
            </div>
          </>
        )}

        {/* Normal mode controls */}
        {isIdle && (
          <>
            {/* Zone creation menu */}
            {showZoneMenu && (
              <div className="bg-background/95 backdrop-blur rounded-lg p-2 shadow-lg flex flex-col gap-1 w-48">
                <div className="text-xs font-medium px-2 py-1 text-muted-foreground">
                  Zone zeichnen
                </div>
                {(
                  Object.keys(ZONE_TYPE_CONFIG) as ZoneType[]
                ).map((type) => {
                  const Icon = ZONE_TYPE_ICONS[type];
                  const config = ZONE_TYPE_CONFIG[type];
                  return (
                    <Button
                      key={type}
                      size="sm"
                      variant="ghost"
                      className="justify-start h-8 text-xs"
                      onClick={() => handleStartDrawing(type)}
                    >
                      <Icon
                        className="h-3 w-3 mr-2"
                        style={{ color: config.color }}
                      />
                      {config.label}
                    </Button>
                  );
                })}
                <div className="border-t border-border my-1" />
                <div className="text-xs font-medium px-2 py-1 text-muted-foreground">
                  GPS-Aufnahme
                </div>
                <Button
                  size="sm"
                  variant={isRecordingBoundary ? "destructive" : "ghost"}
                  className={cn(
                    "justify-start h-8 text-xs",
                    isRecordingBoundary && "animate-pulse-record"
                  )}
                  onClick={() => {
                    handleGpsRecordToggle();
                    if (!isRecordingBoundary) setShowZoneMenu(false);
                  }}
                >
                  <Circle
                    className={cn(
                      "h-3 w-3 mr-2",
                      isRecordingBoundary && "fill-current"
                    )}
                  />
                  {isRecordingBoundary
                    ? "Aufnahme stoppen"
                    : "Grenze abfahren"}
                </Button>
              </div>
            )}

            {/* Zone add button */}
            <Button
              size="sm"
              variant={showZoneMenu ? "default" : "secondary"}
              onClick={() => setShowZoneMenu(!showZoneMenu)}
              className="shadow-lg"
            >
              <Plus className="h-4 w-4 mr-1" />
              Zone hinzufuegen
            </Button>

            {/* Zone panel toggle */}
            {zones.length > 0 && (
              <Button
                size="sm"
                variant={showZonePanel ? "default" : "secondary"}
                onClick={onToggleZonePanel}
                className="shadow-lg"
              >
                <List className="h-4 w-4 mr-1" />
                Zonen verwalten
              </Button>
            )}

            {/* GPS recording cancel (when recording from menu) */}
            {isRecordingBoundary && (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleGpsRecordToggle}
                className={cn("shadow-lg", "animate-pulse-record")}
              >
                <Circle className="h-4 w-4 mr-1 fill-current" />
                Aufnahme stoppen
              </Button>
            )}

            {isRecordingBoundary && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  cancelBoundaryRecording();
                  toast({ title: "Aufnahme abgebrochen" });
                }}
                className="shadow-lg"
              >
                Abbrechen
              </Button>
            )}

            {/* Clear Track */}
            <Button
              size="sm"
              variant="outline"
              onClick={clearTrack}
              className="shadow-lg"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Track loeschen
            </Button>

            {/* Map type switcher */}
            <div className="flex gap-1">
              <Button
                size="icon"
                variant={mapLayer === "roadmap" ? "default" : "outline"}
                onClick={() => onChangeLayer("roadmap")}
                className="shadow-lg h-8 w-8"
                title="Karte"
              >
                <Map className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant={mapLayer === "satellite" ? "default" : "outline"}
                onClick={() => onChangeLayer("satellite")}
                className="shadow-lg h-8 w-8"
                title="Satellit"
              >
                <Globe className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant={mapLayer === "hybrid" ? "default" : "outline"}
                onClick={() => onChangeLayer("hybrid")}
                className="shadow-lg h-8 w-8"
                title="Hybrid"
              >
                <Layers className="h-3 w-3" />
              </Button>
            </div>

            {/* Data layer toggles */}
            <div className="flex gap-1">
              <Button
                size="icon"
                variant={showZones ? "default" : "outline"}
                onClick={onToggleZones}
                className="shadow-lg h-8 w-8"
                title="Zonen"
              >
                <Fence className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant={showTrack ? "default" : "outline"}
                onClick={onToggleTrack}
                className="shadow-lg h-8 w-8"
                title="Fahrspur"
              >
                <Route className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant={showPaths ? "default" : "outline"}
                onClick={onTogglePaths}
                className="shadow-lg h-8 w-8"
                title="Maehpfade"
              >
                <MapPin className="h-3 w-3" />
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
