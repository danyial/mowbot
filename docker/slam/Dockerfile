FROM ros:humble-ros-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-humble-slam-toolbox \
    ros-humble-rmw-cyclonedds-cpp \
 && rm -rf /var/lib/apt/lists/*

ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
# NOTE: CYCLONEDDS_URI is intentionally NOT set. The repo's cyclonedds.xml
# requests SocketReceiveBufferSize min=10MB, but the Pi's net.core.rmem_max
# is 212992 (~208 KB) — below the floor — causing rmw_create_node to fail
# with "failed to create domain" (see Plan 04-01 Task 5 deviation, Rule 1).
# All other containers in this stack also leave CYCLONEDDS_URI unset and use
# CycloneDDS defaults. Follow that convention.

# NOTE: use_sim_time:=false is MANDATORY (RESEARCH Pitfall #7).
# Upstream online_async_launch.py defaults to use_sim_time: true which
# makes the node wait for /clock forever. Defense-in-depth: also set in
# docker-compose command. Do NOT remove either instance.
CMD ["ros2", "launch", "slam_toolbox", "online_async_launch.py", \
     "slam_params_file:=/config/slam_toolbox_params.yaml", \
     "use_sim_time:=false"]
