"use client";

import { cn } from "@/lib/utils";
import { useLogsStore } from "@/lib/store/logs-store";
import type { SincePreset } from "@/lib/types/logs";

// Phase 6 / Plan 03 — Preset chip row.
// Six buttons (1m / 5m / 15m / 1h / 6h / 24h) + ghost "Alle" clear button
// visible only when a preset is active.

const PRESETS: SincePreset[] = ["1m", "5m", "15m", "1h", "6h", "24h"];

interface SincePresetChipsProps {
  disabled?: boolean;
  className?: string;
}

export function SincePresetChips({ disabled, className }: SincePresetChipsProps) {
  const active = useLogsStore((s) => s.sincePreset);
  const setSincePreset = useLogsStore((s) => s.setSincePreset);

  return (
    <div
      role="group"
      aria-label="Zeitfenster"
      className={cn(
        "flex items-center gap-1",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      {PRESETS.map((p) => {
        const isActive = active === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={isActive}
            onClick={() => setSincePreset(isActive ? null : p)}
            className={cn(
              "h-8 min-h-11 rounded-md px-2 text-xs font-semibold transition-colors md:min-h-0",
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            )}
          >
            {p}
          </button>
        );
      })}
      {active !== null && (
        <button
          type="button"
          onClick={() => setSincePreset(null)}
          className="h-8 px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Alle
        </button>
      )}
    </div>
  );
}
