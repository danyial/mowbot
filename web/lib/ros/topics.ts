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
  // Phase 7 FUSE-03 — slam_toolbox publishes its scan-matched pose on `/pose`
  // (NOT `/slam_toolbox/pose` as CONTEXT.md implied; confirmed live by Plan 07-02
  // preflight: 1 publisher / 1 subscriber on /pose, type PoseWithCovarianceStamped).
  // 10 Hz is sufficient for the 500ms staleness threshold (D-11); slam_toolbox only
  // publishes after successful scan-matches anyway, so throttle is rarely tight.
  POSE: {
    name: "/pose",
    messageType: "geometry_msgs/PoseWithCovarianceStamped",
    compression: "cbor",
    throttleMs: 100, // 10 Hz
  },
  BATTERY: {
    name: "/battery_voltage",
    messageType: "std_msgs/Float32",
    compression: "cbor",
    throttleMs: 0, // 1 Hz, no throttle needed
  },
  // Raw NMEA sentences from the UM980 via nmea_topic_serial_reader. We parse GGA
  // client-side to recover true RTK fix quality (4=Fixed vs 5=Float — /fix loses
  // this distinction), satellite count, and correction age. Throttle hard:
  // UM980 emits ~8 sentences/epoch at 1 Hz, we only need the GGA.
  NMEA_SENTENCE: {
    name: "/nmea_sentence",
    messageType: "nmea_msgs/Sentence",
    compression: "cbor",
    throttle_rate: 200, // rosbridge-side: cap to 5 Hz
    queue_length: 1,
    throttleMs: 200,    // client-side: cap to 5 Hz
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
