<!-- GSD:project-start source:PROJECT.md -->
## Project

**MowerBot**

MowerBot is a DIY autonomous robotic lawn mower built on a distributed robotics architecture: a Raspberry Pi 4 running ROS2 Humble (dockerized), an ESP32-C3 micro-ROS motor controller on a custom Pi HAT, an RTK-capable GNSS + IMU sensor stack, and a Next.js 16 web dashboard for monitoring, teleop, and mission planning. The current milestone initializes the existing work into the GSD workflow and adds an LD19 2D LiDAR for obstacle awareness and future mapping/navigation.

**Core Value:** LiDAR data must flow end-to-end: LD19 hardware → `/scan` topic on ROS2 → visible in the web dashboard's map view. If that works, the sensor is fully wired into the existing stack and unlocks the obstacle-avoidance / SLAM / Nav2 work that follows.

### Constraints

- **Tech stack**: ROS2 Humble — fixed. New nodes go in Docker containers with `network_mode: host`. No migration to ROS2 Jazzy / Iron this milestone.
- **Hardware**: Raspberry Pi 4 (not Pi 5) — UART routing constrained; see Context.
- **Hardware**: ESP32-C3 firmware is Arduino + micro-ROS via PlatformIO — do not migrate to ESP-IDF this milestone.
- **Web**: Next.js 16 / React 19 — keep the App Router structure; new viz goes on the existing `map/page.tsx`.
- **Communication**: ESP32 ↔ Pi is UART `/dev/ttyAMA0` at 115200 baud — not USB. LiDAR must not conflict with this.
- **Dependencies**: CycloneDDS middleware, rosbridge WebSocket, NaN sanitization layer are load-bearing — preserve.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- C/C++ (Arduino dialect) - Firmware for ESP32-C3 microcontroller
- TypeScript/JavaScript - Next.js 16 web frontend (React 19)
- Python 3 - ROS2 launch scripts and configuration management
- YAML - ROS2 configuration files (robot parameters, navigation, EKF)
- XML - DDS middleware configuration (CycloneDDS)
## Runtime
- ESP32-C3-DevKitM-1 (RISC-V single-core, 160 MHz) - Motor controller MCU
- Node.js 22 (Alpine) - Web server and frontend compilation
- ROS 2 Humble - Distributed middleware for robotics
- Arduino/PlatformIO - Firmware build and dependency management
- npm/npx - JavaScript/Node.js packages
- apt (Debian/Ubuntu) - System packages in Docker containers
- rosdep - ROS package management
## Frameworks
- Arduino Framework - ESP32-C3 development (`espressif32` platform in PlatformIO)
- micro-ROS - ROS2 on embedded systems (serial transport via UART)
- Next.js 16 - React-based web framework with App Router
- Node.js 22 - Runtime for production server
- PlatformIO Test framework - Unit testing for embedded code
- PlatformIO - Build system, dependency management, flashing (`.pio/` directory)
- CMake/Colcon - ROS2 workspace build system (micro-ROS Agent, nav, imu drivers)
- Docker - Containerization for all ROS2 services and web server
## Key Dependencies
- Adafruit NeoPixel 1.12.0 - WS2812 RGB LED control on GPIO8
- micro_ros_platformio (GitHub) - micro-ROS implementation for ESP32-C3 with serial UART
- ROS2 geometry_msgs - geometry_msgs/msg/Twist for cmd_vel motor commands
- rmw_cyclonedds_cpp - ROS2 middleware (all containers use CycloneDDS)
- robot_localization - EKF sensor fusion for odometry
- nav2 - Navigation2 stack (path planning, waypoint following)
- nmea_navsat_driver - ROS2 driver for NMEA GNSS data (UM980 RTK receiver)
- rosbridge_server - WebSocket bridge between ROS2 DDS and web clients
- ros2_mpu6050_driver (GitHub: hiwad-aziz) - I2C driver for MPU6050 IMU sensor
- rtklib - RTK-GNSS processing for centimeter-level positioning (NTRIP client)
- React 19 - UI framework
- Next.js 16 - Server-side rendering and static generation
- TypeScript 5 - Type-safe JavaScript
- Tailwind CSS 3.4 - Utility-first CSS framework
- Zustand 4.5 - Lightweight state management
- roslib 2.1.0 - ROS2 JavaScript client (publishes cmd_vel, subscribes to odom/sensors)
- Leaflet 1.9 - Map rendering (OpenStreetMap)
- react-leaflet 5 - React bindings for Leaflet
- Recharts 2.15 - Chart components for telemetry
- Radix UI - Accessible component primitives (@radix-ui/*)
- nipplejs 1.0.1 - Virtual joystick for mobile control
- lucide-react - Icon library
- Turf.js 7.3 - Geospatial analysis (route planning, polygon operations)
## Configuration
- `.env` file (required, see `.env.example`) - Device paths and ROS parameters
- Config files: `config/robot.yaml`, `config/nmea.yaml`, `config/ekf.yaml`, `config/nav2_params.yaml`, `config/cyclonedds.xml`
- NTRIP credentials: `config/ntrip.env` (RTK base station authentication)
- `ROS_DOMAIN_ID` - ROS2 network domain (default: 0)
- `ESP32_DEVICE` - Symlink to ESP32 serial port (default: `/dev/ttyAMA0`)
- `GNSS_DEVICE` - Symlink to GNSS receiver port (default: `/dev/ttyGNSS`)
- `GNSS_BAUD` - GNSS baud rate (default: 115200)
- `IMU_ADDRESS` - I2C address of MPU6050 (default: 0x68)
- `IMU_FREQUENCY` - IMU polling frequency in Hz (default: 30)
- `firmware/platformio.ini` - PlatformIO build configuration for ESP32-C3
## Platform Requirements
- Raspberry Pi 4 (4 GB minimum, 8 GB recommended)
- Ubuntu 22.04 LTS or Raspberry Pi OS (Bookworm)
- Docker 20+ and Docker Compose
- I2C interface enabled on Pi (for MPU6050 sensor)
- Serial/UART interface enabled on Pi GPIO14/15
- USB devices connected:
- Raspberry Pi 4 with same prerequisites
- 12V battery/power supply with XT60 connector (HAT uses MINI560 buck converter for 5V)
- udev rules installed (`udev/99-mower.rules`) for persistent device symlinks
- Raspberry Pi HAT interface (65mm x 100mm PCB)
- 40-pin GPIO stacking header (pass-through for future HAT expansion)
- Power: 12V input (XT60), 5V regulated output via MINI560
- ESP32-C3-DevKitM-1 module onboard
- Two BTS7960 H-bridge motor driver modules
- WS2812 RGB status LED on GPIO8
- Encoder support: JGB37-520 motors with 11-tick encoders
- I2C for optional MPU6050 (tilt detection)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- C++ firmware: `main.cpp` (single entry point)
- TypeScript/React components: PascalCase (e.g., `GpsStatus.tsx`, `VirtualJoystick.tsx`)
- TypeScript utilities/stores: camelCase (e.g., `gps-store.ts`, `ros-client.ts`)
- API routes: kebab-case in path structure (e.g., `/api/missions/route.ts`, `/api/config/route.ts`)
- Constants/enums: UPPER_CASE (e.g., `CMD_TIMEOUT_MS`, `WHEEL_SEPARATION`)
- Firmware (C++): snake_case (e.g., `stop_motors()`, `set_motor_left()`, `encoder_left_isr()`)
- TypeScript: camelCase for functions and methods (e.g., `quickDistance()`, `extractDockPath()`, `updateFix()`)
- React components: PascalCase for component exports (e.g., `export function GpsStatus()`)
- Global firmware variables: descriptive camelCase (e.g., `encoder_left_count`, `last_cmd_time`)
- TypeScript/React: camelCase (e.g., `fixStatus`, `dockExitDistance`, `newBoundaryPoints`)
- Boolean flags: semantic prefixes `is*` or `has*` (e.g., `isRecording`, `isStale`, `isRecordingBoundary`)
- TypeScript interfaces: PascalCase (e.g., `GpsState`, `Mission`, `ZoneCollection`)
- Type aliases for unions: PascalCase (e.g., `FixStatus`, `MapLayerType`)
- Zustand store hooks: `use{Name}Store` pattern (e.g., `useGpsStore`, `useBatteryStore`, `useRosStore`)
## Code Style
- TypeScript: Next.js default formatter (Prettier-compatible)
- Firmware: Arduino style with ISO-C++ conventions
- Line endings: CRLF not enforced (Unix-style LF acceptable)
- TypeScript/React: ESLint with Next.js core-web-vitals config
- Config: `web/eslint.config.mjs`
- Rules: `@typescript-eslint/no-explicit-any` set to warn (not error)
- No explicit linting for C++ firmware (PlatformIO-based, Arduino framework)
- Firmware: German comments for hardware-specific logic (`// Motor Links`, `// Encoder Pins`)
- Firmware: Decorative dividers using `// ═══...` for section separation
- TypeScript: JSDoc blocks for exported functions (e.g., `/** Extract dock path from zones... */`)
- TypeScript: Inline comments sparingly, prefer self-documenting code
## Import Organization
- `@/` → base of web application (resolves to `web/`)
- Used throughout all TypeScript/React code for clarity and refactoring safety
- Standard Arduino includes (e.g., `#include <Arduino.h>`, `#include <micro_ros_platformio.h>`)
- Preprocessor directives for version-conditional compilation (`#if ESP_ARDUINO_VERSION_MAJOR >= 3`)
## Error Handling
- TypeScript API routes: Try-catch wrapping with console.error logging (e.g., in `/app/api/missions/route.ts` line 179)
- Silent fallback approach: Empty objects/arrays returned on error (e.g., `return []` in `readMissions()`)
- HTTP response pattern: Return `NextResponse.json({ error: "..." }, { status: 4xx })` for errors
- No explicit error types or custom error classes in current codebase; relying on try-catch with generic catch blocks
- Boolean return codes for initialization (e.g., `create_microros_entities()` returns `true`/`false`)
- No exception throwing; rely on return values and state machine transitions
- Watchdog approach: `last_cmd_time` tracking with command timeout (`CMD_TIMEOUT_MS = 500`)
## Logging
- TypeScript: `console.error("[route_name] ACTION error:", err)` with context prefix
- Example: `console.error("[missions] POST error:", err)` in `/app/api/missions/route.ts`
- Firmware: No explicit logging library; use LED state machine for status indication (see LED COLORS defines in `main.cpp`)
## Module Design
- React components: Named export of component function (e.g., `export function GpsStatus()`)
- Utilities: Named exports for specific functions (e.g., `export function quickDistance()`)
- Type definitions: Centralized in `lib/types/` directory with explicit exports
- Pattern: `create<StateInterface>((set, get) => ({ ...state, ...actions }))`
- Single store per domain (GPS, Battery, ROS connection)
- Actions modify state via `set()` and read state via `get()`
- Example: `web/lib/store/gps-store.ts` (149 lines)
- Single monolithic `main.cpp` entry point
- Helper functions grouped by responsibility: LED control, encoder ISRs, motor control, micro-ROS management
- Preprocessor conditionals for version compatibility
## Data and Type Safety
- Strict type annotations on function parameters and return types
- Optional chaining and nullish coalescing used for null safety (e.g., `accuracy ?? -1`)
- Record types for lookup objects (e.g., `const fixBadgeVariant: Record<string, "success" | "warning" | ...>`)
- Strong typing: `float`, `int`, `volatile` modifiers for ISR-accessed variables
- Constrain values to safe ranges: `speed = constrain(speed, -1.0f, 1.0f)`
## Constants and Configuration
- All GPIO pins defined as `#define` constants at top of file (lines 26-52)
- PWM parameters as `#define`: `PWM_FREQ`, `PWM_RESOLUTION`
- Robot parameters grouped: `WHEEL_SEPARATION`, `WHEEL_DIAMETER`, `MAX_SPEED`, `ENCODER_TICKS_REV`
- Timeouts and control limits: `CMD_TIMEOUT_MS`, LED colors as hex values
- Inline constants with descriptive names (e.g., `BOUNDARY_MIN_DISTANCE_M` in gps-store.ts)
- Configuration loaded from JSON files (`data/config.json`, `data/zones.json`, `data/missions.json`)
## KiCad Schematic/PCB Conventions
- Power nets: `+12V`, `+5V`, `GND` (uppercase, clear polarity)
- Signal nets: UPPERCASE with descriptive labels (e.g., `ML_R_IS` = Motor Left Right current sense, `MR_L_IS` = Motor Right Left current sense)
- UART signals: Standard names (e.g., `TXD`, `RXD`, but implemented as GPIO20/21 pins)
- Control signals: Function-based names (e.g., `RPWM` = reverse PWM, `LPWM` = forward PWM, `EN` = enable)
- Power distribution section at top
- Control signal connections grouped by function
- Comments in German where hardware-specific (Uebersicht, Blockdiagramm, Stromversorgung)
- ERC warnings for isolated pins (current sense pins) are expected and documented
- 2-layer board (F.Cu + B.Cu)
- B.Cu dedicated as GND plane (ground pour on bottom layer)
- Traces on F.Cu (top layer) for signal routing and 12V distribution
- Wide traces (>=3mm) for 12V rail to handle current from motors and converter
- Some courtyard overlaps documented (2 errors in `MowerBot-MotorController_drc_violations.json`)
- HAT format with 6x M2.5 mounting holes (4 Pi-standard + 2 chassis support)
- Board size: 65mm x 100mm (extended Raspberry Pi HAT)
- All components assigned footprints in schematic
- Standard connectors: XT60, Schraubklemme (screw terminal), Header pins
- Surface mount preferred where possible for compact layout
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- **ROS2 Humble** as the central nervous system: all Pi services (GNSS, IMU, navigation, motor control) publish/subscribe to topics via DDS middleware (CycloneDDS)
- **Docker containerized** for reproducibility — each major service (micro-ros-agent, gnss, imu, nav, ntrip, rosbridge, web) runs in isolation with `network_mode: host` for DDS discovery
- **UART serial protocol** for ESP32 motor controller: micro-ROS agent translates ROS2 `/cmd_vel` messages into motor control commands. The ESP32 firmware has quadrature-encoder ISRs in place but does NOT currently publish `/odom` — adding an `/odom` publisher is tracked as deferred firmware work.
- **WebSocket rosbridge** for web UI access: browser connects to `/rosbridge` (proxied through `server.mjs`), which connects to rosbridge server on `:9090`; NaN sanitization layer prevents JSON parse errors
- **Sensor fusion via EKF**: Kalman filter fuses IMU + RTK-GPS for accurate localization; navsat_transform converts lat/lon to odometry frame
## Layers
- Purpose: Raw sensor data acquisition and motor actuation
- Location: Physical ESP32-C3, UM980 GNSS receiver (CH341 USB), GY-521 IMU (I2C), two JGB37-520 motors with encoders, BTS7960 H-bridge motor drivers
- Contains: Embedded controller (ESP32), inertial measurement unit, RTK-capable GNSS, brushless DC motors with 11-tick quadrature encoders
- Depends on: Power supply, Raspberry Pi HAT connection (UART, I2C, GPIO)
- Used by: Firmware layer for real-time control
- Purpose: Low-latency motor control and encoder feedback from hardware
- Location: `firmware/src/main.cpp`
- Contains: Motor driver control (PWM to BTS7960 H-bridges), quadrature encoder ISRs, WS2812 RGB LED status indicator, micro-ROS entity initialization
- Depends on: Arduino core for ESP32-C3, micro-ROS library (via PlatformIO)
- Used by: micro-ROS agent (over serial) via `/cmd_vel` subscription. `/odom` publication is NOT yet implemented.
- Key behavior: Subscribes to `/cmd_vel` (geometry_msgs/Twist), applies differential drive kinematics, scales linear/angular velocities to motor PWM (0-255), resets PWM to 0 if no command received within 500ms (watchdog). Encoder ISRs count wheel ticks internally but counts are not currently published to ROS2. LED indicates state (red=waiting, yellow=agent found, green=idle, blue=active, purple=disconnected).
- Purpose: Sensor aggregation, localization, navigation planning
- Location: Docker containers in `/docker/`, coordinated via `docker-compose.yml`
- Contains: Multiple specialized nodes
- Depends on: ROS2 Humble runtime, CycloneDDS middleware, hardware device files (`/dev/ttyAMA0`, `/dev/ttyGNSS`, `/dev/i2c-1`)
- Used by: Web UI layer (via rosbridge), navigation algorithms
- Data flow: Sensor nodes publish independently → EKF consumes and fuses → `/odometry/filtered` produced → Web consumes via rosbridge
- Purpose: Real-time monitoring, mission planning, remote teleoperation
- Location: `web/` directory
- Contains:
- Depends on: Node.js runtime, Next.js 16, React 19, roslib.js (ROS2 client library), Zustand (state), Leaflet (map), recharts (telemetry graphs)
- Used by: Browser clients (phone/laptop)
- Key behavior: Browser → Next.js server (port 3000) → `/rosbridge` WebSocket proxy → rosbridge server (port 9090) → ROS2 DDS
- Purpose: WebSocket proxy and NaN sanitization between browser and rosbridge
- Location: `web/server.mjs`
- Contains: HTTP server, WebSocket upgrade handler for `/rosbridge` path, NaN-to-null replacement regex (rosbridge sends invalid JSON NaN literals for uninitialized GPS fields)
- Depends on: Node.js built-in `http` module, ws library (WebSocket)
- Used by: Next.js app and browser clients
- Key behavior: Manual bidirectional proxy—client connects to `/rosbridge` on Next.js, server opens connection to actual rosbridge (default `ws://localhost:9090`), sanitizes messages from rosbridge, passes through client messages unchanged
## Data Flow
- **ROS2 DDS**: Canonical state for sensor readings and system status
- **Zustand Stores**: Client-side caches of ROS topics (GPS, IMU, battery, odometry, missions); stores persist topic messages in React state
- **Component State**: React `useState` for UI toggles (map layer, dialog visibility), transient to the component lifecycle
- **Window State**: Critical objects pinned to `window.__mower_ros_state` and `window.__mower_active_subs` for persistence across Next.js HMR reloads
## Key Abstractions
- Purpose: Translate `/cmd_vel` linear/angular velocity to left/right motor speeds
- Examples: `firmware/src/main.cpp` lines 224-241 (`cmd_vel_callback`), `config/robot.yaml` (wheel separation, max speed)
- Pattern: Kinematic equation `v_left = linear - angular * (wheel_separation / 2)`, `v_right = linear + angular * (wheel_separation / 2)`, constrain to ±MAX_SPEED
- Purpose: Manage ROS2 topic subscriptions without unsubscribe leaks
- Examples: `web/lib/ros/subscribers.ts` (defines all topics), `web/lib/store/ros-store.ts` (setup/cleanup)
- Pattern: Each topic has a `subscribe<T>()` call that returns `{ unsubscribe() }`, stored in `__mower_active_subs` array, cleaned up before reconnect
- Purpose: Decouple ROS subscriptions from React rendering
- Examples: `web/lib/store/gps-store.ts`, `web/lib/store/imu-store.ts`, `web/lib/store/battery-store.ts`
- Pattern: Zustand `create<T>()` with subscriber callback `updateXxx()`, used by multiple components without prop drilling
- Purpose: Bridge browser and ROS2, hide rosbridge server location, sanitize NaN
- Examples: `web/server.mjs` lines 66-127
- Pattern: Node.js WebSocketServer listens for `/rosbridge` upgrade, opens outbound connection to real rosbridge, proxies bidirectionally with NaN replacement
## Entry Points
- Location: `firmware/src/main.cpp`
- Triggers: Power-on or reset via USB or Raspberry Pi HAT
- Responsibilities: Initialize PWM channels, encoder ISRs, WS2812 LED, micro-ROS support; spin event loop calling `rclc_executor_spin()` to process incoming `/cmd_vel` messages
- Location: `docker-compose.yml`
- Triggers: `docker compose up`
- Responsibilities: Start all service containers in dependency order (micro-ros-agent, gnss, imu, ntrip, nav, rosbridge, web); mount config files; expose device files
- Location: `config/mower_nav_launch.py`
- Triggers: Executed by nav container's entrypoint
- Responsibilities: Launch EKF node with `ekf.yaml` parameters, launch navsat_transform node with remappings for `/fix`, `/imu`, `/odometry/filtered`
- Location: `web/app/layout.tsx` (root layout)
- Triggers: Browser request to `http://mower.local:3000/`
- Responsibilities: Initialize ROS client connection via `useRosStore.init()`, render navigation layout, load Zustand stores
- Location: `web/server.mjs`
- Triggers: `npm start` or Docker entrypoint
- Responsibilities: Prepare Next.js app, listen on `:3000`, proxy `/rosbridge` WebSocket upgrades, serve Next.js routes
## Error Handling
- **Firmware watchdog** (500ms): If no `/cmd_vel` received, stop motors immediately via `stop_motors()`. LED turns red/purple.
- **ROS2 service dependencies**: Nav container waits for gnss, imu, micro-ros-agent to start (`depends_on` with `condition: service_started`)
- **rosbridge connection failure**: Browser detects WebSocket close, calls `disconnect()` callback, starts reconnect timer with exponential backoff (500ms → 5000ms max). UI shows "disconnected" badge.
- **Serial port failure**: If micro-ROS agent loses connection to ESP32, DDS node becomes unavailable; nav and web services continue running but motor commands fail silently (no /cmd_vel subscription on ESP32).
- **GNSS fix unavailable**: NavSatFix published with `status.status = -1` (no fix); EKF continues with IMU only; UI shows "No fix" in GPS status card.
- **NaN in JSON**: Server proxy sanitizes NaN to null before forwarding to browser, preventing roslib parse errors.
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
