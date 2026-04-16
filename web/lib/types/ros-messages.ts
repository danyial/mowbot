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

// geometry_msgs/PoseWithCovarianceStamped — Phase 7 FUSE-03 (/pose from slam_toolbox)
// 6x6 row-major covariance: [x, y, z, roll, pitch, yaw] × same — yaw-yaw entry is index 35 (5*6+5).
export interface PoseWithCovarianceStamped {
  header: Header;
  pose: {
    pose: {
      position: Vector3;
      orientation: Quaternion;
    };
    covariance: number[]; // 36 elements, 6x6 row-major
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

/**
 * GGA field 6 (fix quality) → canonical fix status.
 *   0 = invalid, 1 = GPS SPS (autonomous), 2 = DGPS, 3 = PPS,
 *   4 = RTK Fixed, 5 = RTK Float, 6 = Dead Reckoning,
 *   7 = Manual, 8 = Simulator
 * This is the authoritative source — /fix (sensor_msgs/NavSatFix) collapses
 * 4 and 5 both into NavSatStatus.status=2, which is why we needed a raw NMEA
 * path to recover the Fixed/Float distinction (Phase 7 follow-up).
 */
export const GGA_QUALITY_TO_FIX_STATUS: Record<number, FixStatus> = {
  0: "no_fix",
  1: "autonomous",
  2: "dgps",
  3: "autonomous", // PPS — treat as autonomous-grade
  4: "rtk_fixed",
  5: "rtk_float",
  6: "autonomous", // Dead-reckoning
  7: "autonomous", // Manual
  8: "autonomous", // Simulator
};

export function getFixStatus(
  status: number,
  covarianceType: number
): FixStatus {
  if (covarianceType === 3 && status >= 0) return "rtk_fixed";
  return FIX_STATUS_MAP[status] ?? "no_fix";
}

/**
 * nmea_msgs/Sentence — raw NMEA sentence + header. Published by
 * nmea_topic_serial_reader (stock nmea_navsat_driver executable, split out
 * from nmea_serial_driver so we can subscribe to the raw stream in parallel
 * with the decoded /fix topic).
 */
export interface NmeaSentence {
  header: Header;
  sentence: string;
}

export interface GgaFields {
  fixQuality: number;      // field 6, 0-8 (see GGA_QUALITY_TO_FIX_STATUS)
  satelliteCount: number;  // field 7
  hdop: number;            // field 8
  correctionAge: number;   // field 14, seconds since last RTCM correction; -1 if unknown
}

/**
 * Parse a `$GNGGA`/`$GPGGA` sentence. Returns null if the sentence is not a
 * GGA or does not pass sanity checks. We deliberately do NOT validate the
 * checksum here — rosbridge/CBOR transport is lossless, and the UM980's NMEA
 * output is trusted.
 *
 * Fields of interest (1-indexed per NMEA spec, 0-indexed in the split):
 *   [0]  $GNGGA / $GPGGA (talker + type)
 *   [6]  Fix quality (0-8)
 *   [7]  Satellites used
 *   [8]  HDOP
 *   [13] Age of differential corrections (seconds, empty if none)
 */
export function parseGga(sentence: string): GgaFields | null {
  if (!sentence.startsWith("$") || sentence.length < 30) return null;
  const firstComma = sentence.indexOf(",");
  if (firstComma < 0) return null;
  const tag = sentence.slice(1, firstComma);
  if (!tag.endsWith("GGA")) return null;

  // Strip checksum suffix (*XX) before split
  const starIdx = sentence.indexOf("*");
  const body = starIdx >= 0 ? sentence.slice(0, starIdx) : sentence;
  const parts = body.split(",");
  if (parts.length < 15) return null;

  const fixQuality = parseInt(parts[6], 10);
  const satelliteCount = parseInt(parts[7], 10);
  const hdop = parseFloat(parts[8]);
  const correctionAgeRaw = parts[13];
  const correctionAge = correctionAgeRaw === "" ? -1 : parseFloat(correctionAgeRaw);

  if (!Number.isFinite(fixQuality)) return null;

  return {
    fixQuality,
    satelliteCount: Number.isFinite(satelliteCount) ? satelliteCount : 0,
    hdop: Number.isFinite(hdop) ? hdop : 99,
    correctionAge: Number.isFinite(correctionAge) ? correctionAge : -1,
  };
}

// sensor_msgs/LaserScan — added Phase 3 Commit B (VIZ-01)
// https://docs.ros2.org/latest/api/sensor_msgs/msg/LaserScan.html
export interface LaserScan {
  header: Header;
  angle_min: number;        // rad — typically -π
  angle_max: number;        // rad — typically +π
  angle_increment: number;  // rad between beams
  time_increment: number;
  scan_time: number;
  range_min: number;        // m
  range_max: number;        // m
  // Under CBOR, roslibjs decodes Float32 arrays to a Float32Array; under JSON,
  // ranges is a plain number[]. Consumers must iterate via index, which works
  // for both. NaN sentinels in `ranges` are preserved by the subscriber-boundary
  // scrubber's typed-array exemption (see web/lib/ros/subscribers.ts).
  ranges: Float32Array | number[];
  intensities: Float32Array | number[]; // may be empty
}

// nav_msgs/MapMetaData — Phase 4 Plan 04-02 (MAP-04)
export interface MapMetaData {
  map_load_time: { sec: number; nanosec: number };
  resolution: number;   // m/cell — typically 0.05 for our slam_toolbox config
  width: number;        // cells
  height: number;       // cells
  origin: {
    position: Vector3;
    orientation: Quaternion;
  };
}

// nav_msgs/OccupancyGrid — Phase 4 Plan 04-02 (MAP-04)
// Under CBOR rosbridge, `data` arrives as Int8Array (roslibjs typed-array decode).
// The subscriber scrubber's ArrayBuffer.isView exemption preserves it — walking W*H
// bytes for NaN would be a perf disaster. Int8 has no NaN; -1 is the integer-valid
// "unknown" sentinel.
export interface OccupancyGrid {
  header: Header;
  info: MapMetaData;
  data: Int8Array | number[];
}
