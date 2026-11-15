import { useMemo, useState, type CSSProperties } from "react";
import { CandlestickChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Candle } from "@/types";

interface ChartPanelProps {
  candles: Candle[];
  isDemo?: boolean;
  volumeAvailable?: boolean;
}

type EmaPeriod = 20 | 50 | 200;
const periods: EmaPeriod[] = [20, 50, 200];
const emaColors: Record<EmaPeriod, string> = {
  20: "hsl(var(--primary))",
  50: "var(--chart-ema50)",
  200: "var(--chart-ema200)",
};
const chartColors = {
  "--chart-up": "#22c55e",
  "--chart-down": "#f87171",
  "--chart-ema50": "#fbbf24",
  "--chart-ema200": "#c084fc",
} as CSSProperties;
const formatPrice = (value: number) => value.toFixed(2);
const formatTime = (time: number) => new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
}).format(time);
const formatVolume = (value: number) => new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function ChartPanel({ candles, isDemo = true, volumeAvailable = true }: ChartPanelProps) {
  const [timeframe, setTimeframe] = useState<1 | 4>(1);
  const [visibleCount, setVisibleCount] = useState<48 | 96>(48);
  const [shownEmas, setShownEmas] = useState<Record<EmaPeriod, boolean>>({ 20: true, 50: true, 200: true });
  const [showMarkers, setShowMarkers] = useState(true);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const series = useMemo(() => {
    const groups: Candle[] = [];
    const interval = timeframe * 3600000;
    for (const candle of candles) {
      const time = Math.floor(candle.time / interval) * interval;
      const last = groups[groups.length - 1];
      if (last?.time === time) {
        last.high = Math.max(last.high, candle.high);
        last.low = Math.min(last.low, candle.low);
        last.close = candle.close;
        last.volume += candle.volume;
      } else {
        groups.push({ ...candle, time });
      }
    }
    const emaValues: Record<EmaPeriod, number | null> = { 20: null, 50: null, 200: null };
    let previousDifference: number | null = null;
    return groups.map((candle, index) => {
      // Same SMA initialization as the existing DEMO indicators; no invented history.
      for (const period of periods) {
        if (index === period - 1) {
          emaValues[period] = groups.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;
        } else if (index >= period) {
          const alpha = 2 / (period + 1);
          emaValues[period] = candle.close * alpha + emaValues[period]! * (1 - alpha);
        }
      }
      const difference = emaValues[20] !== null && emaValues[50] !== null ? emaValues[20] - emaValues[50] : null;
      let marker: "up" | "down" | null = null;
      if (difference !== null && previousDifference !== null) {
        if (previousDifference <= 0 && difference > 0) marker = "up";
        if (previousDifference >= 0 && difference < 0) marker = "down";
      }
      previousDifference = difference;
      return { ...candle, emas: { ...emaValues }, marker };
    });
  }, [candles, timeframe]);
  const visible = series.slice(-visibleCount);
  const selected = visible.find((candle) => candle.time === selectedTime) ?? visible[visible.length - 1];
  const bounds = visible.flatMap((c) => [c.low, c.high, ...periods.flatMap((period) => shownEmas[period] && c.emas[period] !== null ? [c.emas[period]!] : [])]);
  const min = Math.min(...bounds);
  const max = Math.max(...bounds);
  const padding = Math.max((max - min) * 0.15, 1);
  const bottom = min - padding;
  const top = max + padding;
  const y = (price: number) => 26 + ((top - price) / (top - bottom)) * 238;
  const step = 844 / visible.length;
  const x = (index: number) => 12 + step * (index + 0.5);
  const maxVolume = Math.max(...visible.map((c) => c.volume), 1);
  const last = visible[visible.length - 1];
  const selectedIndex = visible.indexOf(selected);
  const timeTicks = [...new Set([0, Math.floor(visible.length / 3), Math.floor(visible.length * 2 / 3), visible.length - 1])];
  const unavailable = periods.filter((period) => shownEmas[period] && series.length < period);

  return (
    <section style={chartColors} className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label={`Graphique XAU/USD ${isDemo ? "de démonstration" : "Twelve Data"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><CandlestickChart className="h-5 w-5" /></div>
          <div><h2 className="font-semibold">XAU/USD <span className="text-xs font-normal text-muted-foreground">• Or / Dollar</span></h2><p className="text-xs text-muted-foreground">{isDemo ? "Bougies & volumes simulés" : "Bougies réelles · Twelve Data"} · UTC</p></div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([1, 4] as const).map((value) => <Button key={value} size="sm" variant={timeframe === value ? "default" : "outline"} className="h-8 rounded-lg px-3" aria-pressed={timeframe === value} onClick={() => { setTimeframe(value); setSelectedTime(null); }}>{value}h</Button>)}
          {periods.map((period) => <Button key={period} size="sm" variant={shownEmas[period] ? "secondary" : "outline"} className="h-8 gap-1.5 rounded-lg" aria-pressed={shownEmas[period]} onClick={() => setShownEmas((previous) => ({ ...previous, [period]: !previous[period] }))}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: emaColors[period], opacity: shownEmas[period] ? 1 : 0.35 }} />EMA {period}</Button>)}
          <Button size="sm" variant="outline" className="h-8 rounded-lg" aria-label={`Afficher ${visibleCount === 48 ? 96 : 48} bougies`} onClick={() => { setVisibleCount(visibleCount === 48 ? 96 : 48); setSelectedTime(null); }}>{visibleCount} bougies</Button>
          <Button size="sm" variant={showMarkers ? "secondary" : "outline"} className="h-8 rounded-lg" aria-pressed={showMarkers} onClick={() => setShowMarkers(!showMarkers)}>Marqueurs</Button>
        </div>
      </div>
      <div className="my-4 flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono" aria-live="polite">
        <span className="text-muted-foreground">{formatTime(selected.time)}</span>
        <span>O {formatPrice(selected.open)}</span><span>H {formatPrice(selected.high)}</span><span>B {formatPrice(selected.low)}</span>
        <span style={{ color: selected.close >= selected.open ? "var(--chart-up)" : "var(--chart-down)" }}>C {formatPrice(selected.close)}</span>
        <span className="text-muted-foreground">{volumeAvailable ? `Vol. ${selected.volume.toLocaleString("fr-FR")}` : "Volume non fourni par Twelve Data"}</span>
        {periods.filter((period) => shownEmas[period]).map((period) => <span key={period} style={{ color: emaColors[period] }}>EMA {period} : {selected.emas[period] === null ? "—" : formatPrice(selected.emas[period])}</span>)}
      </div>
      <div className="overflow-x-auto rounded-lg">
        <svg viewBox="0 0 960 400" className="h-[320px] w-full min-w-[640px] sm:h-[400px]" role="group" aria-label={`Graphique en chandeliers ${timeframe}h, ${visible.length} bougies. Dernier cours ${formatPrice(last.close)} dollars.`} onMouseLeave={() => setSelectedTime(null)}>
          <text x="875" y="13" fill="hsl(var(--muted-foreground))" fontSize="10">Prix (USD)</text>
          {Array.from({ length: 5 }, (_, index) => {
            const price = top - ((top - bottom) * index) / 4;
            return <g key={index}><line x1="12" x2="856" y1={y(price)} y2={y(price)} stroke="hsl(var(--border))" strokeDasharray="3 5" /><text x="875" y={y(price) + 4} fill="hsl(var(--muted-foreground))" fontSize="11" fontFamily="monospace">{formatPrice(price)}</text></g>;
          })}
          {timeTicks.map((index) => <line key={`grid-${index}`} x1={x(index)} x2={x(index)} y1="26" y2="352" stroke="hsl(var(--border))" strokeDasharray="3 5" />)}
          <line x1="864" x2="864" y1="26" y2="352" stroke="hsl(var(--border))" />
          <line x1="12" x2="856" y1="282" y2="282" stroke="hsl(var(--border))" />
          <text x="16" y="297" fill="hsl(var(--muted-foreground))" fontSize="10">{volumeAvailable ? (isDemo ? "Volume DEMO" : "Volume Twelve Data") : "Volume indisponible : aucune donnée inventée"}</text>
          {volumeAvailable && [0, 0.5, 1].map((fraction) => <text key={fraction} x="875" y={352 - fraction * 44 + 4} fill="hsl(var(--muted-foreground))" fontSize="10" fontFamily="monospace">{formatVolume(maxVolume * fraction)}</text>)}
          <line x1="12" x2="856" y1={y(last.close)} y2={y(last.close)} stroke="hsl(var(--primary))" strokeDasharray="5 5" opacity="0.65" />
          {visible.map((candle, index) => {
            const color = candle.close >= candle.open ? "var(--chart-up)" : "var(--chart-down)";
            const width = Math.max(step * 0.6, 2);
            const volumeHeight = (candle.volume / maxVolume) * 44;
            return <g key={candle.time}>
              <line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="1.3" />
              <rect x={x(index) - width / 2} y={Math.min(y(candle.open), y(candle.close))} width={width} height={Math.max(Math.abs(y(candle.open) - y(candle.close)), 1.5)} fill={color} rx="1" />
              {volumeAvailable && <rect x={x(index) - width / 2} y={352 - volumeHeight} width={width} height={volumeHeight} fill={color} opacity="0.45" rx="1" />}
            </g>;
          })}
          {periods.filter((period) => shownEmas[period]).map((period) => {
            const points = visible.map((candle, index) => ({ value: candle.emas[period], index })).filter((point) => point.value !== null);
            const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.index)},${y(point.value!)}`).join(" ");
            return <g key={period} pointerEvents="none"><path d={path} fill="none" stroke={emaColors[period]} strokeWidth="2" />{points.length === 1 && <circle cx={x(points[0].index)} cy={y(points[0].value!)} r="3" fill={emaColors[period]} />}</g>;
          })}
          {showMarkers && visible.map((candle, index) => {
            if (!candle.marker) return null;
            const up = candle.marker === "up";
            const markerY = up ? y(candle.low) + 10 : y(candle.high) - 10;
            return <g key={`marker-${candle.time}`} pointerEvents="none"><title>{up ? "Croisement haussier" : "Croisement baissier"} EMA 20/50 · {formatTime(candle.time)} · {isDemo ? "DEMO" : "Twelve Data"}, pas un ordre</title><path d={up ? `M${x(index)},${markerY} l-5,8 h10 Z` : `M${x(index)},${markerY} l-5,-8 h10 Z`} fill={up ? "var(--chart-up)" : "var(--chart-down)"} stroke="hsl(var(--card))" strokeWidth="1" /></g>;
          })}
          <circle cx={x(visible.length - 1)} cy={y(last.close)} r="3.5" fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth="1.5" pointerEvents="none" />
          {selectedTime !== null && <g pointerEvents="none"><line x1={x(selectedIndex)} x2={x(selectedIndex)} y1="26" y2="352" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 4" /><line x1="12" x2="856" y1={y(selected.close)} y2={y(selected.close)} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 4" /><circle cx={x(selectedIndex)} cy={y(selected.close)} r="4" fill="hsl(var(--foreground))" /></g>}
          {visible.map((candle, index) => <rect key={`hit-${candle.time}`} x={x(index) - step / 2} y="26" width={step} height="326" fill="transparent" className="cursor-crosshair focus:outline-none focus:stroke-primary" tabIndex={0} role="button" aria-label={`${formatTime(candle.time)}, ouverture ${formatPrice(candle.open)}, haut ${formatPrice(candle.high)}, bas ${formatPrice(candle.low)}, clôture ${formatPrice(candle.close)}, ${volumeAvailable ? `volume ${candle.volume}` : "volume indisponible"}${candle.marker ? `, croisement ${candle.marker === "up" ? "haussier" : "baissier"} EMA 20/50` : ""}`} onMouseEnter={() => setSelectedTime(candle.time)} onClick={() => setSelectedTime(candle.time)} onFocus={() => setSelectedTime(candle.time)} onBlur={() => setSelectedTime(null)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedTime(candle.time); } }} />)}
          <line x1="12" x2="856" y1="360" y2="360" stroke="hsl(var(--border))" />
          {timeTicks.map((index) => <text key={index} x={x(index)} y="379" textAnchor={index === 0 ? "start" : index === visible.length - 1 ? "end" : "middle"} fill="hsl(var(--muted-foreground))" fontSize="11">{formatTime(visible[index].time)}</text>)}
          <text x="875" y="395" fill="hsl(var(--muted-foreground))" fontSize="10">Temps UTC</text>
        </svg>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span><span style={{ color: "var(--chart-up)" }}>▲</span> Bougie haussière</span><span><span style={{ color: "var(--chart-down)" }}>▼</span> Bougie baissière</span><span className="text-primary">● Dernière clôture</span>
        {showMarkers && <span>Triangles : croisements EMA 20/50 · pas des ordres</span>}
      </div>
      <p className="mb-3 text-[10px] leading-relaxed text-muted-foreground">EMA calculées sur tout l’historique {timeframe}h ({series.length} bougies), initialisées par la moyenne des {"N"} premières clôtures. Les lignes commencent après leur période d’initialisation.{unavailable.length > 0 && ` EMA ${unavailable.join(" / ")} : historique insuffisant (${series.length} bougies disponibles).`}</p>
      <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground"><span>Survolez ou sélectionnez une bougie pour consulter ses valeurs.</span><span className="font-medium text-primary">{isDemo ? "DEMO · Données fictives" : "LIVE · Twelve Data · Actualisation 5 min"}</span></div>
    </section>
  );
}
