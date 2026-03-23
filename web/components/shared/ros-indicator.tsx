"use client";

import { cn } from "@/lib/utils";

interface RosIndicatorProps {
  active: boolean;
  label?: string;
  className?: string;
}

export function RosIndicator({ active, label, className }: RosIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div
        className={cn(
          "h-2 w-2 rounded-full",
          active
            ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]"
            : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
        )}
      />
      {label && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
    </div>
  );
}
