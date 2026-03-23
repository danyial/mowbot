"use client";

import dynamic from "next/dynamic";

const RobotMap = dynamic(() => import("@/components/map/robot-map"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-card animate-pulse flex items-center justify-center">
      <span className="text-muted-foreground">Karte wird geladen...</span>
    </div>
  ),
});

export default function MapPage() {
  return (
    <div className="h-full w-full">
      <RobotMap className="h-full w-full" showControls interactive />
    </div>
  );
}
