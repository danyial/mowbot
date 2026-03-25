"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Polygon,
  Marker,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import type { Mission } from "@/lib/types/mission";
import { useZoneStore } from "@/lib/store/zone-store";
import { ZONE_TYPE_CONFIG } from "@/lib/types/zones";

// ─────────────────────────────────────────────────────────────────────────────
// FitBounds helper
// ─────────────────────────────────────────────────────────────────────────────

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (points.length >= 2 && !fitted.current) {
      const bounds = L.latLngBounds(
        points.map(([lat, lon]) => [lat, lon] as [number, number])
      );
      map.fitBounds(bounds, { padding: [10, 10] });
      fitted.current = true;
    }
  }, [points, map]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pre-compute cumulative distances along a path for efficient interpolation.
 */
function computeCumulativeDistances(points: [number, number][]): number[] {
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    const [lat1, lon1] = points[i - 1];
    const [lat2, lon2] = points[i];
    // Approximate distance in meters using equirectangular projection
    const dLat = (lat2 - lat1) * 111320;
    const dLon =
      (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    const segDist = Math.sqrt(dLat * dLat + dLon * dLon);
    dists.push(dists[i - 1] + segDist);
  }
  return dists;
}

/**
 * Interpolate a position along the path at a given distance.
 */
function interpolatePosition(
  points: [number, number][],
  cumDists: number[],
  distance: number
): { position: [number, number]; heading: number; segmentIndex: number } {
  const totalDist = cumDists[cumDists.length - 1];
  const clampedDist = Math.min(distance, totalDist);

  // Find the segment
  let segIdx = 0;
  for (let i = 1; i < cumDists.length; i++) {
    if (cumDists[i] >= clampedDist) {
      segIdx = i - 1;
      break;
    }
    segIdx = i - 1;
  }

  const segStart = cumDists[segIdx];
  const segEnd = cumDists[segIdx + 1] || segStart;
  const segLen = segEnd - segStart;
  const t = segLen > 0 ? (clampedDist - segStart) / segLen : 0;

  const [lat1, lon1] = points[segIdx];
  const [lat2, lon2] = points[segIdx + 1] || points[segIdx];

  const lat = lat1 + (lat2 - lat1) * t;
  const lon = lon1 + (lon2 - lon1) * t;

  // Heading in degrees (0 = North, 90 = East)
  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;
  const heading =
    (Math.atan2(dLon, dLat) * (180 / Math.PI) + 360) % 360;

  return { position: [lat, lon], heading, segmentIndex: segIdx };
}

/**
 * Create a directional robot marker icon.
 */
function createRobotIcon(heading: number): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="
      width: 20px;
      height: 20px;
      position: relative;
    ">
      <div style="
        width: 16px;
        height: 16px;
        background: #22c55e;
        border: 2px solid #fff;
        border-radius: 50%;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        position: absolute;
        top: 2px;
        left: 2px;
      "></div>
      <div style="
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-bottom: 8px solid #22c55e;
        position: absolute;
        top: -5px;
        left: 5px;
        transform-origin: center 15px;
        transform: rotate(${heading}deg);
        filter: drop-shadow(0 1px 1px rgba(0,0,0,0.3));
      "></div>
    </div>`,
  });
}

interface SimulationLayerProps {
  pathPoints: [number, number][];
  speed: number; // mission speed in m/s
  simSpeed: number; // simulation multiplier (1-10)
  paused: boolean;
  onProgress: (progress: number, timeElapsed: number) => void;
  onEnd: () => void;
}

function SimulationLayer({
  pathPoints,
  speed,
  simSpeed,
  paused,
  onProgress,
  onEnd,
}: SimulationLayerProps) {
  const markerRef = useRef<L.Marker>(null);
  const trailLineRef = useRef<L.Polyline | null>(null);
  const distanceTraveled = useRef(0);
  const lastTimestamp = useRef<number | null>(null);
  const lastTrailUpdate = useRef(0);
  const lastReportedProgress = useRef(0);
  const animFrameId = useRef<number>(0);
  const currentHeading = useRef(0);
  const iconCache = useRef<Map<number, L.DivIcon>>(new Map());

  const [markerPos, setMarkerPos] = useState<[number, number]>(pathPoints[0]);

  const cumDists = useRef(computeCumulativeDistances(pathPoints));
  const totalDistance = cumDists.current[cumDists.current.length - 1];

  // Store latest values in refs for the animation loop
  const simSpeedRef = useRef(simSpeed);
  const pausedRef = useRef(paused);
  const onProgressRef = useRef(onProgress);
  const onEndRef = useRef(onEnd);

  useEffect(() => { simSpeedRef.current = simSpeed; }, [simSpeed]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);
  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);

  // Get or create a cached icon for a given heading (rounded to 10°)
  const getIcon = useCallback((h: number) => {
    const key = Math.round(h / 10) * 10;
    let icon = iconCache.current.get(key);
    if (!icon) {
      icon = createRobotIcon(key);
      iconCache.current.set(key, icon);
    }
    return icon;
  }, []);

  // Animation loop
  useEffect(() => {
    distanceTraveled.current = 0;
    lastTimestamp.current = null;
    lastTrailUpdate.current = 0;
    lastReportedProgress.current = 0;

    function tick(timestamp: number) {
      if (lastTimestamp.current === null) {
        lastTimestamp.current = timestamp;
        animFrameId.current = requestAnimationFrame(tick);
        return;
      }

      if (!pausedRef.current) {
        const deltaMs = timestamp - lastTimestamp.current;
        const deltaSec = deltaMs / 1000;
        const simDelta = deltaSec * simSpeedRef.current;
        const distDelta = speed * simDelta;

        distanceTraveled.current += distDelta;

        if (distanceTraveled.current >= totalDistance) {
          // Simulation ended
          distanceTraveled.current = totalDistance;

          // Final marker position
          const endPos = pathPoints[pathPoints.length - 1];
          if (markerRef.current) {
            markerRef.current.setLatLng(endPos);
          }

          // Final trail
          if (trailLineRef.current) {
            const allLatLngs = pathPoints.map(
              ([lat, lon]) => L.latLng(lat, lon)
            );
            trailLineRef.current.setLatLngs(allLatLngs);
          }

          onProgressRef.current(1, totalDistance / speed);
          onEndRef.current();
          return;
        }

        const { position, heading: h, segmentIndex } = interpolatePosition(
          pathPoints,
          cumDists.current,
          distanceTraveled.current
        );

        // Move marker imperatively (no React re-render)
        if (markerRef.current) {
          markerRef.current.setLatLng(position);

          // Update icon only when heading changes significantly
          const roundedNew = Math.round(h / 10) * 10;
          const roundedOld = Math.round(currentHeading.current / 10) * 10;
          if (roundedNew !== roundedOld) {
            currentHeading.current = h;
            markerRef.current.setIcon(getIcon(h));
          }
        }

        // Update trail every 100ms (not every frame)
        if (timestamp - lastTrailUpdate.current > 100) {
          lastTrailUpdate.current = timestamp;
          if (trailLineRef.current) {
            const trailLatLngs = pathPoints
              .slice(0, segmentIndex + 1)
              .map(([lat, lon]) => L.latLng(lat, lon));
            trailLatLngs.push(L.latLng(position[0], position[1]));
            trailLineRef.current.setLatLngs(trailLatLngs);
          }
        }

        // Report progress throttled (every 0.5%)
        const progress = distanceTraveled.current / totalDistance;
        if (progress - lastReportedProgress.current >= 0.005) {
          lastReportedProgress.current = progress;
          const timeElapsed = distanceTraveled.current / speed;
          onProgressRef.current(progress, timeElapsed);
        }
      }

      lastTimestamp.current = timestamp;
      animFrameId.current = requestAnimationFrame(tick);
    }

    animFrameId.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
      }
    };
  }, [pathPoints, speed, totalDistance, getIcon]);

  // Capture trail Polyline ref
  const trailRef = useCallback((el: L.Polyline | null) => {
    trailLineRef.current = el;
  }, []);

  return (
    <>
      {/* Trail (already driven) — updated imperatively */}
      <Polyline
        ref={trailRef}
        positions={[pathPoints[0].map(Number) as [number, number]]}
        pathOptions={{
          color: "#22c55e",
          weight: 3,
          opacity: 0.9,
        }}
      />

      {/* Robot marker — moved imperatively */}
      <Marker
        ref={markerRef}
        position={markerPos}
        icon={getIcon(0)}
        interactive={false}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export interface MissionPreviewMapProps {
  mission: Mission;
  simulating?: boolean;
  simSpeed?: number;
  simPaused?: boolean;
  onSimProgress?: (progress: number, timeElapsed: number) => void;
  onSimEnd?: () => void;
}

export default function MissionPreviewMap({
  mission,
  simulating = false,
  simSpeed = 1,
  simPaused = false,
  onSimProgress,
  onSimEnd,
}: MissionPreviewMapProps) {
  const zones = useZoneStore((s) => s.zones);

  const isAll = mission.zoneIds.length === 1 && mission.zoneIds[0] === "all";
  const missionZones = isAll
    ? zones.filter(
        (z) =>
          z.geometry.type === "Polygon" &&
          (z.properties.zoneType === "garden" || z.properties.zoneType === "mow")
      )
    : zones.filter((z) => mission.zoneIds.includes(z.id));

  const exclusionZones = zones.filter(
    (z) =>
      z.geometry.type === "Polygon" && z.properties.zoneType === "exclusion"
  );

  const pathPoints = mission.pathPoints;
  const defaultCenter: [number, number] =
    pathPoints.length > 0 ? pathPoints[0] : [48.2, 16.3];

  const handleSimProgress = useCallback(
    (progress: number, timeElapsed: number) => {
      onSimProgress?.(progress, timeElapsed);
    },
    [onSimProgress]
  );

  const handleSimEnd = useCallback(() => {
    onSimEnd?.();
  }, [onSimEnd]);

  return (
    <div className="h-[28rem] w-full rounded-md overflow-hidden border border-border">
      <MapContainer
        center={defaultCenter}
        zoom={19}
        maxZoom={22}
        className="h-full w-full"
        zoomControl={false}
        attributionControl={false}
        dragging={true}
        scrollWheelZoom={true}
        doubleClickZoom={false}
        touchZoom={true}
      >
        <TileLayer
          url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
          maxZoom={22}
          maxNativeZoom={20}
        />

        {/* Mission zones */}
        {missionZones.map((zone) => {
          const coords = zone.geometry.coordinates as number[][][];
          const positions = coords[0].map(
            ([lon, lat]) => [lat, lon] as LatLngExpression
          );
          const config = ZONE_TYPE_CONFIG[zone.properties.zoneType];
          return (
            <Polygon
              key={zone.id}
              positions={positions}
              interactive={false}
              pathOptions={{
                color: config.color,
                fillColor: config.color,
                fillOpacity: 0.1,
                weight: 1,
              }}
            />
          );
        })}

        {/* Exclusion zones */}
        {exclusionZones.map((zone) => {
          const coords = zone.geometry.coordinates as number[][][];
          const positions = coords[0].map(
            ([lon, lat]) => [lat, lon] as LatLngExpression
          );
          return (
            <Polygon
              key={zone.id}
              positions={positions}
              interactive={false}
              pathOptions={{
                color: "#ef4444",
                fillColor: "#ef4444",
                fillOpacity: 0.2,
                weight: 1,
                dashArray: "4, 4",
              }}
            />
          );
        })}

        {/* Planned path — dimmed during simulation */}
        {pathPoints.length >= 2 && (
          <Polyline
            positions={pathPoints.map(
              ([lat, lon]) => [lat, lon] as LatLngExpression
            )}
            pathOptions={{
              color: "#3b82f6",
              weight: 2,
              opacity: simulating ? 0.2 : 0.7,
            }}
          />
        )}

        {/* Completed path (from real execution, not simulation) */}
        {!simulating && mission.completedPoints.length >= 2 && (
          <Polyline
            positions={mission.completedPoints.map(
              ([lat, lon]) => [lat, lon] as LatLngExpression
            )}
            pathOptions={{
              color: "#22c55e",
              weight: 3,
              opacity: 0.9,
            }}
          />
        )}

        {/* Simulation layer */}
        {simulating && pathPoints.length >= 2 && (
          <SimulationLayer
            pathPoints={pathPoints}
            speed={mission.speed}
            simSpeed={simSpeed}
            paused={simPaused}
            onProgress={handleSimProgress}
            onEnd={handleSimEnd}
          />
        )}

        <FitBounds points={pathPoints} />
      </MapContainer>
    </div>
  );
}
