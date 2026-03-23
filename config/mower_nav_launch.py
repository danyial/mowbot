"""Launch-Datei fuer den Navigation-Container."""

import os
from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    config_dir = "/config"

    return LaunchDescription(
        [
            # EKF (Sensor-Fusion: IMU + GNSS)
            Node(
                package="robot_localization",
                executable="ekf_node",
                name="ekf_filter_node",
                output="screen",
                parameters=[os.path.join(config_dir, "ekf.yaml")],
            ),
            # NavSat Transform (GPS lat/lon -> Odometrie x/y)
            Node(
                package="robot_localization",
                executable="navsat_transform_node",
                name="navsat_transform_node",
                output="screen",
                parameters=[os.path.join(config_dir, "ekf.yaml")],
                remappings=[
                    ("imu", "/imu"),
                    ("gps/fix", "/fix"),
                    ("odometry/filtered", "/odometry/filtered"),
                ],
            ),
            # Nav2 Bringup (Controller, Planner, BT Navigator)
            # Wird aktiviert sobald eine Karte/Mission gestartet wird
            # Fuer den PoC erstmal nur EKF + NavSat Transform
        ]
    )
