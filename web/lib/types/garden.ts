export interface GardenPolygon {
  id: string;
  name: string;
  points: [number, number][]; // [lat, lon][]
  area: number; // square meters
  createdAt: string;
  updatedAt: string;
}

export interface GardenExclusionZone {
  id: string;
  name: string;
  points: [number, number][];
  gardenId: string;
}
