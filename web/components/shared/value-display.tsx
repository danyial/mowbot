import { cn } from "@/lib/utils";

interface ValueDisplayProps {
  label: string;
  value: string | number;
  unit?: string;
  className?: string;
  valueClassName?: string;
}

export function ValueDisplay({
  label,
  value,
  unit,
  className,
  valueClassName,
}: ValueDisplayProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className={cn("text-lg font-mono font-semibold", valueClassName)}>
          {value}
        </span>
        {unit && (
          <span className="text-xs text-muted-foreground">{unit}</span>
        )}
      </div>
    </div>
  );
}
