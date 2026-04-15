# MowBot

> **Work in Progress** — This project is under active development.
> Features may be incomplete, untested, or change without notice.

DIY robotic lawnmower powered by ROS2, Docker, and an ESP32 motor controller.
Runs on a Raspberry Pi 4 with RTK-GPS (UM980), IMU (MPU6050), and a
Next.js 16 web interface for monitoring and control.

## Architecture

All services run as Docker containers with `network_mode: host` for ROS2 DDS discovery.

| Service | Description |
|---------|-------------|
| **micro-ros-agent** | Serial bridge to ESP32 motor controller |
| **gnss** | NMEA NavSat driver for UM980 RTK-GPS |
| **ntrip** | RTCM3 correction data via str2str |
| **imu** | MPU6050 inertial measurement unit |
| **nav** | Nav2 navigation stack + EKF sensor fusion |
| **rosbridge** | WebSocket bridge between ROS2 and the web UI |
| **web** | Next.js 16 control dashboard (PWA) |

```
Browser (Phone/Laptop)
    |
    |  HTTP :3000
    v
 [web] ── /rosbridge (WebSocket proxy) ──> [rosbridge] :9090
                                                |
                                             ROS2 DDS
                                                |
                      ┌─────────┬──────────┬────┴────┬─────────┐
                   [gnss]    [imu]      [nav]   [ntrip]  [micro-ros-agent]
                     |         |                   |            |
                /dev/ttyGNSS  I2C             NTRIP Base    /dev/ttyAMA0
                  (UM980)   (MPU6050)          Station        (ESP32)
```

## Quickstart

### Prerequisites

- Raspberry Pi 4 (4/8 GB) with Ubuntu 22.04 or Raspberry Pi OS
- ESP32 with flashed firmware (see `firmware/`)
- UM980 GNSS module (CH341 USB)
- GY-521 IMU module (I2C)
- RTK base station with NTRIP access

### Installation

```bash
git clone https://github.com/danyial/mowbot.git
cd mowbot
chmod +x setup.sh
./setup.sh
```

### Configuration

1. Edit `.env` — verify device paths (`/dev/ttyAMA0`, `/dev/ttyGNSS`)
2. Edit `config/ntrip.env` — set your RTK base station credentials

### udev Rules

The setup script installs udev rules automatically. If you skipped `setup.sh` or need to install them manually:

```bash
sudo cp udev/99-mower.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger
```

This creates persistent symlinks for the USB devices:

| Device | Symlink | Hardware |
|--------|---------|----------|
| CH341 (UM980) | `/dev/ttyGNSS` | GNSS receiver |

Without these rules, the device paths may change on every reboot (e.g. `/dev/ttyUSB0` vs `/dev/ttyUSB1`), which would break the Docker container device mappings.

The ESP32 motor controller is wired to the Pi via HAT-internal UART (GPIO14/15) and exposed as `/dev/ttyAMA0` — no udev symlink needed.

### Start

```bash
docker compose up -d
```

### Web UI

Open `http://<pi-ip>:3000` or `http://mower.local:3000` (if mDNS is available).

The app can be installed as a PWA on your phone ("Add to Home Screen").

### Logs

```bash
docker compose logs -f web
docker compose logs -f gnss
docker compose logs -f micro-ros-agent
```

### Stop

```bash
docker compose down
```

## Local Build

By default, `docker compose up` pulls pre-built images from `ghcr.io/danyial/mowbot/`.

To build locally instead (e.g. after modifying a Dockerfile):

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml build
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d
```

## Project Structure

```
mowbot/
├── docker-compose.yml          # Pre-built images (default)
├── docker-compose.build.yml    # Local build overrides
├── .env.example                # Host configuration template
├── setup.sh                    # First-time setup (Docker, udev, I2C)
│
├── docker/                     # Dockerfiles for all services
│   ├── ros2-base/
│   ├── micro-ros-agent/
│   ├── gnss/
│   ├── ntrip/
│   ├── imu/
│   ├── nav/
│   ├── rosbridge/
│   └── web/
│
├── config/                     # ROS2 + service configuration
│   ├── ntrip.env               # NTRIP credentials
│   ├── ekf.yaml                # EKF sensor fusion
│   ├── nav2_params.yaml        # Navigation parameters
│   ├── robot.yaml              # Robot dimensions and limits
│   ├── nmea.yaml               # GNSS driver config
│   ├── cyclonedds.xml          # DDS middleware config
│   └── mower_nav_launch.py     # ROS2 launch file
│
├── web/                        # Next.js 16 web application
│   ├── app/                    # App Router pages + API routes
│   ├── components/             # React components
│   ├── lib/                    # ROS client, stores, utilities
│   └── server.mjs              # Custom server with WS proxy
│
├── firmware/                   # ESP32 micro-ROS firmware
│   ├── src/main.cpp            # Motor controller (PlatformIO)
│   ├── platformio.ini
│   └── flash_esp32.sh          # Flash script (stops Docker first)
│
├── udev/                       # Device symlink rules
│   └── 99-mower.rules
│
└── docs/                       # Documentation (WIP)
```

## Hardware

| Component | Model | Interface | Purpose |
|-----------|-------|-----------|---------|
| SBC | Raspberry Pi 4 (4/8 GB) | — | Main computer |
| Motor Controller | ESP32 DOIT DevKit V1 | USB Serial | Differential drive via ESCs |
| GNSS | UM980 | USB Serial (CH341) | RTK positioning (cm accuracy) |
| IMU | GY-521 (MPU6050) | I2C | Orientation and acceleration |
| ESCs | Brushed RC ESCs (x2) | PWM from ESP32 | Left/right motor control |

## ESP32 Firmware

The ESP32 runs a micro-ROS node that subscribes to `/cmd_vel` and drives two ESCs.
It includes a 500ms watchdog — motors stop automatically if no commands are received.

To flash:

```bash
cd firmware
./flash_esp32.sh    # Stops micro-ros-agent, flashes, restarts
```

Or manually with PlatformIO:

```bash
cd firmware
pio run --target upload
```

## License

[MIT](LICENSE)
