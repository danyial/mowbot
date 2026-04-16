"use client";

import { create } from "zustand";
import type { NavSatFix, FixStatus, GgaFields } from "@/lib/types/ros-messages";
import { getFixStatus, GGA_QUALITY_TO_FIX_STATUS } from "@/lib/types/ros-messages";

// Minimum distance in meters between boundary recording points
const BOUNDARY_MIN_DISTANCE_M = 0.5;

/** Quick Haversine distance in meters between two lat/lon points */
function quickDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface GpsState {
  latitude: number | null;
  longitude: number | null;
  altitude: number;
  fixStatus: FixStatus;
  fixStatusCode: number; // raw NavSatStatus.status value (-1..2); -2 = never received
  hdop: number;
  accuracy: number; // horizontal accuracy 1σ in meters (from covariance)
  verticalAccuracy: number; // vertical accuracy 1σ in meters (covariance[8]); -1 if unknown
  covarianceType: number; // 0=unknown, 1=approximated, 2=diag_known, 3=known
  satelliteCount: number;
  lastUpdate: number;

  // GGA-sourced fields — authoritative for RTK Fixed vs Float (sensor_msgs/NavSatFix
  // loses the distinction, see 07-RESEARCH.md Phase 7 follow-up).
  nmeaFixQuality: number;     // GGA field 6; 0-8, -1 if never received
  correctionAge: number;      // GGA field 14 (seconds); -1 if unknown
  nmeaLastUpdate: number;     // ms epoch of last GGA

  // Track (driven path)
  track: [number, number][];
  isRecording: boolean;

  // Garden Polygon boundary recording
  gardenBoundary: [number, number][] | null;
  isRecordingBoundary: boolean;
  boundaryPoints: [number, number][];

  // Actions
  updateFix: (msg: NavSatFix) => void;
  updateGga: (fields: GgaFields) => void;
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
  fixStatusCode: -2,
  hdop: 99,
  accuracy: -1,
  verticalAccuracy: -1,
  covarianceType: 0,
  satelliteCount: 0,
  lastUpdate: 0,

  nmeaFixQuality: -1,
  correctionAge: -1,
  nmeaLastUpdate: 0,

  track: [],
  isRecording: false,

  gardenBoundary: null,
  isRecordingBoundary: false,
  boundaryPoints: [],

  updateFix: (msg: NavSatFix) => {
    const state = get();
    // If we received a GGA within the last 2 seconds, its fixStatus wins —
    // GGA distinguishes RTK Fixed (quality=4) from RTK Float (quality=5), which
    // NavSatFix collapses into NavSatStatus.status=2. See 07-RESEARCH.md.
    const ggaFresh =
      state.nmeaLastUpdate > 0 && Date.now() - state.nmeaLastUpdate < 2000;
    const fixStatus = ggaFresh
      ? state.fixStatus
      : getFixStatus(msg.status.status, msg.position_covariance_type);

    const newTrack = state.isRecording
      ? [...state.track, [msg.latitude, msg.longitude] as [number, number]]
      : state.track;

    // Only record boundary point if minimum distance from last point is met
    let newBoundaryPoints = state.boundaryPoints;
    if (state.isRecordingBoundary) {
      const lastPt = state.boundaryPoints[state.boundaryPoints.length - 1];
      const shouldAdd =
        !lastPt ||
        quickDistance(lastPt[0], lastPt[1], msg.latitude, msg.longitude) >=
          BOUNDARY_MIN_DISTANCE_M;
      if (shouldAdd) {
        newBoundaryPoints = [
          ...state.boundaryPoints,
          [msg.latitude, msg.longitude] as [number, number],
        ];
      }
    }

    // Estimate HDOP from covariance (simplified)
    const hdop =
      msg.position_covariance_type > 0 && msg.position_covariance[0] > 0
        ? Math.sqrt(msg.position_covariance[0])
        : 99;

    // Horizontal accuracy in meters from covariance diagonal (1σ)
    // covariance[0] = variance east (m²), covariance[4] = variance north (m²), covariance[8] = variance up
    const covLat = msg.position_covariance[0];
    const covLon = msg.position_covariance[4];
    const covUp = msg.position_covariance[8];
    const accuracy =
      msg.position_covariance_type > 0 &&
      covLat != null && covLon != null &&
      isFinite(covLat) && isFinite(covLon) &&
      covLat > 0 && covLon > 0
        ? Math.sqrt((covLat + covLon) / 2)
        : -1;
    const verticalAccuracy =
      msg.position_covariance_type > 0 &&
      covUp != null && isFinite(covUp) && covUp > 0
        ? Math.sqrt(covUp)
        : -1;

    set({
      latitude: msg.latitude,
      longitude: msg.longitude,
      altitude: msg.altitude,
      fixStatus,
      fixStatusCode: msg.status.status,
      hdop,
      accuracy,
      verticalAccuracy,
      covarianceType: msg.position_covariance_type,
      lastUpdate: Date.now(),
      track: newTrack,
      boundaryPoints: newBoundaryPoints,
    });
  },

  updateGga: (fields: GgaFields) => {
    const fixStatus =
      GGA_QUALITY_TO_FIX_STATUS[fields.fixQuality] ?? "no_fix";
    set({
      fixStatus,                          // authoritative — overrides the /fix mapping
      nmeaFixQuality: fields.fixQuality,
      satelliteCount: fields.satelliteCount,
      correctionAge: fields.correctionAge,
      hdop: Number.isFinite(fields.hdop) ? fields.hdop : 99,
      nmeaLastUpdate: Date.now(),
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
