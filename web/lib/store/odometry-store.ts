"use client";

import { create } from "zustand";
import type { Odometry } from "@/lib/types/ros-messages";

interface OdometryState {
  linearSpeed: number; // m/s
  angularSpeed: number; // rad/s
  posX: number;
  posY: number;
  lastUpdate: number;

  updateOdometry: (msg: Odometry) => void;
}

export const useOdometryStore = create<OdometryState>((set) => ({
  linearSpeed: 0,
  angularSpeed: 0,
  posX: 0,
  posY: 0,
  lastUpdate: 0,

  updateOdometry: (msg: Odometry) => {
    set({
      linearSpeed: Math.sqrt(
        msg.twist.twist.linear.x ** 2 + msg.twist.twist.linear.y ** 2
      ),
      angularSpeed: msg.twist.twist.angular.z,
      posX: msg.pose.pose.position.x,
      posY: msg.pose.pose.position.y,
      lastUpdate: Date.now(),
    });
  },
}));
