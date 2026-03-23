"use client";

import { ClipboardList, Pause, Square, Home } from "lucide-react";
import { useMissionStore } from "@/lib/store/mission-store";
import { StatusCard } from "./status-card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const statusLabels: Record<string, string> = {
  planned: "Geplant",
  running: "Läuft",
  paused: "Pausiert",
  completed: "Abgeschlossen",
  aborted: "Abgebrochen",
};

const statusColors: Record<string, string> = {
  planned: "text-blue-400",
  running: "text-green-400",
  paused: "text-yellow-400",
  completed: "text-muted-foreground",
  aborted: "text-red-400",
};

export function MissionStatus() {
  const { missions, activeMission, pauseMission, stopMission, returnHome } =
    useMissionStore();
  const active = missions.find((m) => m.id === activeMission);

  return (
    <StatusCard title="Mission" icon={ClipboardList}>
      {active ? (
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">{active.name}</div>
            <div className={`text-xs ${statusColors[active.status]}`}>
              {statusLabels[active.status]}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Fortschritt</span>
              <span>{Math.round(active.progress)}%</span>
            </div>
            <Progress
              value={active.progress}
              className="h-2"
              indicatorClassName={
                active.status === "running"
                  ? "bg-green-500"
                  : active.status === "paused"
                    ? "bg-yellow-500"
                    : undefined
              }
            />
          </div>

          <div className="flex gap-2">
            {active.status === "running" && (
              <Button size="sm" variant="secondary" onClick={pauseMission}>
                <Pause className="h-3 w-3 mr-1" /> Pause
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={stopMission}>
              <Square className="h-3 w-3 mr-1" /> Stop
            </Button>
            <Button size="sm" variant="outline" onClick={returnHome}>
              <Home className="h-3 w-3 mr-1" /> Home
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          Kein aktiver Auftrag
        </div>
      )}
    </StatusCard>
  );
}
