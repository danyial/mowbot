"use client";

import { create } from "zustand";
import type { NavSatFix, FixStatus } from "@/lib/types/ros-messages";
import { getFixStatus } from "@/lib/types/ros-messages";

interface GpsState {
  latitude: number | null;
  longitude: number | null;
  altitude: number;
  fixStatus: FixStatus;
  hdop: number;
  accuracy: number; // horizontal accuracy in meters (from covariance)
  satelliteCount: number;
  lastUpdate: number;

  // Track (driven path)
  track: [number, number][];
  isRecording: boolean;

  // Garden Polygon boundary recording
  gardenBoundary: [number, number][] | null;
  isRecordingBoundary: boolean;
  boundaryPoints: [number, number][];

  // Actions
  updateFix: (msg: NavSatFix) => void;
  startTrackRecording: () => void;
  stopTrackRecording: () => void;
  clearTrack: () => void;
  startBoundaryRecording: () => void;
  stopBoundaryRecording: () => [number, number][];
  cancelBoundaryRecording: () => void;
}

export const useGpsStore = create<GpsState>((set, get) => ({
  latitude: null,
  longitude: null,
  altitude: 0,
  fixStatus: "no_fix",
  hdop: 99,
  accuracy: -1,
  satelliteCount: 0,
  lastUpdate: 0,

  track: [],
  isRecording: false,

  gardenBoundary: null,
  isRecordingBoundary: false,
  boundaryPoints: [],

  updateFix: (msg: NavSatFix) => {
    const fixStatus = getFixStatus(
      msg.status.status,
      msg.position_covariance_type
    );

    const state = get();
    const newTrack = state.isRecording
      ? [...state.track, [msg.latitude, msg.longitude] as [number, number]]
      : state.track;

    const newBoundaryPoints = state.isRecordingBoundary
      ? [...state.boundaryPoints, [msg.latitude, msg.longitude] as [number, number]]
      : state.boundaryPoints;

    // Estimate HDOP from covariance (simplified)
    const hdop =
      msg.position_covariance_type > 0 && msg.position_covariance[0] > 0
        ? Math.sqrt(msg.position_covariance[0])
        : 99;

    // Horizontal accuracy in meters from covariance diagonal
    // covariance[0] = variance lat (m²), covariance[4] = variance lon (m²)
    const covLat = msg.position_covariance[0];
    const covLon = msg.position_covariance[4];
    const accuracy =
      msg.position_covariance_type > 0 &&
      covLat != null && covLon != null &&
      isFinite(covLat) && isFinite(covLon) &&
      covLat > 0 && covLon > 0
        ? Math.sqrt((covLat + covLon) / 2)
        : -1;

    set({
      latitude: msg.latitude,
      longitude: msg.longitude,
      altitude: msg.altitude,
      fixStatus,
      hdop,
      accuracy,
      lastUpdate: Date.now(),
      track: newTrack,
      boundaryPoints: newBoundaryPoints,
    });
  },

  startTrackRecording: () => set({ isRecording: true }),
  stopTrackRecording: () => set({ isRecording: false }),
  clearTrack: () => set({ track: [] }),

  startBoundaryRecording: () =>
    set({ isRecordingBoundary: true, boundaryPoints: [] }),

  stopBoundaryRecording: () => {
    const points = get().boundaryPoints;
    set({
      isRecordingBoundary: false,
      gardenBoundary: points.length >= 3 ? points : null,
    });
    return points;
  },

  cancelBoundaryRecording: () =>
    set({ isRecordingBoundary: false, boundaryPoints: [] }),
}));
