"use client";

import { create } from "zustand";

interface TeleopState {
  linearX: number;
  angularZ: number;
  maxLinear: number;
  maxAngular: number;
  isActive: boolean;
  isLocked: boolean; // Emergency stop active

  setVelocity: (linear: number, angular: number) => void;
  setActive: (active: boolean) => void;
  emergencyStop: () => void;
  unlock: () => void;
  setMaxLinear: (v: number) => void;
  setMaxAngular: (v: number) => void;
}

export const useTeleopStore = create<TeleopState>((set) => ({
  linearX: 0,
  angularZ: 0,
  maxLinear: 0.5,
  maxAngular: 1.0,
  isActive: false,
  isLocked: false,

  setVelocity: (linear: number, angular: number) =>
    set({ linearX: linear, angularZ: angular }),

  setActive: (active: boolean) => set({ isActive: active }),

  emergencyStop: () =>
    set({ isLocked: true, linearX: 0, angularZ: 0, isActive: false }),

  unlock: () => set({ isLocked: false }),

  setMaxLinear: (v: number) => set({ maxLinear: v }),
  setMaxAngular: (v: number) => set({ maxAngular: v }),
}));
