"use client";

import { Gauge } from "lucide-react";
import { useOdometryStore } from "@/lib/store/odometry-store";
import { StatusCard } from "./status-card";
import { ValueDisplay } from "@/components/shared/value-display";
import { formatNumber } from "@/lib/utils/formatting";

export function SpeedDisplay() {
  const { linearSpeed, angularSpeed, lastUpdate } = useOdometryStore();
  const hasData = lastUpdate > 0;

  return (
    <StatusCard title="Geschwindigkeit" icon={Gauge}>
      <div className="grid grid-cols-2 gap-4">
        <ValueDisplay
          label="Linear"
          value={hasData ? formatNumber(linearSpeed, 2) : "--"}
          unit="m/s"
        />
        <ValueDisplay
          label="Drehrate"
          value={hasData ? formatNumber(angularSpeed, 2) : "--"}
          unit="rad/s"
        />
      </div>
    </StatusCard>
  );
}
