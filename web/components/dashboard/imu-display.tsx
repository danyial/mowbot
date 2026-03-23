"use client";

import { Compass, AlertTriangle } from "lucide-react";
import { useImuStore } from "@/lib/store/imu-store";
import { StatusCard } from "./status-card";
import { ValueDisplay } from "@/components/shared/value-display";
import { formatDegrees, formatNumber } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

function vibrationColor(v: number): string {
  if (v < 1.0) return "text-green-500";
  if (v < 3.0) return "text-yellow-500";
  return "text-red-500";
}

function vibrationBarColor(v: number): string {
  if (v < 1.0) return "bg-green-500";
  if (v < 3.0) return "bg-yellow-500";
  return "bg-red-500";
}

export function ImuDisplay() {
  const { roll, pitch, yaw, hasOrientation, vibration, isTilted, lastUpdate } =
    useImuStore();

  const hasData = lastUpdate > 0;

  // Vibration bar: scale 0–5 m/s², clamped
  const vibrationPercent = Math.min(100, (vibration / 5) * 100);

  return (
    <StatusCard
      title="IMU"
      icon={isTilted ? AlertTriangle : Compass}
      iconColor={isTilted ? "text-red-500" : undefined}
    >
      <div className="space-y-3">
        {isTilted && (
          <div className="flex items-center gap-2 text-red-500 text-xs font-medium bg-red-500/10 rounded-md px-2 py-1">
            <AlertTriangle className="h-3 w-3" />
            Kipp-Warnung!
          </div>
        )}

        {/* Roll / Pitch (/ Yaw if orientation available) */}
        <div className={cn("grid gap-2", hasOrientation ? "grid-cols-3" : "grid-cols-2")}>
          <ValueDisplay
            label="Roll"
            value={hasData ? formatDegrees(roll) : "--"}
            valueClassName={Math.abs(roll) > 15 ? "text-red-500" : undefined}
          />
          <ValueDisplay
            label="Pitch"
            value={hasData ? formatDegrees(pitch) : "--"}
            valueClassName={Math.abs(pitch) > 15 ? "text-red-500" : undefined}
          />
          {hasOrientation && (
            <ValueDisplay
              label="Yaw"
              value={hasData ? formatDegrees(yaw) : "--"}
            />
          )}
        </div>

        {/* Vibration */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Vibration</span>
            <span className={cn("text-sm font-mono font-semibold", hasData ? vibrationColor(vibration) : "")}>
              {hasData ? `${formatNumber(vibration, 1)} m/s\u00B2` : "--"}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-200",
                hasData ? vibrationBarColor(vibration) : "bg-secondary"
              )}
              style={{ width: hasData ? `${vibrationPercent}%` : "0%" }}
            />
          </div>
        </div>

        {/* Visual tilt indicator */}
        <div className="flex items-center justify-center h-12">
          <div
            className={cn(
              "w-16 h-8 border-2 rounded transition-transform duration-200",
              isTilted ? "border-red-500" : "border-muted-foreground/30"
            )}
            style={{
              transform: hasData
                ? `rotateX(${-pitch}deg) rotateZ(${roll}deg)`
                : "none",
            }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-1 h-1 rounded-full bg-primary" />
            </div>
          </div>
        </div>

        {!hasOrientation && hasData && (
          <div className="text-[10px] text-muted-foreground text-center">
            Neigung aus Beschleunigung geschätzt
          </div>
        )}
      </div>
    </StatusCard>
  );
}
