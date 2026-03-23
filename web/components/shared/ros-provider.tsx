"use client";

import { useEffect } from "react";
import { useRosStore } from "@/lib/store/ros-store";
import { useImuStore } from "@/lib/store/imu-store";

/**
 * RosProvider initializes the ROS connection on mount.
 * Topic subscriptions are managed in the ros-store (outside React lifecycle)
 * to avoid issues with React Strict Mode double-mounting.
 */
export function RosProvider({ children }: { children: React.ReactNode }) {
  const init = useRosStore((s) => s.init);
  const imuSetOffset = useImuStore((s) => s.setOffset);
  const imuSetSmoothing = useImuStore((s) => s.setSmoothingFactor);

  useEffect(() => {
    init();

    // Load IMU calibration offset and smoothing from config on app start
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.safety) return;
        if (data.safety.imuRollOffset != null || data.safety.imuPitchOffset != null) {
          imuSetOffset(
            data.safety.imuRollOffset || 0,
            data.safety.imuPitchOffset || 0
          );
        }
        if (data.safety.imuSmoothing != null) {
          imuSetSmoothing(data.safety.imuSmoothing);
        }
      })
      .catch(() => {});
  }, [init, imuSetOffset, imuSetSmoothing]);

  return <>{children}</>;
}
