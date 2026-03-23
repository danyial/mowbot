// ROS2 Message TypeScript Types

export interface Header {
  stamp: {
    sec: number;
    nanosec: number;
  };
  frame_id: string;
}

// sensor_msgs/NavSatFix
export interface NavSatFix {
  header: Header;
  status: {
    status: number; // -1=NO_FIX, 0=FIX, 1=SBAS, 2=GBAS
    service: number;
  };
  latitude: number;
  longitude: number;
  altitude: number;
  position_covariance: number[];
  position_covariance_type: number; // 0=UNKNOWN, 1=APPROX, 2=DIAGONAL, 3=KNOWN
}

// sensor_msgs/Imu
export interface ImuMessage {
  header: Header;
  orientation: Quaternion;
  orientation_covariance: number[];
  angular_velocity: Vector3;
  angular_velocity_covariance: number[];
  linear_acceleration: Vector3;
  linear_acceleration_covariance: number[];
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

// geometry_msgs/Twist
export interface Twist {
  linear: Vector3;
  angular: Vector3;
}

// nav_msgs/Odometry
export interface Odometry {
  header: Header;
  child_frame_id: string;
  pose: {
    pose: {
      position: Vector3;
      orientation: Quaternion;
    };
    covariance: number[];
  };
  twist: {
    twist: Twist;
    covariance: number[];
  };
}

// std_msgs/Float32
export interface Float32 {
  data: number;
}

// std_msgs/String
export interface StringMsg {
  data: string;
}

// diagnostic_msgs/DiagnosticArray
export interface DiagnosticArray {
  header: Header;
  status: DiagnosticStatus[];
}

export interface DiagnosticStatus {
  level: number; // 0=OK, 1=WARN, 2=ERROR, 3=STALE
  name: string;
  message: string;
  hardware_id: string;
  values: { key: string; value: string }[];
}

// Custom Mower Status (JSON in std_msgs/String)
export interface MowerStatus {
  state: "idle" | "mowing" | "paused" | "returning" | "error";
  mission_id: string | null;
  progress: number; // 0-100
  distance_traveled: number; // meters
  time_elapsed: number; // seconds
  error_message: string | null;
}

// Custom Mower Command (JSON in std_msgs/String)
export interface MowerCommand {
  action:
    | "start_mission"
    | "pause_mission"
    | "resume_mission"
    | "stop_mission"
    | "return_home"
    | "emergency_stop";
  mission_id?: string;
}

// Fix status mapping
export type FixStatus =
  | "no_fix"
  | "autonomous"
  | "dgps"
  | "rtk_float"
  | "rtk_fixed";

export const FIX_STATUS_MAP: Record<number, FixStatus> = {
  [-1]: "no_fix",
  [0]: "autonomous",
  [1]: "dgps",
  [2]: "rtk_float",
};

export function getFixStatus(
  status: number,
  covarianceType: number
): FixStatus {
  if (covarianceType === 3 && status >= 0) return "rtk_fixed";
  return FIX_STATUS_MAP[status] ?? "no_fix";
}
