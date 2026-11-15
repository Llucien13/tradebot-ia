import { cn } from "@/lib/utils";
import type { IndicatorValues } from "@/types";

interface IndicatorPanelProps {
  indicators: IndicatorValues;
  className?: string;
}

export const IndicatorPanel = ({ indicators, className }: IndicatorPanelProps) => {
  const getEmaClass = (value: number | null, reference: number) => {
    if (value === null) return "";
    return value > reference ? "text-success" : "text-destructive";
  };

  const getRsiClass = (value: number | null) => {
    if (value === null) return "text-muted-foreground";
    if (value >= 70) return "text-destructive";
    if (value <= 30) return "text-success";
    return "text-muted-foreground";
  };

  const getMacdClass = (value: number | null) => {
    if (value === null) return "";
    return value > 0 ? "text-success" : "text-destructive";
  };

  const getAtrClass = (value: number | null) => {
    if (value === null) return "";
    return value > 0 ? "text-muted-foreground" : "";
  };

  return (
    <div className={cn("indicator-panel", className)}>
      <div className="grid grid-cols-2 gap-3 py-2">
        {/* EMA 20 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">EMA 20</span>
          <span
            className={cn(
              "w-6 h-1.5 rounded text-xs font-medium",
              getEmaClass(indicators.ema20, indicators.ema50 ?? 0)
            )}
          >
            {indicators.ema20?.toFixed(2) ?? "-"}
          </span>
        </div>

        {/* EMA 50 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">EMA 50</span>
          <span
            className={cn(
              "w-6 h-1.5 rounded text-xs font-medium",
              getEmaClass(indicators.ema50, indicators.ema200 ?? 0)
            )}
          >
            {indicators.ema50?.toFixed(2) ?? "-"}
          </span>
        </div>

        {/* EMA 200 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">EMA 200</span>
          <span
            className={cn("w-6 h-1.5 rounded text-xs font-medium", getEmaClass(indicators.ema200, 0))}
          >
            {indicators.ema200?.toFixed(2) ?? "-"}
          </span>
        </div>

        {/* RSI */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">RSI</span>
          <span
            className={cn("w-6 h-1.5 rounded text-xs font-medium", getRsiClass(indicators.rsi))}
          >
            {indicators.rsi?.toFixed(0) ?? "-"}
          </span>
        </div>

        {/* MACD */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">MACD</span>
          <span
            className={cn("w-6 h-1.5 rounded text-xs font-medium", getMacdClass(indicators.macd))}
          >
            {indicators.macd?.toFixed(4) ?? "-"}
          </span>
        </div>

        {/* ATR */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">ATR</span>
          <span
            className={cn("w-6 h-1.5 rounded text-xs font-medium", getAtrClass(indicators.atr))}
          >
            {indicators.atr?.toFixed(2) ?? "-"}
          </span>
        </div>
      </div>
    </div>
  );
};