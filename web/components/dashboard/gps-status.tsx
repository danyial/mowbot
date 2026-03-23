"use client";

import { MapPin } from "lucide-react";
import { useGpsStore } from "@/lib/store/gps-store";
import { StatusCard } from "./status-card";
import { Badge } from "@/components/ui/badge";
import { ValueDisplay } from "@/components/shared/value-display";
import { formatCoordinate, formatNumber } from "@/lib/utils/formatting";

const fixBadgeVariant: Record<string, "success" | "warning" | "error" | "info" | "secondary"> = {
  no_fix: "error",
  autonomous: "warning",
  dgps: "warning",
  rtk_float: "info",
  rtk_fixed: "success",
};

const fixLabels: Record<string, string> = {
  no_fix: "No Fix",
  autonomous: "Autonomous",
  dgps: "DGPS",
  rtk_float: "RTK Float",
  rtk_fixed: "RTK Fixed",
};

function formatAccuracy(meters: number): { value: string; unit: string; color: string } {
  if (meters < 0) return { value: "--", unit: "", color: "" };
  const cm = meters * 100;
  if (cm < 5) return { value: cm.toFixed(1), unit: "cm", color: "text-green-500" };
  if (cm < 50) return { value: cm.toFixed(1), unit: "cm", color: "text-yellow-500" };
  if (cm < 100) return { value: cm.toFixed(0), unit: "cm", color: "text-red-500" };
  return { value: (meters).toFixed(2), unit: "m", color: "text-red-500" };
}

export function GpsStatus() {
  const { latitude, longitude, fixStatus, accuracy, lastUpdate } = useGpsStore();

  const isStale = Date.now() - lastUpdate > 5000;
  const acc = formatAccuracy(accuracy);

  return (
    <StatusCard
      title="GPS"
      icon={MapPin}
      iconColor={fixStatus === "rtk_fixed" ? "text-green-500" : undefined}
    >
      <div className="space-y-3">
        <Badge variant={fixBadgeVariant[fixStatus] || "secondary"}>
          {fixLabels[fixStatus] || "Unknown"}
        </Badge>

        <div className="grid grid-cols-2 gap-2">
          <ValueDisplay
            label="Lat"
            value={latitude !== null ? formatCoordinate(latitude) : "--"}
          />
          <ValueDisplay
            label="Lon"
            value={longitude !== null ? formatCoordinate(longitude) : "--"}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ValueDisplay
            label="Genauigkeit"
            value={acc.value}
            unit={acc.unit}
            valueClassName={acc.color}
          />
          <ValueDisplay
            label="Letzter Fix"
            value={
              lastUpdate > 0
                ? isStale
                  ? "Stale"
                  : `${((Date.now() - lastUpdate) / 1000).toFixed(0)}s`
                : "--"
            }
            valueClassName={isStale ? "text-yellow-500" : undefined}
          />
        </div>
      </div>
    </StatusCard>
  );
}
