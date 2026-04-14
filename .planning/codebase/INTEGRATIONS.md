# External Integrations

**Analysis Date:** 2026-04-14

## APIs & External Services

**ROS2 DDS Network:**
- ROS2 Humble with CycloneDDS middleware
  - SDK/Client: `roslib` 2.1.0 (JavaScript client for web UI)
  - Transport: DDS over localhost (all services use `network_mode: host`)
  - Discovery: Automatic via multicast (ROS_DOMAIN_ID=0 configurable)
  - Middleware config: `config/cyclonedds.xml`

**rosbridge WebSocket Server:**
- Exposes ROS2 DDS to web browsers via WebSocket
  - Runs on port 9090 (internal), proxied via web server at `/rosbridge`
  - Services: Subscribe to topics, publish to topics
  - Used by: Next.js web UI to publish `/cmd_vel` and subscribe to `/odom`, `/fix`, `/imu/data`

**Geospatial Services:**
- OpenStreetMap (tile server)
  - Used by: Leaflet map in web UI
  - Purpose: Display robot position and planned routes on map

## Data Storage

**Databases:**
- Not applicable - No persistent database. ROS2 topics are in-memory real-time streams.

**File Storage:**
- Docker volume: `mower-data` - Persistent volume shared between containers
  - Used for: Logging, temporary route data, diagnostics
  - Mounted at: `/data` in nav and web containers

**Caching:**
- ROS2 topic subscriptions - In-memory circular buffers maintained by middleware
- Next.js ISR (Incremental Static Regeneration) - Cached map tiles via browser cache

## Hardware Interfaces

**Serial Communication (UART):**
- **ESP32-C3 ↔ Raspberry Pi**
  - Protocol: micro-ROS over serial (UART)
  - Physical pins: Pi GPIO14/15 ↔ ESP32-C3 GPIO20/21
  - Baud rate: 115200 bps
  - Connection method: Pi HAT PCB traces (no external USB cable needed)
  - Device symlink: `/dev/ttyESP32` (via udev rule)
  - Hardware: CP2102 USB-to-serial chip on ESP32
  - Implementation: `firmware/src/main.cpp` lines 344-346
    ```cpp
    Serial1.begin(115200, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);
    set_microros_serial_transports(Serial1);
    ```

**I2C Interfaces:**

**MPU6050 IMU (6-axis Accelerometer + Gyroscope):**
- Device address: 0x68 (configurable via `IMU_ADDRESS` env var)
- I2C bus: `/dev/i2c-1` on Raspberry Pi GPIO2 (SDA) / GPIO3 (SCL)
- Driver: ros2_mpu6050_driver from source (Docker: `imu/Dockerfile`)
- Frequency: 30 Hz (configurable via `IMU_FREQUENCY` env var)
- ROS topic: `/imu/data` (publishes sensor_msgs/Imu)
- Purpose: Tilt detection, orientation feedback, EKF sensor fusion
- PCB integration: Optional via I2C pass-through on Pi HAT (currently not wired)

**SPI (Not currently used):**
- Available via Pi HAT 40-pin stacking header for future expansion

## Motor Control

**BTS7960 Dual H-Bridge Motor Drivers:**
- Quantity: 2 modules (left and right motors)
- Control signals from ESP32-C3:
  - Motor Left: GPIO0 (RPWM), GPIO1 (LPWM), GPIO2 (Enable)
  - Motor Right: GPIO3 (RPWM), GPIO4 (LPWM), GPIO5 (Enable)
- Input voltage: 12V from battery
- Output: Two JGB37-520 DC motors (76 RPM, 11-tick encoders)
- PWM frequency: 1000 Hz, 8-bit resolution (0-255)
- Control method: Differential drive kinematics
  - ROS2 topic: `/cmd_vel` (geometry_msgs/Twist)
  - Receives linear.x (m/s) and angular.z (rad/s)
  - Callback: `cmd_vel_callback()` in `firmware/src/main.cpp` lines 224-241
  - Conversion: Differential drive math calculates left/right motor speeds
- Encoder feedback: 11 ticks per motor revolution (quadrature inputs)
  - Left encoder: GPIO6 (A), GPIO7 (B)
  - Right encoder: GPIO10 (A), GPIO9 (B)
  - Interrupt-driven counting (ISR) for high precision
  - Odometry calculation via ROS2 (not in firmware)

**Status LED (WS2812 RGB):**
- Type: Addressable RGB LED (one per device)
- Pin: GPIO8 on ESP32-C3-DevKitM-1 (onboard)
- Driver: Adafruit NeoPixel 1.12.0
- Protocol: NeoPixel/WS2812 (800 kHz one-wire)
- Color meanings:
  - Red (0x200000): Waiting for micro-ROS agent
  - Yellow (0x201000): Agent available, creating entities / Motor test
  - Green (0x002000): Connected, idle (motors stopped)
  - Blue (0x000020): cmd_vel received, motors active
  - Purple (0x100010): Disconnected/error state
- Implementation: `firmware/src/main.cpp` lines 85-90, 129-140

## Authentication & Identity

**ROS2 Discovery:**
- No explicit authentication
- Relies on network isolation (Docker containers on same host with `network_mode: host`)
- Domain isolation via ROS_DOMAIN_ID (default: 0)

## GNSS & RTK Integration

**UM980 RTK-GNSS Receiver:**
- Connection: USB via CH341 serial adapter
- Device symlink: `/dev/ttyGNSS` (via udev rule in `udev/99-mower.rules`)
- Protocol: NMEA 0183 (standard navigation sentences)
- Baud rate: 115200 bps (configurable)
- ROS2 driver: nmea_navsat_driver (ros-humble-nmea-navsat-driver)
- ROS topic: `/fix` (sensor_msgs/NavSatFix - WGS84 lat/lon/altitude)
- Frequency: 10-20 Hz typical

**RTK Correction Data (NTRIP):**
- Protocol: NTRIP 1.0 (RTCM3 correction stream)
- Source: RTK base station (NTRIP caster)
- Client: rtklib str2str utility (in `ntrip/Dockerfile`)
- Configuration: `config/ntrip.env`
  - `NTRIP_HOST`: Base station IP/hostname
  - `NTRIP_PORT`: 2101 (standard NTRIP port)
  - `NTRIP_MOUNT`: Mount point on caster (application-specific)
  - `NTRIP_USER`, `NTRIP_PASS`: Authentication credentials
- Delivery: Injected into UM980 via serial at `/dev/ttyGNSS`
- Purpose: RTK mode enables centimeter-level positioning accuracy
- Implementation: Custom entrypoint script in ntrip container

## Sensor Fusion & Navigation

**EKF (Extended Kalman Filter):**
- Package: robot_localization (ros-humble-robot-localization)
- Configuration: `config/ekf.yaml`
- Inputs:
  - Odometry from motor encoders (left/right wheel speeds)
  - IMU data (accelerometer, gyroscope for orientation)
  - GNSS fix (absolute position from UM980)
- Output: `/odometry/filtered` (nav_msgs/Odometry) - best-estimate robot state
- Used by: Nav2 for autonomous navigation

**Navigation2 Stack:**
- Package: navigation2 (ros-humble-navigation2)
- Configuration: `config/nav2_params.yaml`
- Inputs: Sensor fusion odometry, GNSS position, robot model
- Outputs: `/cmd_vel` (motor commands)
- Features: Waypoint following, obstacle avoidance (if costmap enabled)

## Monitoring & Observability

**Error Tracking:**
- None configured - No external error tracking service

**Logs:**
- Docker Compose logging: `docker compose logs -f <service>`
- Services log to stdout (captured by Docker daemon)
- No persistent logging backend (logs are lost when containers restart)
- Diagnostic output: Firmware prints to `Serial1` (UART) for debugging

**Web UI Monitoring:**
- Real-time dashboard shows:
  - Robot position on map (from `/fix` GNSS)
  - Linear/angular velocity (from `/odom` odometry)
  - Encoder tick counts (from firmware diagnostics)
  - Motor command values (from `/cmd_vel`)
  - IMU orientation (from `/imu/data` if available)
- Implemented via roslib client subscriptions in `web/lib/ros.ts`

## CI/CD & Deployment

**Hosting:**
- Raspberry Pi 4 (on-premises, no cloud)
- Docker containers orchestrated via Docker Compose

**CI Pipeline:**
- None configured
- Manual builds:
  - Firmware: `pio run -t upload` via `firmware/flash_esp32.sh`
  - Web: `npm run build` then containerize
  - ROS2: Pre-built container images from ghcr.io/danyial/mowbot/

**Container Registry:**
- ghcr.io (GitHub Container Registry) - Pre-built images
  - `ghcr.io/danyial/mowbot/micro-ros-agent:latest`
  - `ghcr.io/danyial/mowbot/gnss:latest`
  - `ghcr.io/danyial/mowbot/imu:latest`
  - `ghcr.io/danyial/mowbot/nav:latest`
  - `ghcr.io/danyial/mowbot/ntrip:latest`
  - `ghcr.io/danyial/mowbot/rosbridge:latest`
  - `ghcr.io/danyial/mowbot/web:latest`
- Option to build locally: `docker compose -f docker-compose.yml -f docker-compose.build.yml build`

**Deployment Flow:**
1. Firmware: Flash ESP32-C3 via PlatformIO
2. Pi Setup: Run `./setup.sh` (installs Docker, udev rules, I2C support)
3. Services: `docker compose up -d` (pulls images or builds locally)
4. Access: Browser to `http://<pi-ip>:3000` or `http://mower.local:3000`

## Environment Configuration

**Required Environment Variables:**
- `ROS_DOMAIN_ID` - ROS2 network domain (default: 0)
- `ESP32_DEVICE` - Device path for ESP32 UART (default: `/dev/ttyESP32`)
- `GNSS_DEVICE` - Device path for GNSS receiver (default: `/dev/ttyGNSS`)
- `GNSS_BAUD` - GNSS baud rate (default: 115200)
- `IMU_ADDRESS` - I2C address of MPU6050 (default: 0x68)
- `IMU_FREQUENCY` - IMU polling frequency (default: 30 Hz)

**Secrets:**
- NTRIP authentication: `config/ntrip.env`
  - Not needed if RTK is disabled
  - Format: Shell environment variables for rtklib str2str

**Files to Configure:**
- `.env` - Copy from `.env.example` and adjust device paths
- `config/ntrip.env` - RTK base station credentials
- `config/robot.yaml` - Robot parameters (wheel diameter, separation, speed limits, GPIO pins)
- `config/ekf.yaml` - EKF sensor fusion weights
- `config/nav2_params.yaml` - Navigation tuning parameters

## Webhooks & Callbacks

**Incoming:**
- None - This is a single-robot system, no external webhooks

**Outgoing:**
- None currently configured

**Topic Publishing (ROS2):**
- `/cmd_vel` - Motor commands from web UI (via roslib)
- Monitor subscriptions to all sensor topics for telemetry display

## Device & Hardware Detection

**udev Rules (`udev/99-mower.rules`):**
- CP2102 (ESP32 USB serial): VID 10c4, PID ea60 → `/dev/ttyESP32`
- CH341 (UM980 GNSS): VID 1a86, PID 7523 → `/dev/ttyGNSS`
- Both rules set group to `dialout` and mode 0660 for container access

**Device Setup Script (`setup.sh`):**
- Installs udev rules
- Enables I2C interface on Pi
- Enables serial UART on Pi GPIO14/15
- Installs Docker + Docker Compose

---

*Integration audit: 2026-04-14*
