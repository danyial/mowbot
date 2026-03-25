export type MissionStatus =
  | "planned"
  | "running"
  | "paused"
  | "completed"
  | "aborted";

export interface Mission {
  id: string;
  name: string;
  zoneIds: string[]; // Zone IDs to mow, or ["all"] for everything
  spacing: number; // meters (mow width)
  overlap: number; // 0-1
  speed: number; // m/s
  perimeterPasses: number; // outer laps before inner pattern (0-5)
  angle: number; // stripe angle in degrees (0-359)
  angleIncrement: number; // angle offset per execution (degrees)
  executionCount: number; // how many times this mission was executed
  status: MissionStatus;
  progress: number; // 0-100
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  pathPoints: [number, number][]; // planned waypoints [lat, lon]
  completedPoints: [number, number][]; // already driven
  estimatedDuration: number; // seconds
  estimatedDistance: number; // meters
  turns: number; // number of direction changes (stripes - 1)
  perimeterArea: number; // m² covered by perimeter passes
  innerArea: number; // m² covered by inner stripes
  startPoint?: [number, number]; // [lat, lon] — dock or GPS start/end position
}

export interface CreateMissionInput {
  name: string;
  zoneIds: string[];
  spacing?: number;
  overlap?: number;
  speed?: number;
  perimeterPasses?: number;
  angle?: number;
  angleIncrement?: number;
  startPoint?: [number, number]; // [lat, lon]
}

/** Result from path planning (used for preview and storage) */
export interface PlanResult {
  pathPoints: [number, number][];
  estimatedDistance: number; // meters
  estimatedDuration: number; // seconds
  turns: number; // number of direction changes
  perimeterArea: number; // m² covered by perimeter passes
  innerArea: number; // m² covered by inner stripes
}
