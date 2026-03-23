"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Map, Globe, Layers } from "lucide-react";
import { GpsStatus } from "@/components/dashboard/gps-status";
import { BatteryGauge } from "@/components/dashboard/battery-gauge";
import { ImuDisplay } from "@/components/dashboard/imu-display";
import { ConnectionStatus } from "@/components/dashboard/connection-badge";
import { SpeedDisplay } from "@/components/dashboard/speed-display";
import { MissionStatus } from "@/components/dashboard/mission-status";
import { Button } from "@/components/ui/button";
import type { MapLayerType } from "@/components/map/robot-map";

const MiniMap = dynamic(() => import("@/components/map/mini-map"), {
  ssr: false,
  loading: () => (
    <div className="h-full rounded-lg bg-card animate-pulse" />
  ),
});

export default function DashboardPage() {
  const [mapLayer, setMapLayer] = useState<MapLayerType>("hybrid");

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <h2 className="text-lg font-semibold shrink-0">Dashboard</h2>

      {/* Status Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 shrink-0">
        <GpsStatus />
        <BatteryGauge />
        <ImuDisplay />
        <ConnectionStatus />
        <SpeedDisplay />
        <MissionStatus />
      </div>

      {/* Mini Map with layer switcher */}
      <div className="relative flex-1 min-h-[200px]">
        <Link href="/map" className="block h-full">
          <div className="rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-colors cursor-pointer h-full">
            <MiniMap layer={mapLayer} />
          </div>
        </Link>

        {/* Layer switcher floating over the map */}
        <div
          className="absolute bottom-2 right-2 z-[10000] flex gap-1 pointer-events-auto"
        >
          <Button
            size="icon"
            variant={mapLayer === "roadmap" ? "default" : "secondary"}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMapLayer("roadmap"); }}
            className="shadow-lg h-7 w-7 pointer-events-auto"
            title="Karte"
          >
            <Map className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant={mapLayer === "satellite" ? "default" : "secondary"}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMapLayer("satellite"); }}
            className="shadow-lg h-7 w-7 pointer-events-auto"
            title="Satellit"
          >
            <Globe className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant={mapLayer === "hybrid" ? "default" : "secondary"}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMapLayer("hybrid"); }}
            className="shadow-lg h-7 w-7 pointer-events-auto"
            title="Hybrid"
          >
            <Layers className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
