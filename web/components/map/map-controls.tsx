"use client";

import { MutableRefObject } from "react";
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
} from "lucide-react";
import type { MapLayerType } from "./robot-map";
import { Button } from "@/components/ui/button";
import { useGpsStore } from "@/lib/store/gps-store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";

interface MapControlsProps {
  following: boolean;
  onToggleFollow: () => void;
  showTrack: boolean;
  onToggleTrack: () => void;
  showGarden: boolean;
  onToggleGarden: () => void;
  showPaths: boolean;
  onTogglePaths: () => void;
  mapLayer: MapLayerType;
  onChangeLayer: (layer: MapLayerType) => void;
  mapRef: MutableRefObject<L.Map | null>;
}

export function MapControls({
  following,
  onToggleFollow,
  showTrack,
  onToggleTrack,
  showGarden,
  onToggleGarden,
  showPaths,
  onTogglePaths,
  mapLayer,
  onChangeLayer,
  mapRef,
}: MapControlsProps) {
  const latitude = useGpsStore((s) => s.latitude);
  const longitude = useGpsStore((s) => s.longitude);
  const fixStatus = useGpsStore((s) => s.fixStatus);
  const isRecordingBoundary = useGpsStore((s) => s.isRecordingBoundary);
  const startBoundaryRecording = useGpsStore((s) => s.startBoundaryRecording);
  const stopBoundaryRecording = useGpsStore((s) => s.stopBoundaryRecording);
  const cancelBoundaryRecording = useGpsStore((s) => s.cancelBoundaryRecording);
  const clearTrack = useGpsStore((s) => s.clearTrack);

  const handleCenterOnRobot = () => {
    if (latitude !== null && longitude !== null && mapRef.current) {
      mapRef.current.setView([latitude, longitude], mapRef.current.getZoom(), {
        animate: true,
      });
    }
  };

  const handleBoundaryToggle = async () => {
    if (isRecordingBoundary) {
      const points = stopBoundaryRecording();
      if (points.length >= 3) {
        try {
          await fetch("/api/garden", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Hauptgarten",
              points,
            }),
          });
          toast({
            title: "Gartengrenze gespeichert",
            description: `${points.length} Punkte aufgezeichnet.`,
            variant: "success",
          });
        } catch {
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
        title: "Aufzeichnung gestartet",
        description: "Fahre den Gartenrand ab. Tippe erneut zum Beenden.",
      });
    }
  };

  const fixBadgeVariant: Record<string, "success" | "warning" | "error" | "info" | "secondary"> = {
    no_fix: "error",
    autonomous: "warning",
    dgps: "warning",
    rtk_float: "info",
    rtk_fixed: "success",
  };

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

      {/* Bottom-right: Recording & Layer controls */}
      <div className="absolute bottom-3 right-3 z-[1000] flex flex-col gap-2 items-end">
        {/* Record Boundary */}
        <Button
          size="sm"
          variant={isRecordingBoundary ? "destructive" : "secondary"}
          onClick={handleBoundaryToggle}
          className={cn(
            "shadow-lg",
            isRecordingBoundary && "animate-pulse-record"
          )}
        >
          <Circle
            className={cn(
              "h-4 w-4 mr-1",
              isRecordingBoundary && "fill-current"
            )}
          />
          {isRecordingBoundary ? "Aufnahme stoppen" : "Grenze aufzeichnen"}
        </Button>

        {isRecordingBoundary && (
          <Button
            size="sm"
            variant="outline"
            onClick={cancelBoundaryRecording}
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
          <Trash2 className="h-4 w-4 mr-1" /> Track löschen
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
            variant={showGarden ? "default" : "outline"}
            onClick={onToggleGarden}
            className="shadow-lg h-8 w-8"
            title="Gartengrenze"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current"><polygon points="4,4 20,4 20,20 4,20" strokeWidth="2" stroke="currentColor" fillOpacity="0.3" /></svg>
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
            title="Mähpfade"
          >
            <MapPin className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </>
  );
}
