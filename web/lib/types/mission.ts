export type MissionPattern = "parallel" | "spiral" | "zigzag";
export type MissionStatus =
  | "planned"
  | "running"
  | "paused"
  | "completed"
  | "aborted";

export interface Mission {
  id: string;
  name: string;
  gardenPolygonId: string;
  pattern: MissionPattern;
  spacing: number; // meters (mow width)
  overlap: number; // 0-1
  speed: number; // m/s
  status: MissionStatus;
  progress: number; // 0-100
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  pathPoints: [number, number][]; // planned waypoints [lat, lon]
  completedPoints: [number, number][]; // already driven
  estimatedDuration: number; // seconds
  estimatedDistance: number; // meters
}

export interface CreateMissionInput {
  name: string;
  gardenPolygonId: string;
  pattern: MissionPattern;
  spacing?: number;
  overlap?: number;
  speed?: number;
}
