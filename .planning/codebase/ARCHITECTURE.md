# Architecture

**Analysis Date:** 2026-04-14

## Pattern Overview

**Overall:** Distributed robotics system with three independent layers: Raspberry Pi orchestration (ROS2-based), ESP32-C3 motor controller (micro-ROS firmware), and Next.js web dashboard. All Pi services communicate via ROS2 DDS on a shared host network. The ESP32 connects to the Pi via UART (Pi GPIO14/15 ↔ ESP32 GPIO20/21) on the Pi HAT PCB, not USB.

**Key Characteristics:**
- **ROS2 Humble** as the central nervous system: all Pi services (GNSS, IMU, navigation, motor control) publish/subscribe to topics via DDS middleware (CycloneDDS)
- **Docker containerized** for reproducibility — each major service (micro-ros-agent, gnss, imu, nav, ntrip, rosbridge, web) runs in isolation with `network_mode: host` for DDS discovery
- **UART serial protocol** for ESP32 motor controller: micro-ROS agent translates ROS2 `/cmd_vel` messages into motor control commands; ESP32 publishes encoder feedback and status back to `/odom`
- **WebSocket rosbridge** for web UI access: browser connects to `/rosbridge` (proxied through `server.mjs`), which connects to rosbridge server on `:9090`; NaN sanitization layer prevents JSON parse errors
- **Sensor fusion via EKF**: Kalman filter fuses IMU + RTK-GPS for accurate localization; navsat_transform converts lat/lon to odometry frame

## Layers

**Hardware (Sensors & Actuators):**
- Purpose: Raw sensor data acquisition and motor actuation
- Location: Physical ESP32-C3, UM980 GNSS receiver (CH341 USB), GY-521 IMU (I2C), two JGB37-520 motors with encoders, BTS7960 H-bridge motor drivers
- Contains: Embedded controller (ESP32), inertial measurement unit, RTK-capable GNSS, brushless DC motors with 11-tick quadrature encoders
- Depends on: Power supply, Raspberry Pi HAT connection (UART, I2C, GPIO)
- Used by: Firmware layer for real-time control

**Firmware Layer (ESP32-C3):**
- Purpose: Low-latency motor control and encoder feedback from hardware
- Location: `firmware/src/main.cpp`
- Contains: Motor driver control (PWM to BTS7960 H-bridges), quadrature encoder ISRs, WS2812 RGB LED status indicator, micro-ROS entity initialization
- Depends on: Arduino core for ESP32-C3, micro-ROS library (via PlatformIO)
- Used by: micro-ROS agent (over serial) via `/cmd_vel` subscription and `/odom` publication
- Key behavior: Subscribes to `/cmd_vel` (geometry_msgs/Twist), applies differential drive kinematics, scales linear/angular velocities to motor PWM (0-255), resets PWM to 0 if no command received within 500ms (watchdog). Publishes encoder counts back to ROS2. LED indicates state (red=waiting, yellow=agent found, green=idle, blue=active, purple=disconnected).

**ROS2 Services Layer (Raspberry Pi):**
- Purpose: Sensor aggregation, localization, navigation planning
- Location: Docker containers in `/docker/`, coordinated via `docker-compose.yml`
- Contains: Multiple specialized nodes
  - **micro-ros-agent** (`docker/micro-ros-agent/Dockerfile`): Serial bridge to ESP32 over `/dev/ttyAMA0` (115200 baud), translates ROS2 DDS ↔ serial micro-ROS
  - **gnss** (`docker/gnss/Dockerfile`): NMEA NavSat driver listening on `/dev/ttyGNSS`, publishes `sensor_msgs/NavSatFix` to `/fix` topic
  - **imu** (`docker/imu/Dockerfile`): MPU6050 driver on `/dev/i2c-1` (I2C bus 1, address 0x68), publishes `sensor_msgs/Imu` to `/imu`
  - **nav** (`docker/nav/Dockerfile`): Runs EKF node and navsat_transform node from `robot_localization` package, fuses IMU + GNSS, publishes `/odometry/filtered`
  - **ntrip** (`docker/ntrip/Dockerfile`): RTK correction data via str2str, feeds to `/dev/ttyGNSS` (reads credentials from `/config/ntrip.env`)
- Depends on: ROS2 Humble runtime, CycloneDDS middleware, hardware device files (`/dev/ttyAMA0`, `/dev/ttyGNSS`, `/dev/i2c-1`)
- Used by: Web UI layer (via rosbridge), navigation algorithms
- Data flow: Sensor nodes publish independently → EKF consumes and fuses → `/odometry/filtered` produced → Web consumes via rosbridge

**Web Dashboard Layer (Next.js):**
- Purpose: Real-time monitoring, mission planning, remote teleoperation
- Location: `web/` directory
- Contains:
  - **App Router** (`web/app/`): Pages for dashboard (`page.tsx`), map (`map/page.tsx`), teleop (`teleop/page.tsx`), missions (`missions/page.tsx`), settings (`settings/page.tsx`)
  - **Components** (`web/components/`): Reusable React components (map, joystick, status badges, mission lists, charts)
  - **ROS Client** (`web/lib/ros/ros-client.ts`): WebSocket connection manager to rosbridge, handles reconnection with exponential backoff, persists state on `window.__mower_ros_state` to survive HMR
  - **Stores** (`web/lib/store/`): Zustand state management for GPS, IMU, odometry, battery, missions, zones, teleop (each topic has a corresponding store for easy React binding)
  - **Utilities** (`web/lib/utils/`): Coordinate transformations (lat/lon ↔ local frame), quaternion math, formatting
- Depends on: Node.js runtime, Next.js 16, React 19, roslib.js (ROS2 client library), Zustand (state), Leaflet (map), recharts (telemetry graphs)
- Used by: Browser clients (phone/laptop)
- Key behavior: Browser → Next.js server (port 3000) → `/rosbridge` WebSocket proxy → rosbridge server (port 9090) → ROS2 DDS

**Server Proxy Layer (Node.js + server.mjs):**
- Purpose: WebSocket proxy and NaN sanitization between browser and rosbridge
- Location: `web/server.mjs`
- Contains: HTTP server, WebSocket upgrade handler for `/rosbridge` path, NaN-to-null replacement regex (rosbridge sends invalid JSON NaN literals for uninitialized GPS fields)
- Depends on: Node.js built-in `http` module, ws library (WebSocket)
- Used by: Next.js app and browser clients
- Key behavior: Manual bidirectional proxy—client connects to `/rosbridge` on Next.js, server opens connection to actual rosbridge (default `ws://localhost:9090`), sanitizes messages from rosbridge, passes through client messages unchanged

## Data Flow

**Command Flow (Web → Motors):**
1. Browser user taps "forward" on joystick (`teleop/page.tsx`)
2. React component calls `publish('CMD_VEL')` with `geometry_msgs/Twist` (linear.x, angular.z)
3. roslib.Ros publisher sends JSON via WebSocket to rosbridge `:9090`
4. rosbridge publishes to ROS2 DDS as `/cmd_vel`
5. micro-ROS agent serializes and sends to ESP32 via UART (115200 baud)
6. ESP32 firmware `cmd_vel_callback()` receives, applies differential drive kinematics, sets motor PWM via `set_motor_left()/set_motor_right()`
7. BTS7960 H-bridges drive JGB37-520 motors; motors physically move

**Sensor Flow (Hardware → Browser):**
1. GNSS receiver (UM980) outputs NMEA sentences on `/dev/ttyGNSS`
2. `nmea_navsat_driver` parses, publishes `sensor_msgs/NavSatFix` to DDS topic `/fix`
3. IMU (MPU6050) on I2C bus 1 polled by `mpu6050driver`, publishes to `/imu`
4. EKF node subscribes to `/fix` and `/imu`, fuses using Kalman filter, publishes `/odometry/filtered`
5. Encoder counts from ESP32 encoded in micro-ROS messages back to `/odom` topic
6. rosbridge subscribes to all topics, broadcasts as JSON via WebSocket `:9090`
7. Browser's roslib client receives JSON, stores in Zustand stores (`useGpsStore`, `useImuStore`, etc.)
8. React components render real-time status cards and map position

**State Management:**
- **ROS2 DDS**: Canonical state for sensor readings and system status
- **Zustand Stores**: Client-side caches of ROS topics (GPS, IMU, battery, odometry, missions); stores persist topic messages in React state
- **Component State**: React `useState` for UI toggles (map layer, dialog visibility), transient to the component lifecycle
- **Window State**: Critical objects pinned to `window.__mower_ros_state` and `window.__mower_active_subs` for persistence across Next.js HMR reloads

## Key Abstractions

**Differential Drive Controller:**
- Purpose: Translate `/cmd_vel` linear/angular velocity to left/right motor speeds
- Examples: `firmware/src/main.cpp` lines 224-241 (`cmd_vel_callback`), `config/robot.yaml` (wheel separation, max speed)
- Pattern: Kinematic equation `v_left = linear - angular * (wheel_separation / 2)`, `v_right = linear + angular * (wheel_separation / 2)`, constrain to ±MAX_SPEED

**Topic Subscription Registry:**
- Purpose: Manage ROS2 topic subscriptions without unsubscribe leaks
- Examples: `web/lib/ros/subscribers.ts` (defines all topics), `web/lib/store/ros-store.ts` (setup/cleanup)
- Pattern: Each topic has a `subscribe<T>()` call that returns `{ unsubscribe() }`, stored in `__mower_active_subs` array, cleaned up before reconnect

**Zustand Store per Sensor:**
- Purpose: Decouple ROS subscriptions from React rendering
- Examples: `web/lib/store/gps-store.ts`, `web/lib/store/imu-store.ts`, `web/lib/store/battery-store.ts`
- Pattern: Zustand `create<T>()` with subscriber callback `updateXxx()`, used by multiple components without prop drilling

**rosbridge WebSocket Proxy:**
- Purpose: Bridge browser and ROS2, hide rosbridge server location, sanitize NaN
- Examples: `web/server.mjs` lines 66-127
- Pattern: Node.js WebSocketServer listens for `/rosbridge` upgrade, opens outbound connection to real rosbridge, proxies bidirectionally with NaN replacement

## Entry Points

**ESP32 Firmware Entry:**
- Location: `firmware/src/main.cpp`
- Triggers: Power-on or reset via USB or Raspberry Pi HAT
- Responsibilities: Initialize PWM channels, encoder ISRs, WS2812 LED, micro-ROS support; spin event loop calling `rclc_executor_spin()` to process incoming `/cmd_vel` messages

**Raspberry Pi Container Startup:**
- Location: `docker-compose.yml`
- Triggers: `docker compose up`
- Responsibilities: Start all service containers in dependency order (micro-ros-agent, gnss, imu, ntrip, nav, rosbridge, web); mount config files; expose device files

**Navigation Launch:**
- Location: `config/mower_nav_launch.py`
- Triggers: Executed by nav container's entrypoint
- Responsibilities: Launch EKF node with `ekf.yaml` parameters, launch navsat_transform node with remappings for `/fix`, `/imu`, `/odometry/filtered`

**Web Application Entry:**
- Location: `web/app/layout.tsx` (root layout)
- Triggers: Browser request to `http://mower.local:3000/`
- Responsibilities: Initialize ROS client connection via `useRosStore.init()`, render navigation layout, load Zustand stores

**Web Server Entry:**
- Location: `web/server.mjs`
- Triggers: `npm start` or Docker entrypoint
- Responsibilities: Prepare Next.js app, listen on `:3000`, proxy `/rosbridge` WebSocket upgrades, serve Next.js routes

## Error Handling

**Strategy:** Multi-layered with graceful degradation. Hardware errors logged; ROS2 services restart via Docker `restart: unless-stopped`; browser reconnects with exponential backoff; UI shows connection status to user.

**Patterns:**
- **Firmware watchdog** (500ms): If no `/cmd_vel` received, stop motors immediately via `stop_motors()`. LED turns red/purple.
- **ROS2 service dependencies**: Nav container waits for gnss, imu, micro-ros-agent to start (`depends_on` with `condition: service_started`)
- **rosbridge connection failure**: Browser detects WebSocket close, calls `disconnect()` callback, starts reconnect timer with exponential backoff (500ms → 5000ms max). UI shows "disconnected" badge.
- **Serial port failure**: If micro-ROS agent loses connection to ESP32, DDS node becomes unavailable; nav and web services continue running but motor commands fail silently (no /cmd_vel subscription on ESP32).
- **GNSS fix unavailable**: NavSatFix published with `status.status = -1` (no fix); EKF continues with IMU only; UI shows "No fix" in GPS status card.
- **NaN in JSON**: Server proxy sanitizes NaN to null before forwarding to browser, preventing roslib parse errors.

## Cross-Cutting Concerns

**Logging:** ROS2 services write to stdout (captured by `docker logs`). Firmware uses Arduino Serial at 115200 baud (visible in PlatformIO monitor). Browser console logs via `console.log()` in lib and component code. No centralized log aggregation yet.

**Validation:** Zustand stores validate incoming ROS messages via TypeScript interfaces (`NavSatFix`, `ImuMessage`, etc. in `web/lib/types/ros-messages.ts`). Firmware constrains motor speeds to ±1.0 via `constrain()`. Web form inputs (mission zones) validated client-side with error toast notifications.

**Authentication:** None implemented. System assumes a trusted local network (home WiFi). No API keys, credentials hardcoded in `.env` files (not committed to git, see `.env.example`).

**Configuration:** Environment variables (`docker-compose.yml` `environment:` block and `.env` file) for device paths, baud rates, IP addresses, ROS_DOMAIN_ID. YAML files for ROS2 nodes (EKF params, Nav2 params). Firmware compiled constants for pin assignments, motor parameters.

---

*Architecture analysis: 2026-04-14*
