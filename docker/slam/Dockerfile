FROM ros:humble-ros-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-humble-slam-toolbox \
    ros-humble-rmw-cyclonedds-cpp \
 && rm -rf /var/lib/apt/lists/*

ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
ENV CYCLONEDDS_URI=file:///config/cyclonedds.xml

# NOTE: use_sim_time:=false is MANDATORY (RESEARCH Pitfall #7).
# Upstream online_async_launch.py defaults to use_sim_time: true which
# makes the node wait for /clock forever. Defense-in-depth: also set in
# docker-compose command. Do NOT remove either instance.
CMD ["ros2", "launch", "slam_toolbox", "online_async_launch.py", \
     "slam_params_file:=/config/slam_toolbox_params.yaml", \
     "use_sim_time:=false"]
