"use client";

import { create } from "zustand";
import type { Mission, CreateMissionInput } from "@/lib/types/mission";
import { publishMowerCommand } from "@/lib/ros/publishers";

interface MissionState {
  missions: Mission[];
  activeMission: string | null;
  isLoading: boolean;

  fetchMissions: () => Promise<void>;
  createMission: (data: CreateMissionInput) => Promise<void>;
  startMission: (id: string) => void;
  pauseMission: (missionId?: string) => void;
  resumeMission: (missionId?: string) => void;
  stopMission: (missionId?: string) => void;
  returnHome: () => void;
  deleteMission: (id: string) => Promise<void>;
  updateProgress: (missionId: string, progress: number, completedPoints: [number, number][]) => void;
  updateMissionStatus: (missionId: string, status: Mission["status"]) => void;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  missions: [],
  activeMission: null,
  isLoading: false,

  fetchMissions: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/missions");
      if (res.ok) {
        const missions: Mission[] = await res.json();
        // Auto-detect active mission after load
        const active = missions.find(
          (m) => m.status === "running" || m.status === "paused"
        );
        set({
          missions,
          isLoading: false,
          activeMission: active?.id ?? null,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  createMission: async (data: CreateMissionInput) => {
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await get().fetchMissions();
      }
    } catch {
      // Error handled by UI
    }
  },

  startMission: (id: string) => {
    publishMowerCommand({ action: "start_mission", mission_id: id });
    set({ activeMission: id });

    // Update local state
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === id
          ? { ...m, status: "running" as const, startedAt: new Date().toISOString() }
          : m
      ),
    }));

    // Also update on server
    fetch(`/api/missions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "running", startedAt: new Date().toISOString() }),
    }).catch(() => {});
  },

  pauseMission: (missionId?) => {
    const id = missionId || get().activeMission;
    if (!id) return;
    publishMowerCommand({ action: "pause_mission" });
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === id ? { ...m, status: "paused" as const } : m
      ),
    }));
    // Persist to server
    fetch("/api/missions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "paused" }),
    }).catch(() => {});
  },

  resumeMission: (missionId?) => {
    const id = missionId || get().activeMission;
    if (!id) return;
    publishMowerCommand({ action: "resume_mission" });
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === id ? { ...m, status: "running" as const } : m
      ),
      activeMission: id,
    }));
    fetch("/api/missions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "running" }),
    }).catch(() => {});
  },

  stopMission: (missionId?) => {
    const id = missionId || get().activeMission;
    if (!id) return;
    publishMowerCommand({ action: "stop_mission" });
    const completedAt = new Date().toISOString();
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === id
          ? { ...m, status: "aborted" as const, completedAt }
          : m
      ),
      activeMission: null,
    }));
    fetch("/api/missions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "aborted", completedAt }),
    }).catch(() => {});
  },

  returnHome: () => {
    publishMowerCommand({ action: "return_home" });
  },

  deleteMission: async (id: string) => {
    try {
      await fetch(`/api/missions?id=${id}`, { method: "DELETE" });
      set((state) => ({
        missions: state.missions.filter((m) => m.id !== id),
        activeMission: state.activeMission === id ? null : state.activeMission,
      }));
    } catch {
      // Error handled by UI
    }
  },

  updateProgress: (missionId, progress, completedPoints) => {
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === missionId
          ? { ...m, progress, completedPoints }
          : m
      ),
    }));
  },

  updateMissionStatus: (missionId, status) => {
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === missionId
          ? {
              ...m,
              status,
              completedAt: status === "completed" ? new Date().toISOString() : m.completedAt,
            }
          : m
      ),
      activeMission:
        status === "completed" || status === "aborted"
          ? null
          : state.activeMission,
    }));
  },
}));
