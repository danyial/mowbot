# docker/imu/Dockerfile
ARG ROS_DISTRO=humble
FROM ros:${ROS_DISTRO}-ros-base

ENV DEBIAN_FRONTEND=noninteractive
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-${ROS_DISTRO}-rmw-cyclonedds-cpp \
    libi2c-dev \
    i2c-tools \
    git \
    && rm -rf /var/lib/apt/lists/*

# MPU6050-Treiber aus Source
WORKDIR /ws
RUN mkdir -p src && \
    git clone https://github.com/hiwad-aziz/ros2_mpu6050_driver.git src/mpu6050driver && \
    . /opt/ros/${ROS_DISTRO}/setup.sh && \
    rosdep update && \
    rosdep install --from-paths src --ignore-src -y && \
    colcon build --packages-select mpu6050driver && \
    rm -rf build log src

COPY ros_entrypoint.sh /ros_entrypoint.sh
RUN chmod +x /ros_entrypoint.sh
ENTRYPOINT ["/ros_entrypoint.sh"]
