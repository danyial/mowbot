#!/bin/bash
# docker/ntrip/entrypoint.sh
# Liest NTRIP-Konfiguration aus /config/ntrip.env (read-only bind mount)
# und startet str2str neu, sobald sich die Datei aendert — so kann die
# WebUI NTRIP-Credentials aendern, ohne dass der Container neu erstellt
# werden muss.

set -e

CONFIG_FILE="/config/ntrip.env"

# Datei bei jedem Start neu lesen (ueberschreibt evtl. compose env_file Werte
# mit den aktuellsten Werten aus der gemounteten Datei).
if [ -r "${CONFIG_FILE}" ]; then
  # shellcheck disable=SC1090
  set -a
  . "${CONFIG_FILE}"
  set +a
fi

: ${NTRIP_HOST:?NTRIP_HOST not set}
: ${NTRIP_PORT:=2101}
: ${NTRIP_MOUNT:?NTRIP_MOUNT not set}
: ${NTRIP_USER:?NTRIP_USER not set}
: ${NTRIP_PASS:?NTRIP_PASS not set}
: ${GNSS_DEVICE:=/dev/ttyGNSS}

echo "[ntrip] Connecting to ${NTRIP_HOST}:${NTRIP_PORT}/${NTRIP_MOUNT}"
echo "[ntrip] Writing RTCM3 to ${GNSS_DEVICE}"

# Warte bis GNSS-Port verfuegbar und beschreibbar ist (einmalig beim Start).
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

# str2str als Kindprozess starten; bei Config-Aenderung neu starten.
STR2STR_PID=0
start_str2str() {
  str2str \
    -in "ntrip://${NTRIP_USER}:${NTRIP_PASS}@${NTRIP_HOST}:${NTRIP_PORT}/${NTRIP_MOUNT}" \
    -out "file://${GNSS_DEVICE}" &
  STR2STR_PID=$!
  echo "[ntrip] str2str started (pid=${STR2STR_PID})"
}

stop_str2str() {
  if [ "${STR2STR_PID}" -gt 0 ] && kill -0 "${STR2STR_PID}" 2>/dev/null; then
    echo "[ntrip] Stopping str2str (pid=${STR2STR_PID})"
    kill -TERM "${STR2STR_PID}" 2>/dev/null || true
    # Grace period — dann SIGKILL
    for i in 1 2 3 4 5; do
      if ! kill -0 "${STR2STR_PID}" 2>/dev/null; then break; fi
      sleep 0.5
    done
    kill -KILL "${STR2STR_PID}" 2>/dev/null || true
    wait "${STR2STR_PID}" 2>/dev/null || true
  fi
  STR2STR_PID=0
}

# Signal-Handler: sauberer Shutdown bei docker stop.
cleanup() {
  echo "[ntrip] Received shutdown signal"
  stop_str2str
  exit 0
}
trap cleanup TERM INT

start_str2str

# Config-Watcher: bei Aenderung der Config-Datei str2str mit neuen Werten neu starten.
# Wenn inotify-tools nicht verfuegbar ist (aeltere Images), fallback auf "just wait".
if command -v inotifywait >/dev/null 2>&1 && [ -r "${CONFIG_FILE}" ]; then
  echo "[ntrip] Watching ${CONFIG_FILE} for changes (inotify)"
  while true; do
    # close_write triggert bei jeder gespeicherten Aenderung (z.B. Node fs.writeFile).
    # move_self/delete_self triggert, wenn der Editor atomar ersetzt (rename-over).
    inotifywait -q -e close_write,move_self,delete_self "${CONFIG_FILE}" || true
    echo "[ntrip] Config changed — reloading"
    stop_str2str
    # Kurze Pause, falls mehrere Writes in Folge (Editor/API).
    sleep 0.5
    # Config neu einlesen.
    # shellcheck disable=SC1090
    set -a
    . "${CONFIG_FILE}"
    set +a
    echo "[ntrip] New target: ${NTRIP_HOST}:${NTRIP_PORT}/${NTRIP_MOUNT}"
    start_str2str
  done
else
  echo "[ntrip] inotify-tools not available — watcher disabled, restart container to apply config changes"
  wait "${STR2STR_PID}"
fi
