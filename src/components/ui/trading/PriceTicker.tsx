import { cn } from "@/lib/utils";
import type { ChangeEvent } from "react";

interface PriceTickerProps {
  price: number;
  change24h: number;
  changePercent24h: number;
  size?: "sm" | "md" | "lg";
  className?: string;
  onPriceChange?: (newPrice: number) => void;
  isDemo?: boolean;
}

export const PriceTicker = ({
  price,
  change24h,
  changePercent24h,
  size = "md",
  className,
  onPriceChange,
  isDemo = true,
}: PriceTickerProps) => {
  const sizeClasses = {
    sm: "text-2xl",
    md: "text-3xl",
    lg: "text-4xl",
  };

  const isPositive = change24h >= 0;
  const colorClass = isPositive ? "text-success" : "text-destructive";
  const flashClass = onPriceChange
    ? isPositive
      ? "price-flash-up"
      : "price-flash-down"
    : "";

  const handlePriceChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newPrice = parseFloat(e.target.value);
    if (!isNaN(newPrice) && onPriceChange) {
      onPriceChange(newPrice);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1 p-3 rounded-lg bg-secondary/50 border border-border",
        flashClass,
        className
      )}
    >
      <div className="flex items-baseline gap-3">
        <span
          className={cn("font-mono font-bold", sizeClasses[size])}
          onTransitionEnd={() => onPriceChange?.(price)}
        >
          {isDemo ? "DEMO " : ""}${price.toFixed(2)}
        </span>
        <span className={cn("text-xs font-medium", colorClass)}>
          {isPositive ? "+" : ""}
          {changePercent24h.toFixed(2)}%
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "text-xs font-mono",
            isPositive ? "text-success" : "text-destructive"
          )}
        >
          {isPositive ? "+" : ""}
          {change24h.toFixed(2)}
        </span>
        <span className="text-xs text-muted-foreground">24h</span>
        <div className="h-3 w-px bg-border mx-2"></div>
        <span className="text-xs text-muted-foreground">XAU/USD</span>
      </div>
    </div>
  );
};