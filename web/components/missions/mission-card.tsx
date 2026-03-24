"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  Play,
  Pause,
  Square,
  Trash2,
  Home,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  MapPin,
} from "lucide-react";
import type { Mission } from "@/lib/types/mission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useMissionStore } from "@/lib/store/mission-store";
import { useZoneStore } from "@/lib/store/zone-store";
import { formatDuration, formatDistance } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

const MissionPreviewMap = dynamic(
  () => import("./mission-preview-map"),
  { ssr: false, loading: () => <div className="h-48 bg-muted animate-pulse rounded-md" /> }
);

const statusLabels: Record<string, string> = {
  planned: "Geplant",
  running: "Laeuft",
  paused: "Pausiert",
  completed: "Abgeschlossen",
  aborted: "Abgebrochen",
};

const statusVariant: Record<
  string,
  "info" | "success" | "warning" | "error" | "secondary"
> = {
  planned: "info",
  running: "success",
  paused: "warning",
  completed: "secondary",
  aborted: "error",
};

interface MissionCardProps {
  mission: Mission;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function MissionCard({
  mission,
  expanded = false,
  onToggleExpand,
}: MissionCardProps) {
  const {
    startMission,
    pauseMission,
    resumeMission,
    stopMission,
    returnHome,
    deleteMission,
  } = useMissionStore();
  const zones = useZoneStore((s) => s.zones);

  const isActive =
    mission.status === "running" || mission.status === "paused";

  // Resolve zone names
  const isAll =
    mission.zoneIds?.length === 1 && mission.zoneIds[0] === "all";
  const zoneNames = isAll
    ? "Alle Zonen"
    : (mission.zoneIds || [])
        .map((id) => zones.find((z) => z.id === id)?.properties.name)
        .filter(Boolean)
        .join(", ") || "Unbekannt";

  return (
    <Card className={cn(isActive && "border-primary/50")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-2 text-left flex-1 min-w-0"
            onClick={onToggleExpand}
          >
            <CardTitle className="text-sm truncate">{mission.name}</CardTitle>
            {onToggleExpand && (
              expanded ? (
                <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              )
            )}
          </button>
          <Badge variant={statusVariant[mission.status]}>
            {statusLabels[mission.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Info grid */}
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="block font-medium text-foreground">
              {formatDistance(mission.estimatedDistance)}
            </span>
            Strecke
          </div>
          <div>
            <span className="block font-medium text-foreground">
              {formatDuration(mission.estimatedDuration)}
            </span>
            Dauer
          </div>
          <div>
            <span className="block font-medium text-foreground">
              {mission.perimeterPasses ?? 0} Bahnen
            </span>
            Perimeter
          </div>
        </div>

        {/* Zone info */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          <span className="truncate">{zoneNames}</span>
          {mission.angle != null && (
            <span className="ml-auto flex-shrink-0">
              {mission.angle}° (+{mission.angleIncrement ?? 0}°)
            </span>
          )}
        </div>

        {/* Progress bar for active missions */}
        {isActive && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Fortschritt</span>
              <span>{Math.round(mission.progress)}%</span>
            </div>
            <Progress
              value={mission.progress}
              className="h-2"
              indicatorClassName={
                mission.status === "running"
                  ? "bg-green-500"
                  : "bg-yellow-500"
              }
            />
          </div>
        )}

        {/* Expanded: Map preview */}
        {expanded && mission.pathPoints.length > 0 && (
          <MissionPreviewMap mission={mission} />
        )}
        {expanded && mission.pathPoints.length === 0 && (
          <div className="h-24 flex items-center justify-center text-xs text-muted-foreground border border-dashed rounded-md">
            Kein Pfad berechnet
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {mission.status === "planned" && (
            <>
              <Button
                size="sm"
                onClick={() => startMission(mission.id)}
              >
                <Play className="h-3 w-3 mr-1" /> Starten
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteMission(mission.id)}
              >
                <Trash2 className="h-3 w-3 mr-1" /> Loeschen
              </Button>
            </>
          )}

          {mission.status === "running" && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={pauseMission}
              >
                <Pause className="h-3 w-3 mr-1" /> Pause
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={stopMission}
              >
                <Square className="h-3 w-3 mr-1" /> Stop
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={returnHome}
              >
                <Home className="h-3 w-3 mr-1" /> Home
              </Button>
            </>
          )}

          {mission.status === "paused" && (
            <>
              <Button size="sm" onClick={resumeMission}>
                <RotateCcw className="h-3 w-3 mr-1" /> Fortsetzen
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={stopMission}
              >
                <Square className="h-3 w-3 mr-1" /> Stop
              </Button>
            </>
          )}

          {(mission.status === "completed" ||
            mission.status === "aborted") && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteMission(mission.id)}
            >
              <Trash2 className="h-3 w-3 mr-1" /> Loeschen
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
