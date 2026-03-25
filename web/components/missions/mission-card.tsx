"use client";

import dynamic from "next/dynamic";
import { useState, useCallback } from "react";
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
  Monitor,
} from "lucide-react";
import type { Mission } from "@/lib/types/mission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { useMissionStore } from "@/lib/store/mission-store";
import { useZoneStore } from "@/lib/store/zone-store";
import {
  formatDuration,
  formatDistance,
  formatArea,
} from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

const MissionPreviewMap = dynamic(() => import("./mission-preview-map"), {
  ssr: false,
  loading: () => (
    <div className="h-[28rem] bg-muted animate-pulse rounded-md" />
  ),
});

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
    resumeAbortedMission,
    replanMission,
  } = useMissionStore();
  const zones = useZoneStore((s) => s.zones);

  // Simulation state
  const [simulating, setSimulating] = useState(false);
  const [simPaused, setSimPaused] = useState(false);
  const [simSpeed, setSimSpeed] = useState(5);
  const [simProgress, setSimProgress] = useState(0);
  const [simTimeElapsed, setSimTimeElapsed] = useState(0);

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

  const handleStartSim = () => {
    setSimulating(true);
    setSimPaused(false);
    setSimProgress(0);
    setSimTimeElapsed(0);
    // Force expand
    if (!expanded && onToggleExpand) {
      onToggleExpand();
    }
  };

  const handleStopSim = () => {
    setSimulating(false);
    setSimPaused(false);
    setSimProgress(0);
    setSimTimeElapsed(0);
  };

  const handleSimProgress = useCallback(
    (progress: number, timeElapsed: number) => {
      setSimProgress(progress);
      setSimTimeElapsed(timeElapsed);
    },
    []
  );

  const handleSimEnd = useCallback(() => {
    setSimPaused(true); // Pause at end so user can see the result
  }, []);

  // Force expanded when simulating
  const isExpanded = expanded || simulating;

  return (
    <Card className={cn(isActive && "border-primary/50", simulating && "border-green-500/50")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-2 text-left flex-1 min-w-0"
            onClick={onToggleExpand}
          >
            <CardTitle className="text-sm truncate">
              {mission.name}
            </CardTitle>
            {onToggleExpand &&
              (isExpanded ? (
                <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              ))}
          </button>
          {simulating && (
            <Badge variant="success" className="mr-2">
              Simulation
            </Badge>
          )}
          <Badge variant={statusVariant[mission.status]}>
            {statusLabels[mission.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Compact summary */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          <span className="truncate">{zoneNames}</span>
          <span className="ml-auto flex-shrink-0">
            {formatDistance(mission.estimatedDistance)} &middot;{" "}
            {formatDuration(mission.estimatedDuration)}
          </span>
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

        {/* Expanded: Horizontal layout — Details left, Map right */}
        {isExpanded && (
          <div className="flex gap-3">
            {/* Left: Details */}
            <div className="w-2/5 flex-shrink-0 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div>
                  <span className="text-muted-foreground">Strecke</span>
                  <div className="font-medium">
                    {formatDistance(mission.estimatedDistance)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Dauer</span>
                  <div className="font-medium">
                    {formatDuration(mission.estimatedDuration)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Turns</span>
                  <div className="font-medium">{mission.turns ?? 0}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Perimeter</span>
                  <div className="font-medium">
                    {mission.perimeterPasses ?? 0} Bahnen
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Aussenbahn</span>
                  <div className="font-medium">
                    {formatArea(mission.perimeterArea ?? 0)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Innen</span>
                  <div className="font-medium">
                    {formatArea(mission.innerArea ?? 0)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Winkel</span>
                  <div className="font-medium">{mission.angle ?? 0}°</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Versatz</span>
                  <div className="font-medium">
                    +{mission.angleIncrement ?? 0}° / Fahrt
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {mission.pathPoints?.length ?? 0} Wegpunkte
              </div>
            </div>

            {/* Right: Map */}
            <div className="flex-1 min-w-0">
              {mission.pathPoints.length > 0 ? (
                <MissionPreviewMap
                  mission={mission}
                  simulating={simulating}
                  simSpeed={simSpeed}
                  simPaused={simPaused}
                  onSimProgress={handleSimProgress}
                  onSimEnd={handleSimEnd}
                />
              ) : (
                <div className="h-[28rem] flex items-center justify-center text-xs text-muted-foreground border border-dashed rounded-md">
                  Kein Pfad berechnet
                </div>
              )}
            </div>
          </div>
        )}

        {/* Simulation controls */}
        {simulating && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  Simulation {simProgress >= 1 ? "abgeschlossen" : ""}
                </span>
                <span>
                  {formatDuration(simTimeElapsed)} /{" "}
                  {formatDuration(mission.estimatedDuration)}
                </span>
              </div>
              <Progress
                value={simProgress * 100}
                className="h-2"
                indicatorClassName="bg-green-500"
              />
              <div className="text-right text-[10px] text-muted-foreground">
                {Math.round(simProgress * 100)}%
              </div>
            </div>

            {/* Controls row */}
            <div className="flex items-center gap-2">
              {simPaused ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSimPaused(false)}
                >
                  <Play className="h-3 w-3 mr-1" /> Weiter
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSimPaused(true)}
                >
                  <Pause className="h-3 w-3 mr-1" /> Pause
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStopSim}
              >
                <Square className="h-3 w-3 mr-1" /> Stop
              </Button>

              {/* Speed slider */}
              <div className="flex-1 flex items-center gap-2 ml-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {simSpeed}x
                </span>
                <Slider
                  min={1}
                  max={10}
                  step={1}
                  value={[simSpeed]}
                  onValueChange={([v]) => setSimSpeed(v)}
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!simulating && (
          <div className="flex gap-2 flex-wrap">
            {mission.status === "planned" && (
              <>
                <Button
                  size="sm"
                  onClick={() => startMission(mission.id)}
                >
                  <Play className="h-3 w-3 mr-1" /> Starten
                </Button>
                {mission.pathPoints.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleStartSim}
                  >
                    <Monitor className="h-3 w-3 mr-1" /> Simulieren
                  </Button>
                )}
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
                  onClick={() => pauseMission(mission.id)}
                >
                  <Pause className="h-3 w-3 mr-1" /> Pause
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => stopMission(mission.id)}
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
                <Button
                  size="sm"
                  onClick={() => resumeMission(mission.id)}
                >
                  <RotateCcw className="h-3 w-3 mr-1" /> Fortsetzen
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => stopMission(mission.id)}
                >
                  <Square className="h-3 w-3 mr-1" /> Stop
                </Button>
              </>
            )}

            {mission.status === "aborted" && (
              <>
                <Button
                  size="sm"
                  onClick={() => resumeAbortedMission(mission.id)}
                >
                  <Play className="h-3 w-3 mr-1" /> Weitermachen
                </Button>
                {mission.pathPoints.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleStartSim}
                  >
                    <Monitor className="h-3 w-3 mr-1" /> Simulieren
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => replanMission(mission.id)}
                >
                  <RotateCcw className="h-3 w-3 mr-1" /> Neu planen
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

            {mission.status === "completed" && (
              <>
                {mission.pathPoints.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleStartSim}
                  >
                    <Monitor className="h-3 w-3 mr-1" /> Simulieren
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => replanMission(mission.id)}
                >
                  <RotateCcw className="h-3 w-3 mr-1" /> Neu planen
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
