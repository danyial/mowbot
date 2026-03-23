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
