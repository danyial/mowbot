#!/bin/bash
# Wird von allen ROS2-Containern als ENTRYPOINT genutzt
set -e

source /opt/ros/${ROS_DISTRO:-humble}/setup.bash

# Falls ein lokaler Workspace existiert
if [ -f /ws/install/setup.bash ]; then
    source /ws/install/setup.bash
fi

exec "$@"
