"use client";

import { useTeleopStore } from "@/lib/store/teleop-store";
import { useOdometryStore } from "@/lib/store/odometry-store";
import { formatNumber } from "@/lib/utils/formatting";

export function MotorStatus() {
  const linearX = useTeleopStore((s) => s.linearX);
  const angularZ = useTeleopStore((s) => s.angularZ);
  const isActive = useTeleopStore((s) => s.isActive);
  const actualLinear = useOdometryStore((s) => s.linearSpeed);
  const actualAngular = useOdometryStore((s) => s.angularSpeed);

  return (
    <div className="grid grid-cols-2 gap-2 text-center">
      <div>
        <div className="text-xs text-muted-foreground">Cmd Lin</div>
        <div className="text-sm font-mono font-semibold">
          {formatNumber(linearX, 2)}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Cmd Ang</div>
        <div className="text-sm font-mono font-semibold">
          {formatNumber(angularZ, 2)}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Ist Lin</div>
        <div className="text-sm font-mono font-semibold">
          {formatNumber(actualLinear, 2)}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Ist Ang</div>
        <div className="text-sm font-mono font-semibold">
          {formatNumber(actualAngular, 2)}
        </div>
      </div>
      {isActive && (
        <div className="col-span-2 text-xs text-green-500 font-medium">
          Joystick aktiv
        </div>
      )}
    </div>
  );
}
