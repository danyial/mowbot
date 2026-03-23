"use client";

import { useTeleopStore } from "@/lib/store/teleop-store";
import { Slider } from "@/components/ui/slider";
import { formatNumber } from "@/lib/utils/formatting";

export function SpeedSlider() {
  const { maxLinear, setMaxLinear } = useTeleopStore();

  return (
    <div className="flex flex-col items-center gap-2 h-full justify-center">
      <span className="text-xs text-muted-foreground">Max</span>
      <div className="flex-1 flex items-center min-h-[120px]">
        <Slider
          orientation="vertical"
          min={10}
          max={100}
          step={5}
          value={[maxLinear * 100]}
          onValueChange={([v]) => setMaxLinear(v / 100)}
          className="h-full"
        />
      </div>
      <span className="text-sm font-mono font-semibold">
        {formatNumber(maxLinear, 1)}
      </span>
      <span className="text-xs text-muted-foreground">m/s</span>
    </div>
  );
}
