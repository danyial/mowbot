#!/bin/bash
# scripts/yaw-drift-test.sh
# Phase 7 FUSE-02 — stationary yaw-drift measurement for /odometry/filtered.
# Captures starting yaw, sleeps DURATION seconds, captures ending yaw,
# reports Δ as a single line — PASS if |Δ| < 1° (exit 0), FAIL otherwise (exit 1).
#
# Voraussetzung:
#   - ROS2 stack running on Pi (docker compose up) with mower-nav container up
#   - SLAM active (slam_toolbox publishing /pose) for meaningful yaw fusion; test
#     still works against IMU-only EKF but will likely FAIL the <1° criterion
#   - Mower stationary, motors off, LiDAR seeing features (per Phase 7 D-16)
#
# Verwendung:
#   ./scripts/yaw-drift-test.sh              # default 60s stationary trial
#   ./scripts/yaw-drift-test.sh 10           # 10s smoke test (quick sanity)
#
# Ausgabe (single line to stdout, matches plan regex — paste into VERIFICATION.md per D-17):
#   Δyaw = X.XX° over Ns — PASS
#   Δyaw = X.XX° over Ns — FAIL (<1°)
#
# Exit codes:
#   0 = PASS (|Δyaw| < 1.0°)
#   1 = FAIL or precondition failure (topic missing, invalid arg, docker exec error)

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════
#  Argument-Handling: DURATION (optional, default 60, must be positive integer)
# ═══════════════════════════════════════════════════════════════════════════
DURATION="${1:-60}"
if ! [[ "$DURATION" =~ ^[1-9][0-9]*$ ]]; then
  echo "[yaw-drift-test] ERROR: DURATION must be a positive integer (got '${DURATION}')" >&2
  echo "  Verwendung: $0 [DURATION_SECONDS]" >&2
  exit 1
fi

TOPIC="/odometry/filtered"
CONTAINER="mower-nav"

echo "========================================"
echo "  MowerBot — Yaw-Drift Test (FUSE-02)"
echo "========================================"
echo ""
echo "Topic:     ${TOPIC}"
echo "Duration:  ${DURATION}s"
echo "Container: ${CONTAINER}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
#  1. Pruefen ob /odometry/filtered publisht (fail-fast guard)
# ═══════════════════════════════════════════════════════════════════════════
if ! docker exec "$CONTAINER" bash -c "source /opt/ros/humble/setup.bash && ros2 topic list" 2>/dev/null | grep -q "^${TOPIC}\$"; then
  echo "[yaw-drift-test] ${TOPIC} not publishing — is ${CONTAINER} running and EKF up?" >&2
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════
#  2. Quaternion → yaw helper (runs inside nav container; tf_transformations
#     is pre-installed there per RESEARCH §Standard Stack)
# ═══════════════════════════════════════════════════════════════════════════
read_yaw() {
  docker exec "$CONTAINER" bash -c "
    source /opt/ros/humble/setup.bash &&
    ros2 topic echo --once --field pose.pose.orientation ${TOPIC} 2>/dev/null |
    python3 -c '
import sys, yaml
from tf_transformations import euler_from_quaternion
q = yaml.safe_load(sys.stdin)
_, _, yaw = euler_from_quaternion([q[\"x\"], q[\"y\"], q[\"z\"], q[\"w\"]])
print(yaw)
'"
}

# ═══════════════════════════════════════════════════════════════════════════
#  3. Start-yaw erfassen
# ═══════════════════════════════════════════════════════════════════════════
echo "[1/3] Capturing starting yaw on ${TOPIC}..."
YAW_START="$(read_yaw)"
if [ -z "$YAW_START" ]; then
  echo "[yaw-drift-test] Could not read starting yaw from ${TOPIC}" >&2
  exit 1
fi
echo "      start yaw: ${YAW_START} rad"

# ═══════════════════════════════════════════════════════════════════════════
#  4. DURATION Sekunden warten (stationary hold)
# ═══════════════════════════════════════════════════════════════════════════
echo "[2/3] Sleeping ${DURATION}s — keep the mower absolutely still..."
sleep "$DURATION"

# ═══════════════════════════════════════════════════════════════════════════
#  5. End-yaw erfassen
# ═══════════════════════════════════════════════════════════════════════════
echo "[3/3] Capturing ending yaw on ${TOPIC}..."
YAW_END="$(read_yaw)"
if [ -z "$YAW_END" ]; then
  echo "[yaw-drift-test] Could not read ending yaw from ${TOPIC}" >&2
  exit 1
fi
echo "      end yaw:   ${YAW_END} rad"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
#  6. Δ berechnen in Grad, unwrapped ueber ±π (vermeidet 359° false-positives)
# ═══════════════════════════════════════════════════════════════════════════
DELTA_DEG="$(python3 -c "
import math
a = float('${YAW_START}')
b = float('${YAW_END}')
d = b - a
while d >  math.pi: d -= 2*math.pi
while d < -math.pi: d += 2*math.pi
print(f'{abs(math.degrees(d)):.2f}')
")"

# ═══════════════════════════════════════════════════════════════════════════
#  7. PASS/FAIL-Zeile ausgeben (matches plan regex, D-17)
# ═══════════════════════════════════════════════════════════════════════════
if python3 -c "import sys; sys.exit(0 if float('${DELTA_DEG}') < 1.0 else 1)"; then
  echo "Δyaw = ${DELTA_DEG}° over ${DURATION}s — PASS"
  exit 0
else
  echo "Δyaw = ${DELTA_DEG}° over ${DURATION}s — FAIL (<1°)"
  exit 1
fi
