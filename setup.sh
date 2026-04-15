#!/bin/bash
# setup.sh — Einmalige Erstinstallation auf dem Pi
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[x]${NC} $1"; exit 1; }

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

# --- 2. Docker Compose pruefen ---
if ! docker compose version &> /dev/null; then
    log "Installiere Docker Compose Plugin..."
    sudo apt-get update
    sudo apt-get install -y docker-compose-plugin
else
    log "Docker Compose bereits verfuegbar"
fi

# --- 3. udev-Regeln ---
log "Installiere udev-Regeln..."
sudo cp udev/99-mower.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger
log "udev-Regeln installiert (/dev/ttyGNSS)"

# --- 4. I2C aktivieren ---
if ! ls /dev/i2c-1 &> /dev/null; then
    warn "I2C nicht aktiviert!"
    warn "Bitte ausfuehren: sudo raspi-config -> Interface Options -> I2C -> Enable"
    warn "Danach: sudo reboot"
else
    log "I2C aktiv (/dev/i2c-1)"
fi

# --- 5. Benutzer zu Gruppen hinzufuegen ---
sudo usermod -aG dialout $USER 2>/dev/null || true
sudo usermod -aG i2c $USER 2>/dev/null || true
log "Benutzer zu dialout + i2c Gruppen hinzugefuegt"

# --- 6. .env erstellen ---
if [ ! -f .env ]; then
    cp .env.example .env
    log "Konfiguration .env erstellt — bitte anpassen!"
else
    log ".env existiert bereits"
fi

# --- 7. NTRIP-Config pruefen ---
if [ ! -f config/ntrip.env ]; then
    warn "config/ntrip.env nicht gefunden!"
    warn "Bitte config/ntrip.env mit NTRIP-Zugangsdaten anlegen."
else
    log "NTRIP-Konfiguration vorhanden"
fi

echo ""
echo "========================================"
echo "  Setup abgeschlossen!"
echo ""
echo "  Naechste Schritte:"
echo "  1. .env anpassen (Geraete-Pfade pruefen)"
echo "  2. config/ntrip.env anpassen (RTK-Base)"
echo "  3. docker compose build"
echo "  4. docker compose up -d"
echo "  5. http://\$(hostname).local:3000 oeffnen"
echo "========================================"
