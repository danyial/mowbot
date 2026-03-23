"use client";

import { useState, useCallback } from "react";
import { OctagonX, ShieldAlert } from "lucide-react";
import { useTeleopStore } from "@/lib/store/teleop-store";
import { emergencyStop as rosEmergencyStop } from "@/lib/ros/publishers";
import { cn } from "@/lib/utils";

export function EmergencyStop() {
  const { isLocked, emergencyStop, unlock } = useTeleopStore();
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const handlePress = useCallback(() => {
    if (isLocked) {
      if (confirmUnlock) {
        unlock();
        setConfirmUnlock(false);
      } else {
        setConfirmUnlock(true);
        // Reset after 3 seconds
        setTimeout(() => setConfirmUnlock(false), 3000);
      }
    } else {
      emergencyStop();
      rosEmergencyStop();
    }
  }, [isLocked, confirmUnlock, emergencyStop, unlock]);

  return (
    <button
      onClick={handlePress}
      className={cn(
        "w-20 h-20 rounded-full flex flex-col items-center justify-center font-bold text-white transition-all",
        isLocked
          ? confirmUnlock
            ? "bg-yellow-600 hover:bg-yellow-700"
            : "bg-gray-700 hover:bg-gray-600 border-2 border-red-500"
          : "bg-red-600 hover:bg-red-700 active:bg-red-800 animate-pulse-emergency"
      )}
    >
      {isLocked ? (
        confirmUnlock ? (
          <>
            <ShieldAlert className="h-6 w-6" />
            <span className="text-[9px] mt-0.5">2x Tippen</span>
          </>
        ) : (
          <>
            <ShieldAlert className="h-6 w-6" />
            <span className="text-[9px] mt-0.5">Gesperrt</span>
          </>
        )
      ) : (
        <>
          <OctagonX className="h-8 w-8" />
          <span className="text-[9px] mt-0.5">NOT-AUS</span>
        </>
      )}
    </button>
  );
}
