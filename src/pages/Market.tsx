import { usePaperTrading } from "@/components/paper/PaperTradingProvider";
import { uiDateTime } from "@/lib/ui-presentation";
import { AppNavigation } from "@/components/navigation/AppNavigation";
import { Link } from "react-router-dom";
import { PriceTicker } from "@/components/ui/trading/PriceTicker";
import { MetricCard } from "@/components/ui/trading/MetricCard";
import { SignalBadge } from "@/components/ui/trading/SignalBadge";
import { TradingStateBadge } from "@/components/ui/trading/TradingStateBadge";
import { ChartPanel } from "@/components/ui/trading/ChartPanel";
import { IndicatorPanel } from "@/components/ui/trading/IndicatorPanel";
import { useMarketData } from "@/components/market-data/MarketDataProvider";
import { TrendingUp, TrendingDown, Activity, BarChart3, Clock } from "lucide-react";

export default function Market() {
  const { candles, indicators, source, volumeAvailable } = useMarketData();
  const isDemo = source === "DEMO";
  const { state } = usePaperTrading();
  const recentSignals = [...state.signals].reverse().slice(0, 3);
  const lastSignal = recentSignals[0];
  const lastCandle = candles[candles.length - 1];
  const referenceTime = lastCandle.time - 24 * 3600000;
  const referenceCandle = [...candles].reverse().find((c) => c.time <= referenceTime) ?? candles[0];
  const price = lastCandle.close;
  const change24h = price - referenceCandle.close;
  const changePercent24h = (change24h / referenceCandle.close) * 100;

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-card/50 lg:flex">
        <div className="flex items-center gap-3 border-b border-border px-5 py-6">
          <div className="rounded-xl bg-primary/15 p-2 text-primary"><Activity className="h-6 w-6" /></div>
          <div><p className="text-lg font-bold tracking-tight">TradeBot IA</p><p className="text-xs text-muted-foreground">Terminal de trading</p></div>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-5"><AppNavigation /></nav>
        <div className="m-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs"><p className="mb-1 font-semibold text-primary">Marché {isDemo ? "DEMO fictif" : "Twelve Data"}</p><p className="leading-relaxed text-muted-foreground">MT5 : historique de backtest distinct.<br />Aucun ordre réel.</p></div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-4 sm:px-6">
          <div><p className="text-sm font-medium">Market / XAU/USD <span className={`ml-2 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wider ${source === "TWELVE_DATA" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-primary/30 bg-primary/10 text-primary"}`}>{source}</span></p></div>
          <div className="flex flex-wrap items-center gap-3"><TradingStateBadge>PAPER</TradingStateBadge><span className="text-xs text-muted-foreground">Simulation uniquement · aucun ordre réel</span></div>
        </header>

        <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 pb-28 sm:px-6 lg:pb-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">TradeBot IA / Marché</p><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">XAU/USD — Or / Dollar</h1><p className="mt-2 text-sm text-muted-foreground">Analyse du marché sur bougies avec données {isDemo ? "fictives" : "réelles Twelve Data"}.</p></div>
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">Simulation uniquement</span>
          </div>

          {!isDemo ? <PriceTicker price={price} change24h={change24h} changePercent24h={changePercent24h} isDemo={false} size="lg" className="min-w-0 justify-center rounded-2xl bg-card p-5" /> : <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">Aucune cotation réelle disponible. L’aperçu de source fictive reste séparé dans Détails.</p>}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard title="Tendance 24h" value={isDemo ? "—" : change24h >= 0 ? "Haussière" : "Baissière"} subValue={isDemo ? "Aucune donnée réelle" : `${changePercent24h >= 0 ? "+" : ""}${changePercent24h.toFixed(2)}%`} trend={change24h >= 0 ? "up" : "down"} icon={<TrendingUp className="h-4 w-4" />} className="min-w-0 rounded-2xl" />
            <MetricCard title="Source" value={isDemo ? "Aucun flux réel" : "Twelve Data"} subValue="Cotations, pas mode d’exécution" trend="neutral" icon={<BarChart3 className="h-4 w-4" />} className="min-w-0 rounded-2xl" />
            <MetricCard title="Dernier signal enregistré" value={lastSignal?.direction ?? "—"} subValue={lastSignal ? `Confiance ${lastSignal.confidence}% · PAPER` : "Aucun signal disponible"} trend={lastSignal?.direction === "BUY" ? "up" : lastSignal?.direction === "SELL" ? "down" : "neutral"} icon={<TrendingDown className="h-4 w-4" />} className="min-w-0 rounded-2xl" />
            <MetricCard title="Dernière bougie" value={isDemo ? "—" : uiDateTime(lastCandle.time)} subValue={isDemo ? "Aucune donnée réelle" : "Ouverture de la bougie"} trend="neutral" icon={<Clock className="h-4 w-4" />} className="min-w-0 rounded-2xl" />
          </div>

          {!isDemo && <ChartPanel candles={candles} isDemo={false} volumeAvailable={volumeAvailable} />}
          {isDemo && <details className="rounded-2xl border border-border p-4"><summary className="cursor-pointer text-sm text-primary">Détails · aperçu de source fictive, pas de compte DEMO</summary><div className="mt-4 space-y-4"><p className="text-xs text-muted-foreground">Ces données internes fictives ne sont ni des cotations réelles ni des performances de trading.</p><ChartPanel candles={candles} isDemo volumeAvailable={volumeAvailable} /><IndicatorPanel indicators={indicators} /></div></details>}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            {!isDemo && <IndicatorPanel indicators={indicators} />}
            <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="market-signals-title">
              <h2 id="market-signals-title" className="mb-3 font-semibold">Signaux récents</h2>
              <ul className="space-y-3">
                {recentSignals.map((signal) => (
                  <li key={signal.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="flex items-center gap-3"><SignalBadge signal={signal.direction} /><span className="text-xs text-muted-foreground">{uiDateTime(signal.time)}</span></div>
                    <span className="text-xs font-mono text-muted-foreground">{signal.confidence}%</span>
                  </li>
                ))}
                {!recentSignals.length && <li className="text-sm text-muted-foreground">Aucun signal disponible.</li>}
              </ul>
            </section>
          </div>
        </main>

        <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-2 lg:hidden"><AppNavigation mobile /></nav>
      </div>
    </div>
  );
}