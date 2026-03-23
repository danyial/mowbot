"use client";

import { useEffect, useRef } from "react";
import { useTeleopStore } from "@/lib/store/teleop-store";
import {
  updateVelocity,
  startCmdVelPublishing,
  stopCmdVelPublishing,
} from "@/lib/ros/publishers";

const DEAD_ZONE = 0.1; // 10% of max radius

export function VirtualJoystick() {
  const containerRef = useRef<HTMLDivElement>(null);
  const maxLinear = useTeleopStore((s) => s.maxLinear);
  const maxAngular = useTeleopStore((s) => s.maxAngular);
  const isLocked = useTeleopStore((s) => s.isLocked);
  const setVelocity = useTeleopStore((s) => s.setVelocity);
  const setActive = useTeleopStore((s) => s.setActive);

  // Use refs for maxLinear/maxAngular so joystick handler always has current values
  const maxLinearRef = useRef(maxLinear);
  const maxAngularRef = useRef(maxAngular);
  useEffect(() => {
    maxLinearRef.current = maxLinear;
  }, [maxLinear]);
  useEffect(() => {
    maxAngularRef.current = maxAngular;
  }, [maxAngular]);

  useEffect(() => {
    if (!containerRef.current || isLocked) return;

    let joystick: ReturnType<typeof import("nipplejs").create> | null = null;

    // Dynamic import because nipplejs accesses `window` on load
    import("nipplejs").then((nipplejs) => {
      if (!containerRef.current) return;

      joystick = nipplejs.default.create({
        zone: containerRef.current,
        mode: "static",
        position: { left: "50%", bottom: "50%" },
        color: "#22c55e",
        size: 150,
        threshold: DEAD_ZONE,
        restJoystick: true,
        restOpacity: 0.5,
      });

      joystick.on("start", () => {
        setActive(true);
        startCmdVelPublishing();
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      joystick.on("move", (_evt: any, data: any) => {
        if (!data?.vector) return;

        // Y-axis -> linear.x (forward/backward)
        // X-axis -> angular.z (rotation, inverted for natural feel)
        const rawLinear: number = data.vector.y;
        const rawAngular: number = -data.vector.x;

        // Apply dead zone
        const linear =
          Math.abs(rawLinear) < DEAD_ZONE
            ? 0
            : rawLinear * maxLinearRef.current;
        const angular =
          Math.abs(rawAngular) < DEAD_ZONE
            ? 0
            : rawAngular * maxAngularRef.current;

        setVelocity(linear, angular);
        updateVelocity(linear, angular);
      });

      joystick.on("end", () => {
        setActive(false);
        setVelocity(0, 0);
        stopCmdVelPublishing();
      });
    });

    return () => {
      if (joystick) {
        joystick.destroy();
      }
    };
  }, [isLocked, setActive, setVelocity]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[200px] touch-none"
      style={{ touchAction: "none" }}
    />
  );
}
