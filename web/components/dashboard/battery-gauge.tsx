"use client";

import { Battery, BatteryLow, BatteryMedium, BatteryFull } from "lucide-react";
import { useBatteryStore } from "@/lib/store/battery-store";
import { StatusCard } from "./status-card";
import { formatVoltage, voltageToPercent, getBatteryColor } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

export function BatteryGauge() {
  const { voltage, lastUpdate } = useBatteryStore();
  const percent = voltageToPercent(voltage);
  const colorClass = getBatteryColor(voltage);

  const BatteryIcon =
    percent > 60 ? BatteryFull : percent > 25 ? BatteryMedium : BatteryLow;

  // Circular gauge SVG
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <StatusCard
      title="Akku"
      icon={Battery}
      iconColor={colorClass}
    >
      <div className="flex items-center gap-4">
        {/* Circular gauge */}
        <div className="relative w-24 h-24 shrink-0">
          <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="hsl(var(--secondary))"
              strokeWidth="8"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={
                voltage > 11.4
                  ? "#22c55e"
                  : voltage > 10.8
                    ? "#eab308"
                    : "#ef4444"
              }
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-lg font-bold font-mono", colorClass)}>
              {lastUpdate > 0 ? `${Math.round(percent)}%` : "--"}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <BatteryIcon className={cn("h-5 w-5", colorClass)} />
            <span className={cn("text-xl font-mono font-bold", colorClass)}>
              {lastUpdate > 0 ? formatVoltage(voltage) : "--"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            3S LiPo (9.0V - 12.6V)
          </div>
          {voltage > 0 && voltage < 10.8 && (
            <div className="text-xs text-red-500 font-medium">
              Niedrige Spannung!
            </div>
          )}
        </div>
      </div>
    </StatusCard>
  );
}
