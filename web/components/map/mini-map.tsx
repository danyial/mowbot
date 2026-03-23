"use client";

import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useGpsStore } from "@/lib/store/gps-store";
import { useMapDefaults } from "@/lib/hooks/use-map-center";
import { RobotMarker } from "./robot-marker";
import { GardenPolygon } from "./garden-polygon";
import { SetMapCenter } from "./set-map-center";
import type { MapLayerType } from "./robot-map";

const TILE_LAYERS: Record<MapLayerType, { url: string; maxNativeZoom: number }> = {
  roadmap: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 19,
  },
  satellite: {
    url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    maxNativeZoom: 20,
  },
  hybrid: {
    url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    maxNativeZoom: 20,
  },
};

interface MiniMapProps {
  layer?: MapLayerType;
}

export default function MiniMap({ layer = "hybrid" }: MiniMapProps) {
  const latitude = useGpsStore((s) => s.latitude);
  const longitude = useGpsStore((s) => s.longitude);
  const { center: configCenter, zoom: configZoom } = useMapDefaults();

  const center: [number, number] =
    latitude !== null && longitude !== null
      ? [latitude, longitude]
      : configCenter;

  const tileConfig = TILE_LAYERS[layer];

  return (
    <div className="h-full w-full">
      <MapContainer
        center={center}
        zoom={configZoom}
        maxZoom={22}
        className="h-full w-full"
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
      >
        <TileLayer
          key={layer}
          url={tileConfig.url}
          maxZoom={22}
          maxNativeZoom={tileConfig.maxNativeZoom}
        />
        <RobotMarker />
        <GardenPolygon />
        <SetMapCenter center={configCenter} zoom={configZoom} active={latitude === null} />
      </MapContainer>
    </div>
  );
}
