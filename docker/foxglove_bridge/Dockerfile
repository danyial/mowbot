# docker/foxglove_bridge/Dockerfile
# Foxglove WebSocket bridge — native protocol (port 8765)
# Runs alongside rosbridge (9090); used by Foxglove Studio.
# Avoids the rosbridge_server v2 JSON serializer bug that throws
# on float[]-bearing messages (LaserScan, Odometry, TFMessage).
ARG ROS_DISTRO=humble
FROM ros:${ROS_DISTRO}-ros-base

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-foxglove-bridge \
    && rm -rf /var/lib/apt/lists/*

CMD ["bash", "-c", "source /opt/ros/humble/setup.bash && exec ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=8765 address:=0.0.0.0"]
