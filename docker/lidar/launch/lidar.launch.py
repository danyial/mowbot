"""MowerBot LD19 LiDAR launch - driver + static base_link->laser_frame TF.

Copied and modified from upstream ldlidar_stl_ros2/launch/ld19.launch.py
(SHA: bf668a89baf722a787dadc442860dcbf33a82f5a).
"""

from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():

    ldlidar_node = Node(
        package='ldlidar_stl_ros2',
        executable='ldlidar_stl_ros2_node',
        name='ldlidar_ld19',
        output='screen',
        parameters=[
            {'product_name': 'LDLiDAR_LD19'},
            {'topic_name': 'scan'},
            {'frame_id': 'laser_frame'},
            {'port_name': '/dev/ttyLIDAR'},
            {'port_baudrate': 230400},
            {'laser_scan_dir': True},
            # TODO(lidar-mount): enable angle crop once chassis self-hit
            # sectors are measured. See docs/lidar-mount.md. Defaults below
            # are the vendor values (rear hemisphere mask) and are inactive
            # while enable_angle_crop_func is False.
            {'enable_angle_crop_func': False},
            {'angle_crop_min': 135.0},
            {'angle_crop_max': 225.0},
        ],
    )

    # TODO(lidar-mount): replace zero placeholders with measured values.
    # Procedure: docs/lidar-mount.md. Format: [x, y, z, yaw, pitch, roll,
    # parent, child]. x forward (m), y left (m), z up (m), yaw around z (rad,
    # 0 = LD19 cable pointing backward per D500-STL-19P-Datasheet 5.5).
    base_link_to_laser_frame_tf = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='base_link_to_laser_frame',
        arguments=[
            '0', '0', '0',       # x y z  (meters)
            '0', '0', '0',       # yaw pitch roll  (radians)
            'base_link',
            'laser_frame',
        ],
    )

    ld = LaunchDescription()
    ld.add_action(ldlidar_node)
    ld.add_action(base_link_to_laser_frame_tf)
    return ld
