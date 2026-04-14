#!/usr/bin/env bash
# Phase 2 validation — DRV-01..DRV-05 + optional §F regression matrix re-run.
#
# Usage:
#   ./validate.sh         # DRV-01..DRV-05 only
#   ./validate.sh --full  # DRV-01..DRV-05 + §F regression matrix (12 rows)
#
# Env:
#   PI_HOST    SSH target (default: pi@10.10.40.23)
#   PI_PASS    SSH password (optional; used with sshpass if set)
#
set -euo pipefail

PI_HOST="${PI_HOST:-pi@10.10.40.23}"
FULL=0
if [[ "${1:-}" == "--full" ]]; then FULL=1; fi

FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

ssh_run() {
  if [[ -n "${PI_PASS:-}" ]]; then
    sshpass -p "$PI_PASS" ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no "$PI_HOST" "$@"
  else
    ssh -o StrictHostKeyChecking=no "$PI_HOST" "$@"
  fi
}

ros_exec() {
  # ros_exec <container> <command...>
  local c="$1"; shift
  ssh_run "docker exec $c bash -c 'source /opt/ros/humble/setup.bash; [ -f /ws/install/setup.bash ] && source /ws/install/setup.bash; $*'"
}

# ---------- Section A: DRV-01 ----------
echo "=== Section A: DRV-01 (namespaces + device + pinned tag) ==="
NS=$(ssh_run "docker inspect mower-lidar --format '{{.HostConfig.NetworkMode}} {{.HostConfig.IpcMode}} {{.HostConfig.PidMode}}'")
[[ "$NS" == "host host host" ]] && pass "namespaces=$NS" || fail "namespaces=$NS (expected 'host host host')"

DEV=$(ssh_run "docker inspect mower-lidar --format '{{range .HostConfig.Devices}}{{.PathOnHost}}={{.PathInContainer}} {{end}}'")
echo "$DEV" | grep -q '/dev/ttyLIDAR=/dev/ttyLIDAR' && pass "device /dev/ttyLIDAR mounted" || fail "device /dev/ttyLIDAR missing"

IMG=$(ssh_run "docker inspect mower-lidar --format '{{.Config.Image}}'")
echo "$IMG" | grep -q 'ghcr.io/danyial/mowbot/lidar:bf668a8' && pass "image pinned :bf668a8" || fail "image=$IMG not pinned to :bf668a8"
echo "$IMG" | grep -q ':latest' && fail "image uses :latest (forbidden)" || pass "image NOT :latest"

# ---------- Section B: DRV-02 ----------
echo "=== Section B: DRV-02 (/scan @ 10 Hz + SensorDataQoS) ==="
HZ_OUT=$(ros_exec mower-nav "timeout 12 ros2 topic hz /scan --window 100" 2>&1 || true)
RATE=$(echo "$HZ_OUT" | grep -oE 'average rate: [0-9.]+' | awk '{print $3}' | tail -1)
if [[ -n "$RATE" ]] && awk -v r="$RATE" 'BEGIN{exit !(r>=9.9 && r<=10.1)}'; then
  pass "/scan rate=$RATE Hz (in 9.9..10.1)"
else
  fail "/scan rate=$RATE Hz (out of 9.9..10.1)"
fi

QOS_OUT=$(ros_exec mower-nav "ros2 topic info /scan --verbose" 2>&1 || true)
echo "$QOS_OUT" | grep -qE 'Reliability:[[:space:]]+BEST_EFFORT' && pass "QoS Reliability=BEST_EFFORT" || fail "QoS Reliability != BEST_EFFORT"
echo "$QOS_OUT" | grep -qE 'History \(Depth\):[[:space:]]+KEEP_LAST \(5\)' && pass "QoS History=KEEP_LAST (5)" || fail "QoS History != KEEP_LAST (5)"

# ---------- Section C: DRV-03 ----------
echo "=== Section C: DRV-03 (TF + /scan frame_id) ==="
TF_OUT=$(ros_exec mower-nav "timeout 5 ros2 run tf2_ros tf2_echo base_link laser_frame" 2>&1 || true)
echo "$TF_OUT" | grep -qE 'At time|Translation:' && pass "tf2_echo base_link->laser_frame resolves" || fail "tf2_echo failed"
echo "$TF_OUT" | grep -q 'Could not transform' && fail "TF 'Could not transform' present" || true

FRAME_OUT=$(ros_exec mower-nav "timeout 5 ros2 topic echo /scan --once" 2>&1 | grep -E 'frame_id' | head -1)
echo "$FRAME_OUT" | grep -q 'frame_id: laser_frame' && pass "/scan frame_id=laser_frame" || fail "/scan frame_id!=laser_frame ($FRAME_OUT)"

# ---------- Section D: DRV-04 ----------
echo "=== Section D: DRV-04 (angle_crop params surface + valid scan) ==="
LAUNCH="docker/lidar/launch/lidar.launch.py"
if [[ -f "$LAUNCH" ]]; then
  grep -q 'angle_crop_min' "$LAUNCH" && pass "angle_crop_min in $LAUNCH" || fail "angle_crop_min missing"
  grep -q 'angle_crop_max' "$LAUNCH" && pass "angle_crop_max in $LAUNCH" || fail "angle_crop_max missing"
  grep -q 'enable_angle_crop_func' "$LAUNCH" && pass "enable_angle_crop_func in $LAUNCH" || fail "enable_angle_crop_func missing"
else
  fail "$LAUNCH not found (run from repo root)"
fi

SCAN_OUT=$(ros_exec mower-nav "timeout 5 ros2 topic echo /scan --once" 2>&1 || true)
echo "$SCAN_OUT" | grep -q 'ranges:' && pass "/scan returns valid LaserScan" || fail "/scan empty/invalid"

# ---------- Section E: DRV-05 ----------
echo "=== Section E: DRV-05 (pinned tag + clean compose up) ==="
if [[ -f docker-compose.yml ]]; then
  grep -q 'ghcr.io/danyial/mowbot/lidar:bf668a8' docker-compose.yml && pass "compose references :bf668a8" || fail "compose not pinned to :bf668a8"
  grep 'ghcr.io/danyial/mowbot/lidar' docker-compose.yml | grep -q ':latest' && fail "compose uses :latest" || pass "compose NOT :latest"
fi

START_OUT=$(ssh_run "cd ~/mowbot && docker compose up -d lidar 2>&1 | tail -5 && sleep 5 && docker inspect mower-lidar --format '{{.State.Status}} RestartCount={{.RestartCount}}'")
echo "$START_OUT" | grep -q 'running RestartCount=0' && pass "docker compose up -d lidar idempotent, running, 0 restarts" || fail "lidar not running cleanly: $START_OUT"

# ---------- Section F: §F regression matrix (optional) ----------
if [[ "$FULL" == "1" ]]; then
  echo "=== Section F: §F regression matrix (12 rows) ==="

  # Row 1: micro-ros session
  LOG=$(ssh_run "docker logs mower-micro-ros 2>&1 | tail -50")
  echo "$LOG" | grep -qE 'session established|running|TermiosAgentLinux' && pass "F1: micro-ros-agent running" || fail "F1: micro-ros-agent not running"

  # Row 2: /cmd_vel subscribers (informational; may be 0 if ESP32 inactive)
  OUT=$(ros_exec mower-nav "ros2 topic info /cmd_vel" 2>&1 || true)
  if echo "$OUT" | grep -qE 'Subscription count: [1-9]'; then
    pass "F2: /cmd_vel has subscribers"
  else
    echo "INFO: F2: /cmd_vel has 0 subscribers (ESP32 inactive — pre-existing baseline state)"
  fi

  # Row 3-5: sensor topics
  ros_exec mower-gnss "timeout 10 ros2 topic echo /fix --once" 2>&1 | grep -q 'status' && pass "F3: /fix NavSatFix" || fail "F3: /fix"
  ros_exec mower-nav "timeout 10 ros2 topic echo /imu --once" 2>&1 | grep -qE 'angular_velocity|linear_acceleration' && pass "F4: /imu" || fail "F4: /imu"
  ros_exec mower-nav "timeout 10 ros2 topic echo /odometry/filtered --once" 2>&1 | grep -q 'pose' && pass "F5: /odometry/filtered" || fail "F5: /odometry/filtered"

  # Row 6: /gps/filtered present
  ros_exec mower-nav "ros2 topic list" 2>&1 | grep -q '^/gps/filtered$' && pass "F6: /gps/filtered present" || fail "F6: /gps/filtered missing"

  # Row 7: ntrip
  ssh_run "docker logs mower-ntrip 2>&1 | tail -80" | grep -iE 'mountpoint|RTCM|correction|NTRIP' >/dev/null && pass "F7: ntrip flow" || fail "F7: ntrip"

  # Row 8: rosbridge
  ssh_run "docker logs mower-rosbridge 2>&1 | tail -30" | grep -qiE 'rosbridge.*(WebSocket|started|listening)' && pass "F8: rosbridge WS" || fail "F8: rosbridge WS"

  # Row 9-10: web
  curl -sf "http://${PI_HOST#*@}:3000/" -o /dev/null && pass "F9: web root" || fail "F9: web root"
  curl -sf "http://${PI_HOST#*@}:3000/map" -o /dev/null && pass "F10: web /map" || fail "F10: web /map"

  # Row 11: topic set stable
  ros_exec mower-nav "ros2 topic list" 2>&1 | sort > /tmp/topics-current.txt
  if [[ -f /tmp/topics-pre-retrofit.txt ]]; then
    # post-retrofit, /scan is a NEW topic; baseline comparison deliberately excludes /scan.
    grep -v '^/scan$' /tmp/topics-current.txt > /tmp/topics-current-nodscan.txt
    diff /tmp/topics-pre-retrofit.txt /tmp/topics-current-nodscan.txt >/dev/null && pass "F11: topic set stable (excluding new /scan)" || fail "F11: topic set changed"
  else
    echo "INFO: F11: no baseline /tmp/topics-pre-retrofit.txt; skipping diff"
  fi

  # Row 12: reboot survival (skipped in normal validation — run manually)
  echo "INFO: F12: reboot survival skipped in non-destructive validate.sh; was verified at Phase 2 Task 4."
fi

# ---------- Summary ----------
if [[ "$FAIL" == "0" ]]; then
  echo ""
  echo "ALL SECTIONS PASS"
  exit 0
else
  echo ""
  echo "VALIDATION FAILED"
  exit 1
fi
