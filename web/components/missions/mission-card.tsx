"use client";

import {
  Play,
  Pause,
  Square,
  Trash2,
  Home,
  RotateCcw,
} from "lucide-react";
import type { Mission } from "@/lib/types/mission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useMissionStore } from "@/lib/store/mission-store";
import { formatDuration, formatDistance } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

const statusLabels: Record<string, string> = {
  planned: "Geplant",
  running: "Läuft",
  paused: "Pausiert",
  completed: "Abgeschlossen",
  aborted: "Abgebrochen",
};

const statusVariant: Record<string, "info" | "success" | "warning" | "error" | "secondary"> = {
  planned: "info",
  running: "success",
  paused: "warning",
  completed: "secondary",
  aborted: "error",
};

const patternLabels: Record<string, string> = {
  parallel: "Parallel (Streifen)",
  spiral: "Spiral",
  zigzag: "Zickzack",
};

interface MissionCardProps {
  mission: Mission;
}

export function MissionCard({ mission }: MissionCardProps) {
  const { startMission, pauseMission, resumeMission, stopMission, returnHome, deleteMission } =
    useMissionStore();

  const isActive = mission.status === "running" || mission.status === "paused";

  return (
    <Card className={cn(isActive && "border-primary/50")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{mission.name}</CardTitle>
          <Badge variant={statusVariant[mission.status]}>
            {statusLabels[mission.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="block font-medium text-foreground">
              {patternLabels[mission.pattern]}
            </span>
            Muster
          </div>
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
        </div>

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
                mission.status === "running" ? "bg-green-500" : "bg-yellow-500"
              }
            />
          </div>
        )}

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
                <Trash2 className="h-3 w-3 mr-1" /> Löschen
              </Button>
            </>
          )}

          {mission.status === "running" && (
            <>
              <Button size="sm" variant="secondary" onClick={pauseMission}>
                <Pause className="h-3 w-3 mr-1" /> Pause
              </Button>
              <Button size="sm" variant="destructive" onClick={stopMission}>
                <Square className="h-3 w-3 mr-1" /> Stop
              </Button>
              <Button size="sm" variant="outline" onClick={returnHome}>
                <Home className="h-3 w-3 mr-1" /> Home
              </Button>
            </>
          )}

          {mission.status === "paused" && (
            <>
              <Button size="sm" onClick={resumeMission}>
                <RotateCcw className="h-3 w-3 mr-1" /> Fortsetzen
              </Button>
              <Button size="sm" variant="destructive" onClick={stopMission}>
                <Square className="h-3 w-3 mr-1" /> Stop
              </Button>
            </>
          )}

          {(mission.status === "completed" || mission.status === "aborted") && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteMission(mission.id)}
            >
              <Trash2 className="h-3 w-3 mr-1" /> Löschen
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
