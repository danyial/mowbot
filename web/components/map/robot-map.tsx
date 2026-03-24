"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useGpsStore } from "@/lib/store/gps-store";
import { useZoneStore } from "@/lib/store/zone-store";
import { useMapDefaults } from "@/lib/hooks/use-map-center";
import { RobotMarker } from "./robot-marker";
import { ZoneLayer } from "./zone-layer";
import { ZoneDrawHandler } from "./zone-draw-handler";
import { TrackLayer } from "./track-layer";
import { MowPathLayer } from "./mow-path-layer";
import { MapControls } from "./map-controls";
import { SetMapCenter } from "./set-map-center";

export type MapLayerType = "roadmap" | "satellite" | "hybrid";

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

function FollowRobot({ following }: { following: boolean }) {
  const map = useMap();
  const latitude = useGpsStore((s) => s.latitude);
  const longitude = useGpsStore((s) => s.longitude);

  useEffect(() => {
    if (following && latitude !== null && longitude !== null) {
      map.setView([latitude, longitude], map.getZoom(), { animate: true });
    }
  }, [following, latitude, longitude, map]);

  return null;
}

interface RobotMapProps {
  className?: string;
  showControls?: boolean;
  interactive?: boolean;
}

export default function RobotMap({
  className = "h-full w-full",
  showControls = true,
  interactive = true,
}: RobotMapProps) {
  const [following, setFollowing] = useState(false);
  const [showTrack, setShowTrack] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [mapLayer, setMapLayer] = useState<MapLayerType>("hybrid");
  const mapRef = useRef<L.Map | null>(null);

  const latitude = useGpsStore((s) => s.latitude);
  const longitude = useGpsStore((s) => s.longitude);
  const { center: configCenter, zoom: configZoom } = useMapDefaults();
  const loadZones = useZoneStore((s) => s.loadZones);
  const zonesLoaded = useZoneStore((s) => s.loaded);
  const editMode = useZoneStore((s) => s.editMode);

  // Load saved zones on mount
  useEffect(() => {
    if (!zonesLoaded) {
      loadZones();
    }
  }, [zonesLoaded, loadZones]);

  const center: [number, number] =
    latitude !== null && longitude !== null
      ? [latitude, longitude]
      : configCenter;

  const tileConfig = TILE_LAYERS[mapLayer];

  return (
    <div className={`relative ${className}`}>
      <MapContainer
        center={center}
        zoom={configZoom}
        maxZoom={22}
        className="h-full w-full z-0"
        zoomControl={false}
        attributionControl={false}
        dragging={interactive}
        scrollWheelZoom={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
        ref={mapRef}
      >
        <TileLayer
          key={mapLayer}
          url={tileConfig.url}
          maxZoom={22}
          maxNativeZoom={tileConfig.maxNativeZoom}
        />
        <RobotMarker />
        {showZones && <ZoneLayer />}
        {showTrack && <TrackLayer />}
        {showPaths && <MowPathLayer />}
        {editMode === "draw" && <ZoneDrawHandler />}
        <FollowRobot following={following} />
        <SetMapCenter center={configCenter} zoom={configZoom} active={latitude === null} />
      </MapContainer>

      {showControls && (
        <MapControls
          following={following}
          onToggleFollow={() => setFollowing(!following)}
          showTrack={showTrack}
          onToggleTrack={() => setShowTrack(!showTrack)}
          showZones={showZones}
          onToggleZones={() => setShowZones(!showZones)}
          showPaths={showPaths}
          onTogglePaths={() => setShowPaths(!showPaths)}
          mapLayer={mapLayer}
          onChangeLayer={setMapLayer}
          mapRef={mapRef}
        />
      )}
    </div>
  );
}
