import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { INDICATOR_MIN_CANDLES } from "@/lib/market-indicators";
import type { IndicatorValues, Timeframe } from "@/types";

interface TechnicalAnalysisProps {
  indicators: IndicatorValues;
  candleCount: number;
  timeframe: Timeframe;
  isDemo: boolean;
}

export function TechnicalAnalysis({ indicators, candleCount, timeframe, isDemo }: TechnicalAnalysisProps) {
  const rows = [
    { key: "ema20", label: "EMA 20", value: indicators.ema20, unit: "USD" },
    { key: "ema50", label: "EMA 50", value: indicators.ema50, unit: "USD" },
    { key: "ema200", label: "EMA 200", value: indicators.ema200, unit: "USD" },
    { key: "rsi", label: "RSI 14", value: indicators.rsi, unit: "/ 100" },
    { key: "macd", label: "MACD (12,26,9)", value: indicators.macd, unit: "USD" },
    { key: "atr", label: "ATR 14", value: indicators.atr, unit: "USD" },
    { key: "adx", label: "ADX 14", value: indicators.adx, unit: "/ 100" },
  ] as const;
  const format = (value: number | null, digits = 2) => value === null ? "Données insuffisantes" : value.toFixed(digits);

  return (
    <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="technical-analysis-title">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 id="technical-analysis-title" className="font-semibold">Analyse technique</h2><Activity className="h-4 w-4 shrink-0 text-primary" /></div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="rounded-md border-primary/30 bg-primary/10 text-[10px] text-primary">{isDemo ? "DEMO · Valeurs fictives" : "LIVE · Twelve Data"}</Badge>
        <span className="text-xs text-muted-foreground">Timeframe : <strong className="font-mono text-foreground">{timeframe}</strong></span>
      </div>
      <dl className="divide-y divide-border">
        {rows.map((row) => {
          const enough = candleCount >= INDICATOR_MIN_CANDLES[row.key] && row.value !== null;
          return <div key={row.key} className="py-2.5" title={`Minimum : ${INDICATOR_MIN_CANDLES[row.key]} bougies ${timeframe}`}>
            <div className="flex items-center justify-between gap-2"><dt className="shrink-0 text-xs text-muted-foreground">{row.label}</dt><dd className={enough ? "text-right font-mono text-xs font-semibold text-foreground" : "text-right text-[10px] font-medium text-amber-300"}>{enough ? <>{format(row.value, row.key === "macd" ? 4 : 2)} <span className="font-sans font-normal text-muted-foreground">{row.unit}</span></> : "Données insuffisantes"}</dd></div>
            {row.key === "macd" && enough && <div className="mt-1 flex flex-wrap justify-end gap-x-3 gap-y-1 text-[10px] text-muted-foreground"><span>Signal : <span className="font-mono text-foreground">{format(indicators.macdSignal, 4)}</span></span><span>Histogramme : <span className="font-mono text-foreground">{format(indicators.macdHistogram, 4)}</span></span></div>}
          </div>;
        })}
      </dl>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{candleCount} bougies {timeframe} · Dernière bougie disponible, pouvant être en cours. EMA initialisées par SMA ; RSI, ATR et ADX lissés selon Wilder. Analyse {timeframe} indépendante de la vue du graphique. {isDemo ? "Calculs sur des bougies fictives de secours." : "Calculs locaux exclusivement sur les bougies Twelve Data."} Aucun ordre généré.</p>
    </section>
  );
}
