#!/usr/bin/env python3
"""
Reads NMEA sentences from a serial port and publishes each one on /nmea_sentence
as nmea_msgs/Sentence. Drop-in replacement for the upstream
`nmea_topic_serial_reader` executable, which in ROS 2 Humble has a bug where
it assigns raw `bytes` to the msg.sentence field without decoding (crashes on
first read with "The 'sentence' field must be of type 'str'").

Paired with nmea_topic_driver from the stock nmea_navsat_driver package — the
pair replaces nmea_serial_driver and exposes the raw NMEA stream on
/nmea_sentence so the web client can parse GGA (fix quality 4=Fixed vs
5=Float, satellite count, correction age) in addition to /fix.
"""
import rclpy
from rclpy.node import Node
from nmea_msgs.msg import Sentence
import serial


class NmeaSerialBridge(Node):
    def __init__(self) -> None:
        super().__init__("nmea_serial_bridge")
        self.declare_parameter("port", "/dev/ttyGNSS")
        self.declare_parameter("baud", 115200)
        self.declare_parameter("frame_id", "gps_link")

        port = self.get_parameter("port").value
        baud = int(self.get_parameter("baud").value)
        self._frame_id = self.get_parameter("frame_id").value

        self._pub = self.create_publisher(Sentence, "nmea_sentence", 10)
        self._ser = serial.Serial(port, baud, timeout=1.0)
        self.get_logger().info(f"opened {port} @ {baud} baud, publishing /nmea_sentence")
        self.create_timer(0.01, self._poll)  # 100 Hz poll — serial is line-buffered anyway

    def _poll(self) -> None:
        try:
            raw = self._ser.readline()
        except serial.SerialException as e:
            self.get_logger().error(f"serial read error: {e}")
            return
        if not raw:
            return
        try:
            line = raw.decode("ascii", errors="replace").strip()
        except Exception as e:
            self.get_logger().warning(f"decode error: {e}")
            return
        if not line.startswith("$"):
            return
        msg = Sentence()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = self._frame_id
        msg.sentence = line
        self._pub.publish(msg)


def main() -> None:
    rclpy.init()
    node = NmeaSerialBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
