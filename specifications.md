# MowBot — Docker-Spezifikation

> Vollständige Docker-Architektur für den DIY-Rasenmäherroboter.
> Ziel: `git clone` + `docker compose up` = laufender Roboter.

---

## 1. Repository-Struktur

```
mowbot/
├── docker-compose.yml
├── .env                              # Host-spezifische Einstellungen
├── .env.example                      # Vorlage für .env
├── README.md
├── LICENSE
├── setup.sh                          # Erstinstallation (udev, Docker, etc.)
│
├── docker/
│   ├── ros2-base/
│   │   └── Dockerfile                # ROS2 Humble Base-Image (arm64)
│   ├── micro-ros-agent/
│   │   └── Dockerfile                # micro-ROS Agent
│   ├── gnss/
│   │   └── Dockerfile                # NMEA-Treiber
│   ├── ntrip/
│   │   ├── Dockerfile                # str2str NTRIP-Client
│   │   └── entrypoint.sh             # Liest ntrip.env, startet str2str
│   ├── imu/
│   │   └── Dockerfile                # MPU6050-Treiber
│   ├── rosbridge/
│   │   └── Dockerfile                # rosbridge WebSocket
│   ├── nav/
│   │   └── Dockerfile                # Nav2 + EKF + robot_localization
│   └── web/
│       └── Dockerfile                # MowerControl Next.js App
│
├── config/
│   ├── ntrip.env                     # NTRIP-Zugangsdaten
│   ├── nmea.yaml                     # NMEA-Treiber Config
│   ├── ekf.yaml                      # EKF Sensor-Fusion Config
│   ├── nav2_params.yaml              # Nav2 Parameter
│   └── robot.yaml                    # Roboter-Parameter (Radabstand, etc.)
│
├── firmware/
│   ├── src/
│   │   └── main.cpp                  # ESP32 micro-ROS Firmware
│   ├── platformio.ini
│   ├── requirements.txt
│   └── flash_esp32.sh
│
├── udev/
│   └── 99-mower.rules               # udev-Regeln für USB-Geräte
│
├── web/                              # MowerControl Next.js Source
│   ├── .dockerignore                 # Docker-Ignore (muss im Build-Context liegen)
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── package.json
│   └── ...
│
└── docs/
    ├── setup-guide.md
    ├── hardware.md
    ├── troubleshooting.md
    └── images/
```

---

## 2. docker-compose.yml

```yaml
x-ros-common: &ros-common
  restart: unless-stopped
  network_mode: host
  environment:
    - ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-0}
    - RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
    - CYCLONEDDS_URI=file:///config/cyclonedds.xml
  volumes:
    - ./config:/config:ro

services:

  # ============================================
  # micro-ROS Agent — ESP32 Motorcontroller
  # ============================================
  micro-ros-agent:
    <<: *ros-common
    build:
      context: ./docker/micro-ros-agent
      args:
        ROS_DISTRO: humble
    container_name: mower-micro-ros
    devices:
      - ${ESP32_DEVICE:-/dev/ttyESP32}:/dev/ttyESP32
    command: >
      ros2 run micro_ros_agent micro_ros_agent
      serial --dev /dev/ttyESP32 -b 115200

  # ============================================
  # GNSS — NMEA NavSat Driver (UM980)
  # ============================================
  gnss:
    <<: *ros-common
    build:
      context: ./docker/gnss
      args:
        ROS_DISTRO: humble
    container_name: mower-gnss
    devices:
      - ${GNSS_DEVICE:-/dev/ttyGNSS}:/dev/ttyGNSS
    command: >
      ros2 run nmea_navsat_driver nmea_serial_driver
      --ros-args
      -p port:=/dev/ttyGNSS
      -p baud:=${GNSS_BAUD:-115200}
      -p frame_id:=gps_link

  # ============================================
  # NTRIP — RTK-Korrekturdaten
  # ============================================
  ntrip:
    <<: *ros-common
    build:
      context: ./docker/ntrip
    container_name: mower-ntrip
    devices:
      - ${GNSS_DEVICE:-/dev/ttyGNSS}:/dev/ttyGNSS
    env_file:
      - ./config/ntrip.env
    depends_on:
      gnss:
        condition: service_started
    entrypoint: ["/entrypoint.sh"]

  # ============================================
  # IMU — MPU6050 Treiber
  # ============================================
  imu:
    <<: *ros-common
    build:
      context: ./docker/imu
      args:
        ROS_DISTRO: humble
    container_name: mower-imu
    devices:
      - /dev/i2c-1:/dev/i2c-1
    command: >
      ros2 run mpu6050driver mpu6050driver
      --ros-args
      -p i2c_bus:=1
      -p device_address:=${IMU_ADDRESS:-0x68}
      -p frequency:=${IMU_FREQUENCY:-30}

  # ============================================
  # Navigation — Nav2 + EKF Sensor-Fusion
  # ============================================
  nav:
    <<: *ros-common
    build:
      context: ./docker/nav
      args:
        ROS_DISTRO: humble
    container_name: mower-nav
    depends_on:
      - gnss
      - imu
      - micro-ros-agent
    volumes:
      - mower-data:/data
    command: >
      ros2 launch /config/mower_nav_launch.py

  # ============================================
  # rosbridge — WebSocket Server
  # ============================================
  rosbridge:
    <<: *ros-common
    build:
      context: ./docker/rosbridge
      args:
        ROS_DISTRO: humble
    container_name: mower-rosbridge
    command: >
      ros2 launch rosbridge_server rosbridge_websocket_launch.xml

  # ============================================
  # MowerControl — Web-App
  # ============================================
  web:
    build:
      context: ./web
      dockerfile: ../docker/web/Dockerfile
    container_name: mower-web
    restart: unless-stopped
    network_mode: host
    environment:
      - NODE_ENV=production
      - PORT=3000
      - NEXT_PUBLIC_ROSBRIDGE_URL=/rosbridge
      - ROSBRIDGE_URL=ws://localhost:9090
      - NTRIP_ENV_PATH=/app/config/ntrip.env
    volumes:
      - ./config:/app/config
      - mower-data:/app/data
    depends_on:
      - rosbridge

volumes:
  mower-data:
    driver: local
```

---

## 3. Dockerfiles

### 3.1 ros2-base (Basis-Image)

```dockerfile
# docker/ros2-base/Dockerfile
FROM ros:humble-ros-base

ENV DEBIAN_FRONTEND=noninteractive
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-humble-rmw-cyclonedds-cpp \
    && rm -rf /var/lib/apt/lists/*

# Entrypoint sourced ROS2 automatisch
COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]
CMD ["bash"]
```

### 3.2 micro-ROS Agent

```dockerfile
# docker/micro-ros-agent/Dockerfile
ARG ROS_DISTRO=humble
FROM ros:${ROS_DISTRO}-ros-base

ENV DEBIAN_FRONTEND=noninteractive
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-rmw-cyclonedds-cpp \
    python3-pip \
    git \
    && rm -rf /var/lib/apt/lists/*

# micro-ROS Agent aus Source bauen
WORKDIR /ws
RUN mkdir -p src && \
    git clone -b ${ROS_DISTRO} https://github.com/micro-ROS/micro_ros_setup.git src/micro_ros_setup && \
    . /opt/ros/${ROS_DISTRO}/setup.sh && \
    apt-get update && rosdep update && \
    rosdep install --from-paths src --ignore-src -y && \
    colcon build && \
    . install/setup.sh && \
    ros2 run micro_ros_setup create_agent_ws.sh && \
    ros2 run micro_ros_setup build_agent.sh && \
    rm -rf /var/lib/apt/lists/* build log src

COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]
```

### 3.3 GNSS (NMEA-Treiber)

```dockerfile
# docker/gnss/Dockerfile
ARG ROS_DISTRO=humble
FROM ros:${ROS_DISTRO}-ros-base

ENV DEBIAN_FRONTEND=noninteractive
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-rmw-cyclonedds-cpp \
    ros-${ROS_DISTRO}-nmea-navsat-driver \
    && rm -rf /var/lib/apt/lists/*

COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]
```

### 3.4 NTRIP (str2str)

```dockerfile
# docker/ntrip/Dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    rtklib \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

**entrypoint.sh:**

```bash
#!/bin/bash
# docker/ntrip/entrypoint.sh
# Liest NTRIP-Konfiguration aus Environment-Variablen (via ntrip.env)

set -e

: ${NTRIP_HOST:?NTRIP_HOST not set}
: ${NTRIP_PORT:=2101}
: ${NTRIP_MOUNT:?NTRIP_MOUNT not set}
: ${NTRIP_USER:?NTRIP_USER not set}
: ${NTRIP_PASS:?NTRIP_PASS not set}
: ${GNSS_DEVICE:=/dev/ttyGNSS}

echo "[ntrip] Connecting to ${NTRIP_HOST}:${NTRIP_PORT}/${NTRIP_MOUNT}"
echo "[ntrip] Writing RTCM3 to ${GNSS_DEVICE}"

# Warte bis GNSS-Port verfügbar und beschreibbar ist
MAX_RETRIES=30
RETRY=0
while [ ! -w "${GNSS_DEVICE}" ]; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "[ntrip] ERROR: ${GNSS_DEVICE} nicht verfügbar nach ${MAX_RETRIES} Versuchen"
    exit 1
  fi
  echo "[ntrip] Warte auf ${GNSS_DEVICE}... (${RETRY}/${MAX_RETRIES})"
  sleep 2
done

exec str2str \
  -in "ntrip://${NTRIP_USER}:${NTRIP_PASS}@${NTRIP_HOST}:${NTRIP_PORT}/${NTRIP_MOUNT}" \
  -out "serial://${GNSS_DEVICE}:${GNSS_BAUD:-115200}"
```

### 3.5 IMU (MPU6050)

```dockerfile
# docker/imu/Dockerfile
ARG ROS_DISTRO=humble
FROM ros:${ROS_DISTRO}-ros-base

ENV DEBIAN_FRONTEND=noninteractive
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-rmw-cyclonedds-cpp \
    libi2c-dev \
    i2c-tools \
    git \
    && rm -rf /var/lib/apt/lists/*

# MPU6050-Treiber aus Source
WORKDIR /ws
RUN mkdir -p src && \
    git clone https://github.com/hiwad-aziz/ros2_mpu6050_driver.git src/mpu6050driver && \
    . /opt/ros/${ROS_DISTRO}/setup.sh && \
    rosdep update && \
    rosdep install --from-paths src --ignore-src -y && \
    colcon build --packages-select mpu6050driver && \
    rm -rf build log src

COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]
```

### 3.6 Navigation (Nav2 + EKF)

```dockerfile
# docker/nav/Dockerfile
ARG ROS_DISTRO=humble
FROM ros:${ROS_DISTRO}-ros-base

ENV DEBIAN_FRONTEND=noninteractive
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-rmw-cyclonedds-cpp \
    ros-${ROS_DISTRO}-navigation2 \
    ros-${ROS_DISTRO}-nav2-bringup \
    ros-${ROS_DISTRO}-robot-localization \
    ros-${ROS_DISTRO}-robot-state-publisher \
    ros-${ROS_DISTRO}-joint-state-publisher \
    ros-${ROS_DISTRO}-imu-tools \
    ros-${ROS_DISTRO}-teleop-twist-keyboard \
    ros-${ROS_DISTRO}-teleop-twist-joy \
    ros-${ROS_DISTRO}-joy \
    && rm -rf /var/lib/apt/lists/*

COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]
```

### 3.7 rosbridge

```dockerfile
# docker/rosbridge/Dockerfile
ARG ROS_DISTRO=humble
FROM ros:${ROS_DISTRO}-ros-base

ENV DEBIAN_FRONTEND=noninteractive
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-rmw-cyclonedds-cpp \
    ros-${ROS_DISTRO}-rosbridge-server \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]
```

### 3.8 Web-App (MowerControl)

```dockerfile
# docker/web/Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Custom server mit WebSocket-Proxy (NaN-Sanitization)
COPY --from=builder /app/server.mjs ./server.mjs

EXPOSE 3000
CMD ["node", "server.mjs"]
```

### 3.9 Shared ros_entrypoint.sh

```bash
#!/bin/bash
# Wird von allen ROS2-Containern als ENTRYPOINT genutzt
set -e

source /opt/ros/${ROS_DISTRO:-humble}/setup.bash

# Falls ein lokaler Workspace existiert
if [ -f /ws/install/setup.bash ]; then
    source /ws/install/setup.bash
fi

exec "$@"
```

---

## 4. .env (Host-Konfiguration)

```env
# .env — Host-spezifische Einstellungen
# Kopiere .env.example nach .env und passe an

# ROS2
ROS_DOMAIN_ID=0

# Geräte-Pfade (udev Symlinks)
ESP32_DEVICE=/dev/ttyESP32
GNSS_DEVICE=/dev/ttyGNSS

# GNSS
GNSS_BAUD=115200

# IMU
IMU_ADDRESS=0x68
IMU_FREQUENCY=30
```

---

## 5. config/ntrip.env

```env
NTRIP_HOST=your-base-station-ip
NTRIP_PORT=2101
NTRIP_MOUNT=your-mountpoint
NTRIP_USER=your-username
NTRIP_PASS=your-password
```

### 5.1 config/nmea.yaml

```yaml
# NMEA NavSat Driver Konfiguration
nmea_navsat_driver:
  ros__parameters:
    port: /dev/ttyGNSS
    baud: 115200
    frame_id: "gps_link"
    use_GNSS_time: false
    time_ref_source: "gps"
    useRMC: false
```

### 5.2 config/robot.yaml

```yaml
# Roboter-Parameter
robot:
  ros__parameters:
    wheel_separation: 0.20
    wheel_radius: 0.065
    max_linear_speed: 0.5
    max_angular_speed: 1.5
    esc_left_pin: 25
    esc_right_pin: 26
    esc_neutral_us: 1500
    esc_range_us: 500
    cmd_vel_timeout_ms: 500
    tilt_threshold_deg: 15.0
    mower_enabled: false
    mower_width: 0.20
    mower_overlap: 0.10
```

### 5.3 config/ekf.yaml

EKF Sensor-Fusion (robot_localization) + NavSat Transform Node. Fusioniert IMU + GNSS zu einer stabilen Pose. Siehe `config/ekf.yaml` fuer die vollstaendige Konfiguration inkl. Q-Matrix.

### 5.4 config/nav2_params.yaml

Nav2 Navigation Stack Parameter, angepasst fuer einen kleinen Outdoor-Kettenroboter. Verwendet RegulatedPurePursuitController mit 0.3 m/s Maehgeschwindigkeit. Siehe `config/nav2_params.yaml` fuer alle Parameter.

### 5.5 config/cyclonedds.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CycloneDDS xmlns="https://cdds.io/config">
  <Domain>
    <General>
      <Interfaces>
        <NetworkInterface autodetermine="true"/>
      </Interfaces>
      <AllowMulticast>true</AllowMulticast>
    </General>
    <Internal>
      <SocketReceiveBufferSize min="10MB"/>
    </Internal>
  </Domain>
</CycloneDDS>
```

### 5.6 config/mower_nav_launch.py

Launch-Datei fuer den Navigation-Container. Startet EKF + NavSat Transform. Nav2 Bringup wird spaeter aktiviert wenn Karten/Missionen unterstuetzt werden.

---

## 6. setup.sh (Erstinstallation)

```bash
#!/bin/bash
# setup.sh — Einmalige Erstinstallation auf dem Pi
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo "========================================"
echo "  MowBot — Setup"
echo "========================================"
echo ""

# --- 1. Docker installieren ---
if ! command -v docker &> /dev/null; then
    log "Installiere Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    log "Docker installiert. Bitte einmal aus- und einloggen!"
else
    log "Docker bereits installiert"
fi

# --- 2. Docker Compose prüfen ---
if ! docker compose version &> /dev/null; then
    log "Installiere Docker Compose Plugin..."
    sudo apt-get update
    sudo apt-get install -y docker-compose-plugin
else
    log "Docker Compose bereits verfügbar"
fi

# --- 3. udev-Regeln ---
log "Installiere udev-Regeln..."
sudo cp udev/99-mower.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger
log "udev-Regeln installiert (/dev/ttyESP32, /dev/ttyGNSS)"

# --- 4. I2C aktivieren ---
if ! ls /dev/i2c-1 &> /dev/null; then
    warn "I2C nicht aktiviert!"
    warn "Bitte ausführen: sudo raspi-config → Interface Options → I2C → Enable"
    warn "Danach: sudo reboot"
else
    log "I2C aktiv (/dev/i2c-1)"
fi

# --- 5. Benutzer zu Gruppen hinzufügen ---
sudo usermod -aG dialout $USER 2>/dev/null || true
sudo usermod -aG i2c $USER 2>/dev/null || true
log "Benutzer zu dialout + i2c Gruppen hinzugefügt"

# --- 6. .env erstellen ---
if [ ! -f .env ]; then
    cp .env.example .env
    log "Konfiguration .env erstellt — bitte anpassen!"
else
    log ".env existiert bereits"
fi

# --- 7. NTRIP-Config erstellen ---
if [ ! -f config/ntrip.env ]; then
    cat > config/ntrip.env << 'NTRIP'
NTRIP_HOST=your-base-station-ip
NTRIP_PORT=2101
NTRIP_MOUNT=your-mountpoint
NTRIP_USER=your-username
NTRIP_PASS=your-password
NTRIP
    warn "NTRIP-Konfiguration erstellt — bitte config/ntrip.env anpassen!"
else
    log "NTRIP-Konfiguration existiert bereits"
fi

echo ""
echo "========================================"
echo "  Setup abgeschlossen!"
echo ""
echo "  Nächste Schritte:"
echo "  1. .env anpassen (Geräte-Pfade prüfen)"
echo "  2. config/ntrip.env anpassen (RTK-Base)"
echo "  3. docker compose build"
echo "  4. docker compose up -d"
echo "  5. http://$(hostname).local:3000 öffnen"
echo "========================================"
```

---

## 7. udev/99-mower.rules

```
# ESP32 (CP2102)
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="ttyESP32", GROUP="dialout", MODE="0660"

# UM980 GNSS (CH341)
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", SYMLINK+="ttyGNSS", GROUP="dialout", MODE="0660"
```

---

## 8. Warum network_mode: host?

ROS2 DDS Discovery nutzt Multicast — das funktioniert nicht mit Docker-Bridge-Networks. Mit `network_mode: host` teilen sich alle Container das Host-Netzwerk, und DDS findet alle Nodes automatisch.

Der Nachteil (kein Netzwerk-Isolation) ist für einen Rasenmäher-Roboter im Heimnetz kein Problem. Die Ports 3000 (Web) und 9090 (rosbridge) sind direkt erreichbar.

---

## 9. Multi-Arch Build (arm64 + amd64)

Für andere Nutzer die auf verschiedener Hardware bauen wollen:

```yaml
# In jedem Dockerfile nutzen wir offizielle ROS-Images
# die bereits Multi-Arch sind (arm64 + amd64):
FROM ros:humble-ros-base
# → Funktioniert auf Pi (arm64) und Desktop (amd64)
```

Für CI/CD (GitHub Actions) mit Multi-Arch Push:

```yaml
# .github/workflows/docker-publish.yml
name: Build and Push Docker Images

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [micro-ros-agent, gnss, ntrip, imu, nav, rosbridge, web]
    steps:
      - uses: actions/checkout@v4
      
      - uses: docker/setup-qemu-action@v3
      
      - uses: docker/setup-buildx-action@v3
      
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - uses: docker/build-push-action@v5
        with:
          context: ./docker/${{ matrix.service }}
          platforms: linux/arm64,linux/amd64
          push: true
          tags: ghcr.io/${{ github.repository }}/${{ matrix.service }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Damit pullen Nutzer fertige Images statt selbst zu bauen:

```yaml
# docker-compose.yml (Alternative mit Pre-Built Images)
services:
  gnss:
    image: ghcr.io/danny/mowbot/gnss:latest
    # statt build: ./docker/gnss
```

---

## 10. Verwaltung per Web-App

Die MowerControl Web-App bekommt API-Endpoints um Docker-Services zu steuern:

```typescript
// app/api/services/route.ts
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// GET /api/services — Status aller Container
export async function GET() {
  const { stdout } = await execAsync(
    'docker compose ps --format json'
  );
  return Response.json(JSON.parse(stdout));
}
```

```typescript
// app/api/services/[name]/restart/route.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import { NextRequest } from 'next/server';

const execAsync = promisify(exec);

// POST /api/services/[name]/restart
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const allowed = [
    'micro-ros-agent', 'gnss', 'ntrip', 
    'imu', 'nav', 'rosbridge', 'web'
  ];
  
  if (!allowed.includes(name)) {
    return Response.json({ error: 'Unknown service' }, { status: 400 });
  }
  
  await execAsync(`docker compose restart ${name}`);
  return Response.json({ success: true, service: name });
}
```

### NTRIP-Config per Web-App ändern

```typescript
// app/api/ntrip/route.ts
import { readFile, writeFile } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const NTRIP_ENV = '/app/config/ntrip.env';

// GET /api/ntrip
export async function GET() {
  const content = await readFile(NTRIP_ENV, 'utf-8');
  const config = Object.fromEntries(
    content.split('\n')
      .filter(l => l.includes('='))
      .map(l => l.split('=', 2))
  );
  // Passwort maskieren
  config.NTRIP_PASS = '***';
  return Response.json(config);
}

// PUT /api/ntrip
// Validierung: Keine Newlines, Steuerzeichen oder unerwartete Sonderzeichen
function sanitizeEnvValue(value: string, fieldName: string): string {
  const s = String(value).trim();
  if (!s) throw new Error(`${fieldName} darf nicht leer sein`);
  if (/[\n\r\0]/.test(s)) throw new Error(`${fieldName} enthält ungültige Zeichen`);
  return s;
}

export async function PUT(req) {
  const { host, port, mount, user, pass } = await req.json();
  
  try {
    const safeHost  = sanitizeEnvValue(host,  'NTRIP_HOST');
    const safePort  = port ? sanitizeEnvValue(String(port), 'NTRIP_PORT') : '2101';
    const safeMount = sanitizeEnvValue(mount, 'NTRIP_MOUNT');
    const safeUser  = sanitizeEnvValue(user,  'NTRIP_USER');
    const safePass  = sanitizeEnvValue(pass,  'NTRIP_PASS');
    
    // Port muss eine Zahl sein
    if (!/^\d+$/.test(safePort)) {
      return Response.json({ error: 'NTRIP_PORT muss eine Zahl sein' }, { status: 400 });
    }
    
    const env = [
      `NTRIP_HOST=${safeHost}`,
      `NTRIP_PORT=${safePort}`,
      `NTRIP_MOUNT=${safeMount}`,
      `NTRIP_USER=${safeUser}`,
      `NTRIP_PASS=${safePass}`,
    ].join('\n');
    
    await writeFile(NTRIP_ENV, env + '\n');
    await execAsync('docker compose restart ntrip');
    
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
```

---

## 11. Quickstart für Endnutzer

```markdown
# MowBot — Quickstart

## Voraussetzungen
- Raspberry Pi 4 (4/8 GB) mit Ubuntu 22.04 oder Raspberry Pi OS
- ESP32 mit geflashter Firmware (siehe docs/firmware.md)
- UM980 GNSS-Modul (CH341 USB)
- GY-521 IMU (I2C)
- RTK-Basisstation mit NTRIP

## Installation

```bash
git clone https://github.com/danny/mowbot.git
cd mowbot
chmod +x setup.sh
./setup.sh
```

## Konfiguration

1. `.env` anpassen (Geräte-Pfade prüfen)
2. `config/ntrip.env` — RTK-Basisstation Zugangsdaten

## Starten

```bash
docker compose up -d
```

## Web-UI öffnen

http://mower.local:3000

## Logs anschauen

```bash
docker compose logs -f gnss
docker compose logs -f ntrip
docker compose logs -f micro-ros-agent
```

## Stoppen

```bash
docker compose down
```
```

---

## 12. ESP32 Firmware flashen

Die ESP32-Firmware ist **nicht** im Docker-Stack — sie wird separat geflasht, entweder vom Mac per PlatformIO oder vom Pi mit dem Flash-Script:

```bash
cd firmware/
./flash_esp32.sh
```

Das Flash-Script stoppt automatisch den `micro-ros-agent` Container:

```bash
#!/bin/bash
# firmware/flash_esp32.sh (Docker-Version)
set -e

echo "[flash] Stoppe micro-ros-agent Container..."
docker compose -f ../docker-compose.yml stop micro-ros-agent
sleep 2

echo "[flash] Flashe ESP32..."
# ... (PlatformIO Build + Upload wie gehabt)

echo "[flash] Starte micro-ros-agent Container..."
docker compose -f ../docker-compose.yml start micro-ros-agent
sleep 3

echo "[flash] Fertig!"
```

---

## 13. Volumes und Persistenz

| Volume/Bind | Pfad im Container | Zweck |
|---|---|---|
| `./config` | `/config` (read-only) | YAML-Configs, ntrip.env |
| `./config` | `/app/config` (web) | Web-App kann ntrip.env schreiben |
| `mower-data` | `/data` | Garden-Polygone, Missions, Logs |

```yaml
# Am Ende der docker-compose.yml:
volumes:
  mower-data:
    driver: local
```

---

## 14. Health Checks

```yaml
services:
  gnss:
    # ...
    healthcheck:
      test: ["CMD", "ros2", "topic", "info", "/fix"]
      interval: 30s
      timeout: 10s
      retries: 3

  rosbridge:
    # ...
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9090"]
      interval: 15s
      timeout: 5s
      retries: 3

  web:
    # ...
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000"]
      interval: 15s
      timeout: 5s
      retries: 3
```

---

## 15. Bekannte Einschränkungen

### Device-Zugriff
Container brauchen `--device` Flags für Serial-Ports und I2C. Die udev-Regeln müssen auf dem Host eingerichtet sein, nicht im Container.

### GNSS Port-Sharing
Der NTRIP-Container und der GNSS-Container greifen beide auf `/dev/ttyGNSS` zu. NTRIP nutzt `serial://` (nur RTCM3-Korrekturen schreiben) und GNSS `serial://` (NMEA lesen). Der GNSS-Container muss **vor** dem NTRIP-Container starten — geregelt über `depends_on`. Der NTRIP-Entrypoint wartet zusätzlich aktiv bis das Device beschreibbar ist (Retry-Loop).

### Build-Zeit auf dem Pi
Der erste `docker compose build` dauert auf dem Pi ca. 30-60 Minuten (vor allem micro-ROS Agent). Danach sind die Images gecached. Pre-Built Images von ghcr.io sparen diese Zeit.

### DDS und Docker
`network_mode: host` ist nötig für DDS Discovery. Docker-Bridge-Networks blockieren Multicast.

### Graceful Shutdown / Watchdog
Die ESP32-Firmware **muss** einen Communication-Watchdog implementieren: Wenn keine `/cmd_vel`-Nachrichten innerhalb von z.B. 500 ms empfangen werden, müssen die Motoren automatisch gestoppt werden. Das ist essentiell für den Fall, dass der `micro-ros-agent` Container abstürzt oder neu gestartet wird, während der Mäher sich bewegt. Ohne Watchdog könnte der Roboter unkontrolliert weiterfahren.

---

*Erstellt am 23.03.2026 | Projekt: MowBot | Danny / Eichenau*

