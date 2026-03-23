import { Quaternion } from "@/lib/types/ros-messages";

export interface EulerAngles {
  roll: number; // degrees
  pitch: number; // degrees
  yaw: number; // degrees
}

/**
 * Convert quaternion to Euler angles (Roll, Pitch, Yaw) in degrees
 */
export function quaternionToEuler(q: Quaternion): EulerAngles {
  const roll = Math.atan2(
    2 * (q.w * q.x + q.y * q.z),
    1 - 2 * (q.x * q.x + q.y * q.y)
  );
  const sinp = 2 * (q.w * q.y - q.z * q.x);
  const pitch =
    Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);
  const yaw = Math.atan2(
    2 * (q.w * q.z + q.x * q.y),
    1 - 2 * (q.y * q.y + q.z * q.z)
  );

  return {
    roll: roll * (180 / Math.PI),
    pitch: pitch * (180 / Math.PI),
    yaw: yaw * (180 / Math.PI),
  };
}

/**
 * Get heading in degrees (0-360) from yaw
 */
export function yawToHeading(yawDeg: number): number {
  let heading = -yawDeg + 90; // Convert from math convention to compass
  if (heading < 0) heading += 360;
  if (heading >= 360) heading -= 360;
  return heading;
}
