"use client";

import { useEffect } from "react";
import { useMissionStore } from "@/lib/store/mission-store";
import { MissionCard } from "./mission-card";

export function MissionList() {
  const { missions, isLoading, fetchMissions } = useMissionStore();

  useEffect(() => {
    fetchMissions();
  }, [fetchMissions]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-40 rounded-lg bg-card animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (missions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">Keine Aufträge vorhanden</p>
        <p className="text-sm mt-1">
          Erstelle einen neuen Mäh-Auftrag um loszulegen.
        </p>
      </div>
    );
  }

  // Sort: active first, then by creation date (newest first)
  const sorted = [...missions].sort((a, b) => {
    const activeStates = ["running", "paused"];
    const aActive = activeStates.includes(a.status) ? 0 : 1;
    const bActive = activeStates.includes(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-4">
      {sorted.map((mission) => (
        <MissionCard key={mission.id} mission={mission} />
      ))}
    </div>
  );
}
