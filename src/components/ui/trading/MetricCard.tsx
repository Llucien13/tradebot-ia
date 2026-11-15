import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  icon?: ReactNode;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export const MetricCard = ({
  title,
  value,
  subValue,
  icon,
  trend,
  className,
}: MetricCardProps) => {
  return (
    <div className={cn("terminal-card", className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="terminal-header">{title}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="terminal-value-lg">{value}</span>
        {subValue && (
          <span
            className={cn(
              "text-xs font-medium",
              trend === "up" && "text-success",
              trend === "down" && "text-destructive",
              trend === "neutral" && "text-muted-foreground"
            )}
          >
            {subValue}
          </span>
        )}
      </div>
    </div>
  );
};