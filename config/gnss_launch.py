# Splits the stock nmea_navsat_driver into two nodes so the raw NMEA stream is
# exposed on /nmea_sentence in addition to the decoded /fix, /vel, /time_reference.
#
# Why: /fix (sensor_msgs/NavSatFix) cannot distinguish RTK Fixed (GGA quality=4)
# from RTK Float (GGA quality=5) — nmea_navsat_driver maps both to
# NavSatStatus.status=2 (GBAS_FIX). Downstream consumers (web UI) parse GGA
# directly from /nmea_sentence to recover the true RTK mode plus satellite
# count and correction age.
from launch import LaunchDescription
from launch_ros.actions import Node
from launch.substitutions import LaunchConfiguration
from launch.actions import DeclareLaunchArgument


def generate_launch_description():
    port = LaunchConfiguration("port")
    baud = LaunchConfiguration("baud")
    frame_id = LaunchConfiguration("frame_id")

    return LaunchDescription([
        DeclareLaunchArgument("port", default_value="/dev/ttyGNSS"),
        DeclareLaunchArgument("baud", default_value="115200"),
        DeclareLaunchArgument("frame_id", default_value="gps_link"),

        # 1. Reads the UART and publishes every NMEA sentence as nmea_msgs/Sentence
        Node(
            package="nmea_navsat_driver",
            executable="nmea_topic_serial_reader",
            name="nmea_serial_reader",
            output="screen",
            parameters=[{
                "port": port,
                "baud": baud,
                "frame_id": frame_id,
            }],
        ),

        # 2. Consumes /nmea_sentence and publishes /fix, /vel, /time_reference
        #    — drop-in replacement for the prior single-node nmea_serial_driver
        Node(
            package="nmea_navsat_driver",
            executable="nmea_topic_driver",
            name="nmea_navsat_driver",
            output="screen",
            parameters=[{
                "frame_id": frame_id,
                "time_ref_source": "gps",
                "useRMC": False,
                "use_GNSS_time": False,
            }],
        ),
    ])
