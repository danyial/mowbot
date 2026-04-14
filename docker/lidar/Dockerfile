# docker/lidar/Dockerfile
ARG ROS_DISTRO=humble
FROM ros:${ROS_DISTRO}-ros-base

ARG LDLIDAR_SHA=bf668a89baf722a787dadc442860dcbf33a82f5a

ENV DEBIAN_FRONTEND=noninteractive
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-rmw-cyclonedds-cpp \
    git \
    build-essential \
    python3-colcon-common-extensions \
    && rm -rf /var/lib/apt/lists/*

# Clone + pin driver
RUN mkdir -p /ros2_ws/src && \
    git clone https://github.com/ldrobotSensorTeam/ldlidar_stl_ros2.git /ros2_ws/src/ldlidar_stl_ros2 && \
    git -C /ros2_ws/src/ldlidar_stl_ros2 checkout ${LDLIDAR_SHA}

# Patch: force SensorDataQoS on the /scan publisher
# (Upstream uses RELIABLE QoS depth-10; CONTEXT D-17 requires BEST_EFFORT KEEP_LAST 5.)
RUN sed -i \
    's|create_publisher<sensor_msgs::msg::LaserScan>(topic_name, 10)|create_publisher<sensor_msgs::msg::LaserScan>(topic_name, rclcpp::SensorDataQoS())|' \
    /ros2_ws/src/ldlidar_stl_ros2/src/demo.cpp && \
    grep -q 'SensorDataQoS' /ros2_ws/src/ldlidar_stl_ros2/src/demo.cpp || (echo "QoS patch FAILED" && exit 1)

# Build
RUN . /opt/ros/${ROS_DISTRO}/setup.sh && \
    cd /ros2_ws && \
    colcon build --packages-select ldlidar_stl_ros2 --cmake-args -DCMAKE_BUILD_TYPE=Release

# MowerBot launch file
COPY launch/lidar.launch.py /launch/lidar.launch.py

COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]
