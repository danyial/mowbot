"use client";

import { useEffect, useState } from "react";
import { Wifi, Loader2, RefreshCw } from "lucide-react";
import { useRosStore } from "@/lib/store/ros-store";
import { useGpsStore } from "@/lib/store/gps-store";
import {
  useSlamPoseStore,
  YAW_COV_DEGRADED_THRESHOLD,
} from "@/lib/store/slam-pose-store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const fixBadgeVariant: Record<string, "success" | "warning" | "error" | "info" | "secondary"> = {
  no_fix: "error",
  autonomous: "warning",
  dgps: "warning",
  rtk_float: "info",
  rtk_fixed: "success",
};

const fixLabels: Record<string, string> = {
  no_fix: "No Fix",
  autonomous: "Autonomous",
  dgps: "DGPS",
  rtk_float: "RTK Float",
  rtk_fixed: "RTK Fixed",
};

// FUSE-03 Phase 7 — 3-state heading-confidence badge per CONTEXT.md D-11.
const slamBadgeVariant: Record<"active" | "stale" | "lost", "success" | "warning" | "error"> = {
  active: "success",
  stale: "warning",
  lost: "error",
};

const slamLabels: Record<"active" | "stale" | "lost", string> = {
  active: "Yaw: SLAM active",
  stale: "Yaw: SLAM stale",
  lost: "Yaw: SLAM lost",
};

export function Header() {
  const { connected, status, retryConnection } = useRosStore();
  const fixStatus = useGpsStore((s) => s.fixStatus);
  const lastUpdate = useSlamPoseStore((s) => s.lastUpdate);
  const yawCovariance = useSlamPoseStore((s) => s.yawCovariance);

  // Force re-render every 500ms so Date.now()-based staleness check re-evaluates
  // even when no new /pose message arrives. Without this, a silent SLAM death
  // leaves the badge stuck green until some other state change triggers a render
  // (D-11 requirement: bounded-timeline staleness detection).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const slamState: "active" | "stale" | "lost" = (() => {
    const age = Date.now() - lastUpdate;
    if (lastUpdate === 0 || age > 2000) return "lost";
    if (age > 500) return "stale";
    if (yawCovariance > 0 && yawCovariance > YAW_COV_DEGRADED_THRESHOLD) return "stale";
    return "active";
  })();

  const canRetry = status === "reconnecting" || status === "disconnected";

  return (
    <header className="flex items-center justify-between h-14 px-4 border-b border-border bg-card">
      <h1 className="text-sm font-bold md:hidden">MowerControl</h1>

      <div className="flex items-center gap-3 ml-auto">
        {/* GPS Fix Badge */}
        <Badge variant={fixBadgeVariant[fixStatus] || "secondary"}>
          {fixLabels[fixStatus] || "Unknown"}
        </Badge>

        {/* Yaw / SLAM heading-confidence Badge (FUSE-03) */}
        <Badge variant={slamBadgeVariant[slamState]}>
          {slamLabels[slamState]}
        </Badge>

        {/* Connection Status */}
        <button
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
            canRetry && "hover:bg-accent cursor-pointer active:bg-accent/80",
            !canRetry && "cursor-default"
          )}
          onClick={canRetry ? retryConnection : undefined}
          title={canRetry ? "Klicken zum Verbinden" : undefined}
        >
          {status === "connected" ? (
            <Wifi className="h-4 w-4 text-green-500" />
          ) : status === "connecting" ? (
            <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />
          ) : (
            <RefreshCw className={cn(
              "h-4 w-4",
              status === "reconnecting" ? "text-yellow-500" : "text-red-500"
            )} />
          )}
          <span
            className={cn(
              "text-xs font-medium hidden sm:inline",
              connected ? "text-green-500" : canRetry ? "text-yellow-500" : "text-red-500"
            )}
          >
            {status === "connected"
              ? "Verbunden"
              : status === "connecting"
                ? "Verbinde..."
                : "Erneut verbinden"}
          </span>
        </button>
      </div>
    </header>
  );
}
