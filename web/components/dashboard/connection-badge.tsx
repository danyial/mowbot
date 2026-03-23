"use client";

import { Wifi } from "lucide-react";
import { useRosStore } from "@/lib/store/ros-store";
import { useGpsStore } from "@/lib/store/gps-store";
import { useImuStore } from "@/lib/store/imu-store";
import { useBatteryStore } from "@/lib/store/battery-store";
import { StatusCard } from "./status-card";
import { RosIndicator } from "@/components/shared/ros-indicator";

export function ConnectionStatus() {
  const { connected, status, lastError } = useRosStore();
  const gpsLastUpdate = useGpsStore((s) => s.lastUpdate);
  const imuLastUpdate = useImuStore((s) => s.lastUpdate);
  const batteryLastUpdate = useBatteryStore((s) => s.lastUpdate);

  const now = Date.now();
  const gpsActive = now - gpsLastUpdate < 3000;
  const imuActive = now - imuLastUpdate < 3000;
  const batteryActive = now - batteryLastUpdate < 5000;

  return (
    <StatusCard
      title="Verbindung"
      icon={Wifi}
      iconColor={connected ? "text-green-500" : "text-red-500"}
    >
      <div className="space-y-2">
        <RosIndicator
          active={connected}
          label={
            status === "connected"
              ? "rosbridge verbunden"
              : status === "reconnecting"
                ? "Verbinde erneut..."
                : "Getrennt"
          }
        />
        <RosIndicator active={gpsActive} label="GPS (/fix)" />
        <RosIndicator active={imuActive} label="IMU (/imu)" />
        <RosIndicator active={batteryActive} label="Akku (/battery_voltage)" />

        {lastError && (
          <div className="text-xs text-red-500 mt-2 truncate">
            {lastError}
          </div>
        )}
      </div>
    </StatusCard>
  );
}
