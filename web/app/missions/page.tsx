"use client";

import { MissionList } from "@/components/missions/mission-list";
import { CreateMission } from "@/components/missions/create-mission";

export default function MissionsPage() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mäh-Aufträge</h2>
        <CreateMission />
      </div>
      <MissionList />
    </div>
  );
}
