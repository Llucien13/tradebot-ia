import { AppNavigation } from "@/components/navigation/AppNavigation";
import { BarChart3, Bot, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { PriceTicker } from "@/components/ui/trading/PriceTicker";
import { TechnicalAnalysis } from "@/components/ui/trading/TechnicalAnalysis";
import { ChartPanel } from "@/components/ui/trading/ChartPanel";
import { useMarketData } from "@/components/market-data/MarketDataProvider";
import { PaperMetrics } from "@/components/paper/PaperAccountPanel";
import { PaperBotSummary } from "@/components/paper/PaperBotSummary";
import { PaperMonthlyGoal } from "@/components/paper/PaperMonthlyGoal";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { DashboardActivity, DashboardPositions } from "@/components/dashboard/DashboardLedger";
import { DashboardSystemStatus } from "@/components/dashboard/DashboardSystemStatus";
import { DashboardAttention } from "@/components/dashboard/DashboardAttention";
import { PaperPerformanceView } from "@/components/paper/PaperPerformanceView";
import { LocalMT5Panel } from "@/components/market-data/LocalMT5Panel";

export default function Index() {
  const { candles, indicators, source, volumeAvailable } = useMarketData();
  const hasRealMarket = source === "TWELVE_DATA";
  const marketSourceLabel = source === "TWELVE_DATA" ? "Twelve Data" : "Aucun flux réel";
  const lastCandle = candles[candles.length - 1];
  const referenceTime = lastCandle.time - 24 * 3600000;
  const referenceCandle = [...candles].reverse().find((candle) => candle.time <= referenceTime) ?? candles[0];
  const price = lastCandle.close;
  const change24h = price - referenceCandle.close;
  const changePercent24h = (change24h / referenceCandle.close) * 100;
  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-card/50 lg:flex">
        <div className="flex items-center gap-3 border-b border-border px-5 py-6">
          <div className="rounded-xl bg-primary/15 p-2 text-primary"><Bot className="h-6 w-6" /></div>
          <div><p className="text-lg font-bold tracking-tight">TradeBot IA</p><p className="text-xs text-muted-foreground">Terminal de trading</p></div>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-5"><AppNavigation /></nav>
        <div className="m-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs"><p className="mb-1 font-semibold text-primary">Cotations : {marketSourceLabel}</p><p className="leading-relaxed text-muted-foreground">MT5 M1 : historique de backtest distinct.<br />Aucun ordre réel.</p></div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-4 sm:px-6">
          <div><p className="text-lg font-bold lg:hidden">TradeBot IA</p><p className="text-sm font-medium text-muted-foreground">Tableau de bord</p></div>
          <span className="rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">Simulation · aucun ordre réel</span>
        </header>

        <main id="dashboard" className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 pb-28 sm:px-6 sm:py-8 lg:pb-8">
          <DashboardSystemStatus />
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">TradeBot IA</p><h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Vue d’ensemble</h1></div><span className={`rounded-full border px-3 py-1.5 text-xs ${hasRealMarket ? "border-border bg-card text-muted-foreground" : "border-amber-400/25 bg-amber-400/5 text-amber-200"}`}>{hasRealMarket ? `Cotations · ${marketSourceLabel}` : "Cotations indisponibles"}</span></div>

          <DashboardOverview />
          <DashboardAttention />
          <LocalMT5Panel />
          <Link to="/ftmo-20k" className="block rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm font-semibold text-primary hover:bg-primary/10">FTMO 20K EUR · GOLD M15 2,5R · compte PAPER indépendant →</Link>
          <Link to="/scalping#scalping-m5" className="block rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm font-semibold text-primary hover:bg-primary/10">Scalping XAU/USD M5 · profil indépendant et backtest MT5 manuel →</Link>
          <DashboardPositions />
          <DashboardActivity />

          <details className="group min-w-0 rounded-2xl border border-border bg-card/40">
            <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-6 [&::-webkit-details-marker]:hidden"><div className="flex items-center gap-3"><span className="rounded-xl bg-secondary/70 p-2.5 text-primary"><BarChart3 className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold">Détails</h2><p className="mt-1 text-xs text-muted-foreground">Statistiques, graphique et analyse technique</p></div></div><ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
            <div className="min-w-0 space-y-5 border-t border-border p-4 sm:p-6">
              <PaperPerformanceView />
              {!hasRealMarket && <p role="status" className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Aucune donnée de marché réelle disponible. Aucun prix, indicateur ou graphique de démonstration n’est affiché.</p>}
              <div className="space-y-3"><h3 className="text-sm font-semibold text-muted-foreground">Compte et statistiques</h3><PaperMetrics /></div>
              <PaperMonthlyGoal />
              <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 space-y-5">
                  {hasRealMarket && <>
                    <PriceTicker price={price} change24h={change24h} changePercent24h={changePercent24h} isDemo={false} size="md" className="min-w-0 justify-center rounded-2xl bg-card p-5" />
                    <ChartPanel candles={candles} isDemo={false} volumeAvailable={volumeAvailable} />
                  </>}
                </div>
                <div className="min-w-0 space-y-5">
                  <PaperBotSummary />
                  {hasRealMarket && <TechnicalAnalysis indicators={indicators} candleCount={candles.length} timeframe="1h" isDemo={false} />}
                </div>
              </div>
            </div>
          </details>
          <footer className="flex flex-wrap justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><span>TradeBot IA v1.0 · Source des cotations : {marketSourceLabel}</span><span>Analyse et simulation uniquement · Aucun ordre réel.</span></footer>
        </main>

        <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-2 lg:hidden"><AppNavigation mobile /></nav>
      </div>
    </div>
  );
}
