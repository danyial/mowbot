"use client";

import { useEffect, useCallback, useRef } from "react";
import { useTeleopStore } from "@/lib/store/teleop-store";
import {
  updateVelocity,
  startCmdVelPublishing,
  stopCmdVelPublishing,
} from "@/lib/ros/publishers";

const MOVEMENT_KEYS = new Set(["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function KeyboardControls() {
  const maxLinear = useTeleopStore((s) => s.maxLinear);
  const maxAngular = useTeleopStore((s) => s.maxAngular);
  const isLocked = useTeleopStore((s) => s.isLocked);
  const setVelocity = useTeleopStore((s) => s.setVelocity);
  const setActive = useTeleopStore((s) => s.setActive);

  const keysPressed = useRef(new Set<string>());
  const isPublishing = useRef(false);

  const updateFromKeys = useCallback(() => {
    const keys = keysPressed.current;
    let linear = 0;
    let angular = 0;

    if (keys.has("w") || keys.has("ArrowUp")) linear += 1;
    if (keys.has("s") || keys.has("ArrowDown")) linear -= 1;
    if (keys.has("a") || keys.has("ArrowLeft")) angular += 1;
    if (keys.has("d") || keys.has("ArrowRight")) angular -= 1;

    // Shift for half speed
    const speedMultiplier = keys.has("Shift") ? 0.5 : 1.0;

    const finalLinear = linear * maxLinear * speedMultiplier;
    const finalAngular = angular * maxAngular * speedMultiplier;

    setVelocity(finalLinear, finalAngular);
    updateVelocity(finalLinear, finalAngular);
  }, [maxLinear, maxAngular, setVelocity]);

  useEffect(() => {
    if (isLocked) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key;

      if (MOVEMENT_KEYS.has(key) || key === "Shift") {
        e.preventDefault();
        keysPressed.current.add(key);

        if (!isPublishing.current) {
          isPublishing.current = true;
          setActive(true);
          startCmdVelPublishing();
        }

        updateFromKeys();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key;
      keysPressed.current.delete(key);

      if (MOVEMENT_KEYS.has(key) || key === "Shift") {
        updateFromKeys();
      }

      // Stop publishing when no movement keys are pressed
      const hasMovement = Array.from(keysPressed.current).some((k) =>
        MOVEMENT_KEYS.has(k)
      );
      if (!hasMovement && isPublishing.current) {
        isPublishing.current = false;
        setActive(false);
        stopCmdVelPublishing();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (isPublishing.current) {
        stopCmdVelPublishing();
        isPublishing.current = false;
      }
    };
  }, [isLocked, setActive, updateFromKeys]);

  return null; // This component only handles keyboard events
}
