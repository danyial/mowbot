import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatusCardProps {
  title: string;
  icon: LucideIcon;
  iconColor?: string;
  children: React.ReactNode;
  className?: string;
}

export function StatusCard({
  title,
  icon: Icon,
  iconColor,
  children,
  className,
}: StatusCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={cn("h-4 w-4 text-muted-foreground", iconColor)} />
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
