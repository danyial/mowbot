"use client";

import { Wifi, Loader2, RefreshCw } from "lucide-react";
import { useRosStore } from "@/lib/store/ros-store";
import { useGpsStore } from "@/lib/store/gps-store";
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

export function Header() {
  const { connected, status, retryConnection } = useRosStore();
  const fixStatus = useGpsStore((s) => s.fixStatus);

  const canRetry = status === "reconnecting" || status === "disconnected";

  return (
    <header className="flex items-center justify-between h-14 px-4 border-b border-border bg-card">
      <h1 className="text-sm font-bold md:hidden">MowerControl</h1>

      <div className="flex items-center gap-3 ml-auto">
        {/* GPS Fix Badge */}
        <Badge variant={fixBadgeVariant[fixStatus] || "secondary"}>
          {fixLabels[fixStatus] || "Unknown"}
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
