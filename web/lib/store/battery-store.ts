"use client";

import { create } from "zustand";
import type { Float32 } from "@/lib/types/ros-messages";

interface BatteryState {
  voltage: number;
  percent: number;
  lastUpdate: number;

  updateBattery: (msg: Float32) => void;
}

function voltageToPercent(voltage: number): number {
  const min = 9.0;
  const max = 12.6;
  return Math.max(0, Math.min(100, ((voltage - min) / (max - min)) * 100));
}

export const useBatteryStore = create<BatteryState>((set) => ({
  voltage: 0,
  percent: 0,
  lastUpdate: 0,

  updateBattery: (msg: Float32) => {
    set({
      voltage: msg.data,
      percent: voltageToPercent(msg.data),
      lastUpdate: Date.now(),
    });
  },
}));
