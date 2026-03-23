"use client";

import { useEffect, useState } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";
import { useGpsStore } from "@/lib/store/gps-store";
import { useImuStore } from "@/lib/store/imu-store";
import { yawToHeading } from "@/lib/utils/quaternion";

function createRobotIcon(heading: number): L.DivIcon {
  return L.divIcon({
    className: "robot-marker",
    html: `
      <div style="
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: rotate(${heading}deg);
      ">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L4 20h16L12 2z" fill="#22c55e" stroke="#166534" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export function RobotMarker() {
  const latitude = useGpsStore((s) => s.latitude);
  const longitude = useGpsStore((s) => s.longitude);
  const yaw = useImuStore((s) => s.yaw);
  const [icon, setIcon] = useState<L.DivIcon>(() => createRobotIcon(0));

  useEffect(() => {
    const heading = yawToHeading(yaw);
    setIcon(createRobotIcon(heading));
  }, [yaw]);

  if (latitude === null || longitude === null) return null;

  return <Marker position={[latitude, longitude]} icon={icon} />;
}
