"use client";

import { create } from "zustand";
import { connect, disconnect, retryNow, onConnection, onError, getRos } from "@/lib/ros/ros-client";
import { subscribe } from "@/lib/ros/subscribers";
import { useGpsStore } from "@/lib/store/gps-store";
import { useImuStore } from "@/lib/store/imu-store";
import { useBatteryStore } from "@/lib/store/battery-store";
import { useOdometryStore } from "@/lib/store/odometry-store";
import { useMissionStore } from "@/lib/store/mission-store";
import { useScanStore } from "@/lib/store/scan-store";
import { useMapStore } from "@/lib/store/map-store";
import { useSlamPoseStore } from "@/lib/store/slam-pose-store";
import type {
  NavSatFix,
  ImuMessage,
  Float32,
  Odometry,
  StringMsg,
  MowerStatus,
  LaserScan,
  OccupancyGrid,
  PoseWithCovarianceStamped,
} from "@/lib/types/ros-messages";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

interface RosState {
  connected: boolean;
  status: ConnectionStatus;
  url: string;
  lastError: string | null;
  latency: number;
  initialized: boolean;

  init: () => void;
  setUrl: (url: string) => void;
  disconnectRos: () => void;
  retryConnection: () => void;
}

// Persist subscription tracking on window to survive HMR
function getActiveSubscriptions(): Array<{ unsubscribe: () => void }> {
  if (typeof window === "undefined") return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!w.__mower_active_subs) w.__mower_active_subs = [];
  return w.__mower_active_subs;
}

function setActiveSubscriptions(subs: Array<{ unsubscribe: () => void }>) {
  if (typeof window === "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__mower_active_subs = subs;
}

function cleanupSubscriptions() {
  const subs = getActiveSubscriptions();
  subs.forEach((s) => s.unsubscribe());
  setActiveSubscriptions([]);
}

function setupSubscriptions() {
  if (getActiveSubscriptions().length > 0) return;

  const subs = [
    subscribe<NavSatFix>("FIX", (msg) => {
      useGpsStore.getState().updateFix(msg);
    }),
    subscribe<ImuMessage>("IMU", (msg) => {
      useImuStore.getState().updateImu(msg);
    }),
    subscribe<Float32>("BATTERY", (msg) => {
      useBatteryStore.getState().updateBattery(msg);
    }),
    subscribe<Odometry>("ODOMETRY", (msg) => {
      useOdometryStore.getState().updateOdometry(msg);
    }),
    subscribe<LaserScan>("SCAN", (msg) => {
      useScanStore.getState().updateScan(msg);
    }),
    subscribe<OccupancyGrid>("MAP", (msg) => {
      useMapStore.getState().updateMap(msg);
    }),
    subscribe<PoseWithCovarianceStamped>("POSE", (msg) => {
      useSlamPoseStore.getState().updatePose(msg);
    }),
    subscribe<StringMsg>("MOWER_STATUS", (msg) => {
      try {
        const status: MowerStatus = JSON.parse(msg.data);
        const missionStore = useMissionStore.getState();
        if (status.mission_id) {
          missionStore.updateProgress(
            status.mission_id,
            status.progress,
            []
          );
          if (status.state === "idle" && status.progress >= 100) {
            missionStore.updateMissionStatus(status.mission_id, "completed");
          }
        }
      } catch {
        // Invalid JSON, ignore
      }
    }),
  ];

  setActiveSubscriptions(subs);
}

// Create the store FIRST so useRosStore.setState is available when listeners fire.
export const useRosStore = create<RosState>(() => ({
  connected: false,
  status: "disconnected",
  url: process.env.NEXT_PUBLIC_ROSBRIDGE_URL || "ws://mower.local:9090",
  lastError: null,
  latency: 0,
  initialized: false,

  init: () => {
    const state = useRosStore.getState();
    if (state.initialized) return;

    // If we already have a connected instance (HMR reload), just sync state
    if (getRos()?.isConnected) {
      useRosStore.setState({
        initialized: true,
        connected: true,
        status: "connected",
      });
      setupSubscriptions();
      return;
    }

    useRosStore.setState({ initialized: true, status: "connecting" });
    connect(state.url);
  },

  setUrl: (url: string) => {
    cleanupSubscriptions();
    disconnect();
    useRosStore.setState({ url, status: "connecting", initialized: true });
    connect(url);
  },

  disconnectRos: () => {
    cleanupSubscriptions();
    disconnect();
    useRosStore.setState({ connected: false, status: "disconnected", initialized: false });
  },

  retryConnection: () => {
    cleanupSubscriptions();
    useRosStore.setState({ status: "connecting", lastError: null });
    retryNow();
  },
}));

// Register keyed listeners AFTER the store exists.
// On HMR reload, the old callback with key "store" is replaced by the new one.
onConnection((connected) => {
  useRosStore.setState({
    connected,
    status: connected ? "connected" : "reconnecting",
    lastError: connected ? null : useRosStore.getState().lastError,
  });

  if (connected) {
    setTimeout(() => {
      if (getRos()?.isConnected) {
        setupSubscriptions();
      }
    }, 150);
  } else {
    cleanupSubscriptions();
  }
}, "store");

onError((error) => {
  useRosStore.setState({ lastError: error });
}, "store");
