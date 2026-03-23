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

# Warte bis GNSS-Port verfuegbar und beschreibbar ist
MAX_RETRIES=30
RETRY=0
while [ ! -w "${GNSS_DEVICE}" ]; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "[ntrip] ERROR: ${GNSS_DEVICE} nicht verfuegbar nach ${MAX_RETRIES} Versuchen"
    exit 1
  fi
  echo "[ntrip] Warte auf ${GNSS_DEVICE}... (${RETRY}/${MAX_RETRIES})"
  sleep 2
done

exec str2str \
  -in "ntrip://${NTRIP_USER}:${NTRIP_PASS}@${NTRIP_HOST}:${NTRIP_PORT}/${NTRIP_MOUNT}" \
  -out "serial://${GNSS_DEVICE}:${GNSS_BAUD:-115200}"
