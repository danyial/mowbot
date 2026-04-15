# Technology Stack

**Analysis Date:** 2026-04-14

## Languages

**Primary:**
- C/C++ (Arduino dialect) - Firmware for ESP32-C3 microcontroller
- TypeScript/JavaScript - Next.js 16 web frontend (React 19)
- Python 3 - ROS2 launch scripts and configuration management

**Secondary:**
- YAML - ROS2 configuration files (robot parameters, navigation, EKF)
- XML - DDS middleware configuration (CycloneDDS)

## Runtime

**Environment:**
- ESP32-C3-DevKitM-1 (RISC-V single-core, 160 MHz) - Motor controller MCU
- Node.js 22 (Alpine) - Web server and frontend compilation
- ROS 2 Humble - Distributed middleware for robotics

**Package Manager:**
- Arduino/PlatformIO - Firmware build and dependency management
- npm/npx - JavaScript/Node.js packages
- apt (Debian/Ubuntu) - System packages in Docker containers
- rosdep - ROS package management

## Frameworks

**Core (Firmware):**
- Arduino Framework - ESP32-C3 development (`espressif32` platform in PlatformIO)
- micro-ROS - ROS2 on embedded systems (serial transport via UART)

**Core (Web):**
- Next.js 16 - React-based web framework with App Router
- Node.js 22 - Runtime for production server

**Testing (Firmware):**
- PlatformIO Test framework - Unit testing for embedded code

**Build/Dev:**
- PlatformIO - Build system, dependency management, flashing (`.pio/` directory)
- CMake/Colcon - ROS2 workspace build system (micro-ROS Agent, nav, imu drivers)
- Docker - Containerization for all ROS2 services and web server

## Key Dependencies

**Critical (Firmware):**
- Adafruit NeoPixel 1.12.0 - WS2812 RGB LED control on GPIO8
- micro_ros_platformio (GitHub) - micro-ROS implementation for ESP32-C3 with serial UART
- ROS2 geometry_msgs - geometry_msgs/msg/Twist for cmd_vel motor commands

**Infrastructure (ROS2):**
- rmw_cyclonedds_cpp - ROS2 middleware (all containers use CycloneDDS)
- robot_localization - EKF sensor fusion for odometry
- nav2 - Navigation2 stack (path planning, waypoint following)
- nmea_navsat_driver - ROS2 driver for NMEA GNSS data (UM980 RTK receiver)
- rosbridge_server - WebSocket bridge between ROS2 DDS and web clients

**Infrastructure (Firmware Drivers):**
- ros2_mpu6050_driver (GitHub: hiwad-aziz) - I2C driver for MPU6050 IMU sensor

**Infrastructure (GPS/RTK):**
- rtklib - RTK-GNSS processing for centimeter-level positioning (NTRIP client)

**Web UI (Frontend):**
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

**Environment:**
- `.env` file (required, see `.env.example`) - Device paths and ROS parameters
- Config files: `config/robot.yaml`, `config/nmea.yaml`, `config/ekf.yaml`, `config/nav2_params.yaml`, `config/cyclonedds.xml`
- NTRIP credentials: `config/ntrip.env` (RTK base station authentication)

**Key Environment Variables:**
- `ROS_DOMAIN_ID` - ROS2 network domain (default: 0)
- `ESP32_DEVICE` - Pi UART device for ESP32 (default: `/dev/ttyAMA0`)
- `GNSS_DEVICE` - Symlink to GNSS receiver port (default: `/dev/ttyGNSS`)
- `GNSS_BAUD` - GNSS baud rate (default: 115200)
- `IMU_ADDRESS` - I2C address of MPU6050 (default: 0x68)
- `IMU_FREQUENCY` - IMU polling frequency in Hz (default: 30)

**Build:**
- `firmware/platformio.ini` - PlatformIO build configuration for ESP32-C3
  - Target: `esp32-c3-devkitm-1` board
  - Platform: `espressif32`
  - Framework: `arduino`
  - Serial monitor speed: 115200 baud
  - Board micro-ROS distro: `humble`
  - Board micro-ROS transport: `serial`

## Platform Requirements

**Development:**
- Raspberry Pi 4 (4 GB minimum, 8 GB recommended)
- Ubuntu 22.04 LTS or Raspberry Pi OS (Bookworm)
- Docker 20+ and Docker Compose
- I2C interface enabled on Pi (for MPU6050 sensor)
- Serial/UART interface enabled on Pi GPIO14/15
- USB devices connected:
  - ESP32 motor controller via Pi GPIO14/15 UART (exposed as `/dev/ttyAMA0`)
  - UM980 RTK-GNSS receiver with CH341 converter (identifies as `/dev/ttyGNSS`)

**Production:**
- Raspberry Pi 4 with same prerequisites
- 12V battery/power supply with XT60 connector (HAT uses MINI560 buck converter for 5V)
- udev rules installed (`udev/99-mower.rules`) for persistent device symlinks

**Hardware (Pi HAT PCB):**
- Raspberry Pi HAT interface (65mm x 100mm PCB)
- 40-pin GPIO stacking header (pass-through for future HAT expansion)
- Power: 12V input (XT60), 5V regulated output via MINI560
- ESP32-C3-DevKitM-1 module onboard
- Two BTS7960 H-bridge motor driver modules
- WS2812 RGB status LED on GPIO8
- Encoder support: JGB37-520 motors with 11-tick encoders
- I2C for optional MPU6050 (tilt detection)

---

*Stack analysis: 2026-04-14*
