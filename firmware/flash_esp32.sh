#!/bin/bash
# firmware/flash_esp32.sh
# Flasht die ESP32-Firmware, stoppt vorher den micro-ros-agent Container
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/../docker-compose.yml"

echo "[flash] Stoppe micro-ros-agent Container..."
docker compose -f "$COMPOSE_FILE" stop micro-ros-agent
sleep 2

echo "[flash] Baue und flashe ESP32..."
cd "$SCRIPT_DIR"
pio run --target upload

echo "[flash] Starte micro-ros-agent Container..."
docker compose -f "$COMPOSE_FILE" start micro-ros-agent
sleep 3

echo "[flash] Fertig!"
