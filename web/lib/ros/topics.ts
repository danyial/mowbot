// ROS2 Topic definitions

export const TOPICS = {
  // Subscribed topics — global CBOR per D-06
  FIX: {
    name: "/fix",
    messageType: "sensor_msgs/NavSatFix",
    compression: "cbor",
    throttleMs: 200, // 5 Hz
  },
  IMU: {
    name: "/imu",
    messageType: "sensor_msgs/Imu",
    compression: "cbor",
    throttleMs: 200, // 5 Hz
  },
  ODOMETRY: {
    name: "/odometry/filtered",
    messageType: "nav_msgs/Odometry",
    compression: "cbor",
    throttleMs: 100, // 10 Hz
  },
  BATTERY: {
    name: "/battery_voltage",
    messageType: "std_msgs/Float32",
    compression: "cbor",
    throttleMs: 0, // 1 Hz, no throttle needed
  },
  DIAGNOSTICS: {
    name: "/diagnostics",
    messageType: "diagnostic_msgs/DiagnosticArray",
    compression: "cbor",
    throttleMs: 0,
  },
  MOWER_STATUS: {
    name: "/mower/status",
    messageType: "std_msgs/String",
    compression: "cbor",
    throttleMs: 0,
  },
  // LD19 2D LiDAR — D-08: full rosbridge decimation + client-side render cap.
  // `throttle_rate` + `queue_length` hold the wire rate down to ~10 Hz max even
  // if the driver publishes faster, and `throttleMs` is a parallel render-rate
  // cap so a burst of messages can't drive the canvas redraw loop harder than
  // ~10 fps. Both layers are intentional (see RESEARCH pitfall #5).
  SCAN: {
    name: "/scan",
    messageType: "sensor_msgs/LaserScan",
    compression: "cbor",
    throttle_rate: 100, // ms — rosbridge-side decimation (D-08, P3)
    queue_length: 1,    // rosbridge publisher-side queue (D-08)
    throttleMs: 100,    // client-side render-rate cap (D-08, P3)
  },

  // Phase 4 MAP-04 — slam_toolbox OccupancyGrid.
  // TRANSIENT_LOCAL latched publisher at ~0.5 Hz (map_update_interval: 2.0).
  // throttle_rate + queue_length + throttleMs caps wire + callback rate to 1 Hz.
  MAP: {
    name: "/map",
    messageType: "nav_msgs/OccupancyGrid",
    compression: "cbor",
    throttle_rate: 1000,
    queue_length: 1,
    throttleMs: 1000,
  },

  // Published topics — no compression needed (browser publishes, doesn't subscribe)
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
