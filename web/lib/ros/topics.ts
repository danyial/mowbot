// ROS2 Topic definitions

export const TOPICS = {
  // Subscribed topics
  FIX: {
    name: "/fix",
    messageType: "sensor_msgs/NavSatFix",
    throttleMs: 200, // 5 Hz
  },
  IMU: {
    name: "/imu",
    messageType: "sensor_msgs/Imu",
    throttleMs: 200, // 5 Hz
  },
  ODOMETRY: {
    name: "/odometry/filtered",
    messageType: "nav_msgs/Odometry",
    throttleMs: 100, // 10 Hz
  },
  BATTERY: {
    name: "/battery_voltage",
    messageType: "std_msgs/Float32",
    throttleMs: 0, // 1 Hz, no throttle needed
  },
  DIAGNOSTICS: {
    name: "/diagnostics",
    messageType: "diagnostic_msgs/DiagnosticArray",
    throttleMs: 0,
  },
  MOWER_STATUS: {
    name: "/mower/status",
    messageType: "std_msgs/String",
    throttleMs: 0,
  },

  // Published topics
  CMD_VEL: {
    name: "/cmd_vel",
    messageType: "geometry_msgs/Twist",
  },
  MOWER_COMMAND: {
    name: "/mower/command",
    messageType: "std_msgs/String",
  },
} as const;

export type TopicName = keyof typeof TOPICS;
