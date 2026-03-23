"use client";

import { create } from "zustand";
import type { ImuMessage } from "@/lib/types/ros-messages";
import { quaternionToEuler } from "@/lib/utils/quaternion";

const DEFAULT_TILT_THRESHOLD = 15; // degrees
const DEFAULT_SMOOTHING = 0.15; // EMA alpha (0.05 = very smooth, 1.0 = no smoothing)

interface ImuState {
  roll: number; // corrected + smoothed
  pitch: number; // corrected + smoothed
  yaw: number; // smoothed
  rawRoll: number; // uncorrected, unsmoothed (for calibration)
  rawPitch: number; // uncorrected, unsmoothed
  rollOffset: number; // calibration offset in degrees
  pitchOffset: number; // calibration offset in degrees
  hasOrientation: boolean;
  vibration: number; // smoothed
  linearAccel: { x: number; y: number; z: number };
  angularVel: { x: number; y: number; z: number };
  isTilted: boolean;
  tiltThreshold: number;
  smoothingFactor: number; // EMA alpha
  lastUpdate: number;

  updateImu: (msg: ImuMessage) => void;
  setTiltThreshold: (deg: number) => void;
  setSmoothingFactor: (alpha: number) => void;
  setOffset: (roll: number, pitch: number) => void;
  calibrate: () => void;
}

/**
 * Estimate roll and pitch from accelerometer data (gravity vector).
 */
function accelToRollPitch(ax: number, ay: number, az: number): { roll: number; pitch: number } {
  const RAD_TO_DEG = 180 / Math.PI;
  const roll = Math.atan2(ay, Math.sqrt(ax * ax + az * az)) * RAD_TO_DEG;
  const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az)) * RAD_TO_DEG;
  return { roll, pitch };
}

/**
 * Exponential Moving Average: smoothed = α * newValue + (1 - α) * prevSmoothed
 */
function ema(newVal: number, prevVal: number, alpha: number): number {
  return alpha * newVal + (1 - alpha) * prevVal;
}

export const useImuStore = create<ImuState>((set, get) => ({
  roll: 0,
  pitch: 0,
  yaw: 0,
  rawRoll: 0,
  rawPitch: 0,
  rollOffset: 0,
  pitchOffset: 0,
  hasOrientation: false,
  vibration: 0,
  linearAccel: { x: 0, y: 0, z: 0 },
  angularVel: { x: 0, y: 0, z: 0 },
  isTilted: false,
  tiltThreshold: DEFAULT_TILT_THRESHOLD,
  smoothingFactor: DEFAULT_SMOOTHING,
  lastUpdate: 0,

  updateImu: (msg: ImuMessage) => {
    const state = get();
    const { tiltThreshold, rollOffset, pitchOffset, smoothingFactor, lastUpdate } = state;

    // Check if orientation data is available
    const orientationAvailable =
      msg.orientation_covariance &&
      msg.orientation_covariance[0] !== -1 &&
      !(msg.orientation.x === 0 && msg.orientation.y === 0 &&
        msg.orientation.z === 0 && msg.orientation.w === 0);

    let rawRoll: number;
    let rawPitch: number;
    let rawYaw: number;

    if (orientationAvailable) {
      const euler = quaternionToEuler(msg.orientation);
      rawRoll = euler.roll;
      rawPitch = euler.pitch;
      rawYaw = euler.yaw;
    } else {
      const rp = accelToRollPitch(
        msg.linear_acceleration.x,
        msg.linear_acceleration.y,
        msg.linear_acceleration.z
      );
      rawRoll = rp.roll;
      rawPitch = rp.pitch;
      rawYaw = 0;
    }

    // Apply calibration offset
    const correctedRoll = rawRoll - rollOffset;
    const correctedPitch = rawPitch - pitchOffset;

    // Vibration: deviation of acceleration magnitude from gravity
    const ax = msg.linear_acceleration.x;
    const ay = msg.linear_acceleration.y;
    const az = msg.linear_acceleration.z;
    const accelMag = Math.sqrt(ax * ax + ay * ay + az * az);
    const rawVibration = Math.abs(accelMag - 9.81);

    // Apply EMA smoothing (skip on first update to avoid smoothing from 0)
    const isFirstUpdate = lastUpdate === 0;
    const alpha = smoothingFactor;

    const smoothedRoll = isFirstUpdate ? correctedRoll : ema(correctedRoll, state.roll, alpha);
    const smoothedPitch = isFirstUpdate ? correctedPitch : ema(correctedPitch, state.pitch, alpha);
    const smoothedYaw = isFirstUpdate ? rawYaw : ema(rawYaw, state.yaw, alpha);
    const smoothedVibration = isFirstUpdate ? rawVibration : ema(rawVibration, state.vibration, alpha);

    const isTilted =
      Math.abs(smoothedRoll) > tiltThreshold || Math.abs(smoothedPitch) > tiltThreshold;

    set({
      roll: smoothedRoll,
      pitch: smoothedPitch,
      yaw: smoothedYaw,
      rawRoll,
      rawPitch,
      hasOrientation: !!orientationAvailable,
      vibration: smoothedVibration,
      linearAccel: {
        x: msg.linear_acceleration.x,
        y: msg.linear_acceleration.y,
        z: msg.linear_acceleration.z,
      },
      angularVel: {
        x: msg.angular_velocity.x,
        y: msg.angular_velocity.y,
        z: msg.angular_velocity.z,
      },
      isTilted,
      lastUpdate: Date.now(),
    });
  },

  setTiltThreshold: (deg: number) => set({ tiltThreshold: deg }),
  setSmoothingFactor: (alpha: number) => set({ smoothingFactor: alpha }),

  setOffset: (rollOffset: number, pitchOffset: number) =>
    set({ rollOffset, pitchOffset }),

  calibrate: () => {
    const { rawRoll, rawPitch } = get();
    set({ rollOffset: rawRoll, pitchOffset: rawPitch });
  },
}));
