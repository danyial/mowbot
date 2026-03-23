"use client";

import { VirtualJoystick } from "@/components/teleop/virtual-joystick";
import { EmergencyStop } from "@/components/teleop/emergency-stop";
import { SpeedSlider } from "@/components/teleop/speed-slider";
import { MotorStatus } from "@/components/teleop/motor-status";
import { KeyboardControls } from "@/components/teleop/keyboard-controls";
import { useGpsStore } from "@/lib/store/gps-store";
import { useBatteryStore } from "@/lib/store/battery-store";
import { useRosStore } from "@/lib/store/ros-store";
import { Badge } from "@/components/ui/badge";
import { formatVoltage } from "@/lib/utils/formatting";

const fixBadgeVariant: Record<string, "success" | "warning" | "error" | "info" | "secondary"> = {
  no_fix: "error",
  autonomous: "warning",
  dgps: "warning",
  rtk_float: "info",
  rtk_fixed: "success",
};

export default function TeleopPage() {
  const fixStatus = useGpsStore((s) => s.fixStatus);
  const voltage = useBatteryStore((s) => s.voltage);
  const connected = useRosStore((s) => s.connected);

  return (
    <div className="h-full flex flex-col overflow-hidden no-scrollbar">
      <KeyboardControls />

      {/* Compact Status Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Badge variant={fixBadgeVariant[fixStatus] || "secondary"} className="text-[10px]">
            {fixStatus.replace("_", " ").toUpperCase()}
          </Badge>
          {voltage > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {formatVoltage(voltage)}
            </Badge>
          )}
        </div>
        <Badge
          variant={connected ? "success" : "error"}
          className="text-[10px]"
        >
          {connected ? "Verbunden" : "Getrennt"}
        </Badge>
      </div>

      {/* Main teleop area */}
      <div className="flex-1 flex relative min-h-0">
        {/* Speed slider - left side */}
        <div className="w-16 flex items-center justify-center border-r border-border py-4">
          <SpeedSlider />
        </div>

        {/* Joystick area - center */}
        <div className="flex-1 flex flex-col">
          {/* Camera placeholder */}
          <div className="h-24 border-b border-border flex items-center justify-center text-xs text-muted-foreground shrink-0">
            Kamera-Feed (Platzhalter)
          </div>

          {/* Joystick */}
          <div className="flex-1 min-h-[250px]">
            <VirtualJoystick />
          </div>

          {/* Motor status */}
          <div className="border-t border-border p-2 shrink-0">
            <MotorStatus />
          </div>
        </div>

        {/* Emergency stop - right side */}
        <div className="w-24 flex items-start justify-center pt-4 border-l border-border">
          <EmergencyStop />
        </div>
      </div>

      {/* Desktop keyboard hint */}
      <div className="hidden md:flex items-center justify-center py-1 border-t border-border text-[10px] text-muted-foreground gap-4 shrink-0">
        <span>WASD / Pfeiltasten zum Steuern</span>
        <span>Shift = halbe Geschwindigkeit</span>
      </div>
    </div>
  );
}
