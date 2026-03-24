#!/bin/bash
# scripts/build-and-push.sh
# Baut alle MowBot Docker Images lokal (arm64) und pusht sie nach ghcr.io
#
# Voraussetzung:
#   docker login ghcr.io -u danyial
#
# Verwendung:
#   ./scripts/build-and-push.sh          # Alle Services bauen + pushen
#   ./scripts/build-and-push.sh web      # Nur web bauen + pushen
#   ./scripts/build-and-push.sh web nav  # Nur web und nav bauen + pushen

set -e

REGISTRY="ghcr.io/danyial/mowbot"
ALL_SERVICES=(micro-ros-agent gnss ntrip imu nav rosbridge web)

# Wenn Argumente angegeben, nur diese Services bauen
if [ $# -gt 0 ]; then
  SERVICES=("$@")
else
  SERVICES=("${ALL_SERVICES[@]}")
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  MowBot — Build & Push"
echo "========================================"
echo ""
echo "Registry:  $REGISTRY"
echo "Services:  ${SERVICES[*]}"
echo "Platform:  $(uname -m)"
echo ""

# Pruefen ob bei ghcr.io eingeloggt
if ! docker pull "$REGISTRY/ntrip:latest" > /dev/null 2>&1; then
  if ! grep -q "ghcr.io" ~/.docker/config.json 2>/dev/null; then
    echo "ERROR: Nicht bei ghcr.io eingeloggt."
    echo "Bitte zuerst ausfuehren:"
    echo "  docker login ghcr.io -u danyial"
    exit 1
  fi
fi

# 1. Bauen
echo "[1/2] Building images..."
echo ""
docker-compose -f "$PROJECT_DIR/docker-compose.yml" \
               -f "$PROJECT_DIR/docker-compose.build.yml" \
               build "${SERVICES[@]}"

echo ""

# 2. Pushen
echo "[2/2] Pushing images to ghcr.io..."
echo ""
FAILED=()
for svc in "${SERVICES[@]}"; do
  echo "  Pushing $REGISTRY/$svc:latest ..."
  if docker push "$REGISTRY/$svc:latest"; then
    echo "  OK"
  else
    echo "  FAILED"
    FAILED+=("$svc")
  fi
  echo ""
done

echo "========================================"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "  Done! All ${#SERVICES[@]} images pushed."
else
  echo "  WARNING: ${#FAILED[@]} image(s) failed to push:"
  for f in "${FAILED[@]}"; do
    echo "    - $f"
  done
fi
echo ""
echo "  On the Pi, run:"
echo "    docker compose pull"
echo "    docker compose up -d"
echo "========================================"
