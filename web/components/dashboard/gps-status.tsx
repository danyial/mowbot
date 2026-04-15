"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { useGpsStore } from "@/lib/store/gps-store";
import { StatusCard } from "./status-card";
import { Badge } from "@/components/ui/badge";
import { ValueDisplay } from "@/components/shared/value-display";
import { formatCoordinate } from "@/lib/utils/formatting";

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

/** NavSatStatus.status numeric codes (REP-145). -2 is our sentinel for "never received". */
const fixCodeLabels: Record<number, string> = {
  [-2]: "NO_MSG",
  [-1]: "NO_FIX",
  0: "FIX",
  1: "SBAS",
  2: "GBAS",
};

/** position_covariance_type values (sensor_msgs/NavSatFix). */
const covTypeLabels: Record<number, string> = {
  0: "unbekannt",
  1: "approximiert",
  2: "diag",
  3: "voll",
};

function formatAccuracy(meters: number): { value: string; unit: string; color: string } {
  if (meters < 0) return { value: "--", unit: "", color: "" };
  const cm = meters * 100;
  if (cm < 5) return { value: cm.toFixed(1), unit: "cm", color: "text-green-500" };
  if (cm < 50) return { value: cm.toFixed(1), unit: "cm", color: "text-yellow-500" };
  if (cm < 100) return { value: cm.toFixed(0), unit: "cm", color: "text-red-500" };
  return { value: meters.toFixed(2), unit: "m", color: "text-red-500" };
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/**
 * GPS-Qualität als %. Fix-Typ setzt die obere Grenze (kann nicht >90% ohne RTK Fix);
 * die horizontale Genauigkeit moduliert innerhalb der Stufe. Stale Fix → 0%.
 */
function computeQuality(
  fixStatus: string,
  accuracyM: number,
  isStale: boolean
): { percent: number; color: string } {
  if (isStale || fixStatus === "no_fix") return { percent: 0, color: "text-red-500" };

  // Tier-Obergrenzen nach Fix-Typ
  const tier: Record<string, { base: number; ceiling: number; refCm: number }> = {
    autonomous: { base: 10, ceiling: 30, refCm: 500 },   // ~5 m typisch
    dgps:       { base: 30, ceiling: 55, refCm: 100 },   // ~1 m typisch
    rtk_float:  { base: 55, ceiling: 90, refCm: 10 },    // ~10 cm typisch → 90%
    rtk_fixed:  { base: 85, ceiling: 100, refCm: 2 },    // ~2 cm typisch → 100%
  };
  const t = tier[fixStatus] ?? tier.autonomous;

  if (accuracyM < 0) return { percent: t.base, color: "text-yellow-500" };

  const cm = accuracyM * 100;
  // Linear zwischen ceiling (bei refCm) und base (bei refCm*5); ausserhalb geklemmt.
  const span = t.ceiling - t.base;
  const ratio = Math.max(0, Math.min(1, 1 - (cm - t.refCm) / (t.refCm * 4)));
  const percent = Math.round(t.base + span * ratio);

  const color =
    percent >= 90 ? "text-green-500" :
    percent >= 70 ? "text-lime-500" :
    percent >= 50 ? "text-yellow-500" :
    percent >= 25 ? "text-orange-500" :
                    "text-red-500";

  return { percent, color };
}

export function GpsStatus() {
  const {
    latitude,
    longitude,
    altitude,
    fixStatus,
    fixStatusCode,
    accuracy,
    verticalAccuracy,
    covarianceType,
    lastUpdate,
  } = useGpsStore();

  const [expanded, setExpanded] = useState(false);

  // Tick to re-render "last-update age" without a new /fix message.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(t);
  }, []);

  const ageMs = lastUpdate > 0 ? Date.now() - lastUpdate : -1;
  const isStale = ageMs > 5000;
  const accH = formatAccuracy(accuracy);
  const accV = formatAccuracy(verticalAccuracy);
  const acc2H = formatAccuracy(accuracy > 0 ? accuracy * 2 : -1);
  const acc2V = formatAccuracy(verticalAccuracy > 0 ? verticalAccuracy * 2 : -1);
  const quality = computeQuality(fixStatus, accuracy, isStale || lastUpdate === 0);

  return (
    <StatusCard
      title="GPS"
      icon={MapPin}
      iconColor={fixStatus === "rtk_fixed" ? "text-green-500" : undefined}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant={fixBadgeVariant[fixStatus] || "secondary"}>
            {fixLabels[fixStatus] || "Unknown"}
          </Badge>
          <span className={`text-sm font-semibold tabular-nums ${quality.color}`}>
            {quality.percent}%
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ValueDisplay
            label="Lat"
            value={latitude !== null ? formatCoordinate(latitude) : "--"}
          />
          <ValueDisplay
            label="Lon"
            value={longitude !== null ? formatCoordinate(longitude) : "--"}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ValueDisplay
            label="Genauigkeit (1σ)"
            value={accH.value}
            unit={accH.unit}
            valueClassName={accH.color}
          />
          <ValueDisplay
            label="Letzter Fix"
            value={
              ageMs < 0
                ? "--"
                : isStale
                ? "Stale"
                : formatAge(ageMs)
            }
            valueClassName={isStale ? "text-yellow-500" : undefined}
          />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors"
        >
          <span>Details</span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {expanded && (
          <div className="space-y-2 rounded border border-slate-800 bg-slate-950/40 p-2">
            <div className="grid grid-cols-2 gap-2">
              <ValueDisplay
                label="Horizontal 2σ (95%)"
                value={acc2H.value}
                unit={acc2H.unit}
                valueClassName={acc2H.color}
              />
              <ValueDisplay
                label="Vertikal 1σ"
                value={accV.value}
                unit={accV.unit}
                valueClassName={accV.color}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ValueDisplay
                label="Höhe (MSL)"
                value={lastUpdate > 0 ? altitude.toFixed(2) : "--"}
                unit="m"
              />
              <ValueDisplay
                label="Vertikal 2σ (95%)"
                value={acc2V.value}
                unit={acc2V.unit}
                valueClassName={acc2V.color}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ValueDisplay
                label="Fix-Status"
                value={`${fixStatusCode} (${fixCodeLabels[fixStatusCode] || "?"})`}
              />
              <ValueDisplay
                label="Cov-Typ"
                value={covTypeLabels[covarianceType] || "?"}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ValueDisplay
                label="Alter"
                value={ageMs < 0 ? "--" : formatAge(ageMs)}
                valueClassName={isStale ? "text-yellow-500" : undefined}
              />
              <ValueDisplay
                label="Qualität"
                value={`${quality.percent}`}
                unit="%"
                valueClassName={quality.color}
              />
            </div>
          </div>
        )}
      </div>
    </StatusCard>
  );
}
