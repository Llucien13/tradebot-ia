import { BacktestHistory } from "@/components/backtest/BacktestHistory";
import { AppNavigation } from "@/components/navigation/AppNavigation";
import { Link, useSearchParams } from "react-router-dom";
import { StrategyLabEditor } from "@/components/strategy/StrategyLabEditor";
import { BacktestStrategy } from "@/components/strategy/BacktestStrategy";
import { TradingStateBadge } from "@/components/ui/trading/TradingStateBadge";
import { useMarketData } from "@/components/market-data/MarketDataProvider";
import { Settings, ArrowLeft } from "lucide-react";

export default function StrategyH1() {
  const { source } = useMarketData();
  const [params] = useSearchParams();
  const showBacktest = params.get("view") === "backtest";
  const isDemo = source === "DEMO";

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-card/50 lg:flex">
        <div className="flex items-center gap-3 border-b border-border px-5 py-6">
          <div className="rounded-xl bg-primary/15 p-2 text-primary"><Settings className="h-6 w-6" /></div>
          <div><p className="text-lg font-bold tracking-tight">TradeBot IA</p><p className="text-xs text-muted-foreground">Terminal de trading</p></div>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-5"><AppNavigation /></nav>
        <div className="m-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs"><p className="mb-1 font-semibold text-primary">Marché {isDemo ? "DEMO fictif" : "Twelve Data"}</p><p className="leading-relaxed text-muted-foreground">MT5 : historique de backtest distinct.<br />Aucun ordre réel.</p></div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3"><Link to="/strategy-h1" className="text-xs font-medium text-muted-foreground hover:underline"><ArrowLeft className="mr-1 h-3.5 w-3.5" />Retour</Link><p className="text-sm font-medium">Stratégie H1</p></div>
          <div className="flex flex-wrap items-center gap-3"><TradingStateBadge>PAPER</TradingStateBadge><span className="text-xs text-muted-foreground">Simulation uniquement · aucun ordre réel</span></div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-6 pb-28 sm:px-6 lg:pb-6">
          <nav aria-label="Vues Stratégie H1" className="mb-5 flex flex-wrap gap-2">
            {[
              { to: "/strategy-h1", label: "Configuration", active: !showBacktest },
              { to: "/strategy-h1?view=backtest", label: "Backtest H1", active: showBacktest },
            ].map(item => <Link key={item.to} to={item.to} aria-current={item.active ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium ${item.active ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-secondary"}`}>{item.label}</Link>)}
          </nav>
          {showBacktest ? <BacktestStrategy /> : <StrategyLabEditor />}
          <div className="mt-6"><BacktestHistory strategy="H1" /></div>
        </main>

        <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-2 lg:hidden"><AppNavigation mobile /></nav>
      </div>
    </div>
  );
}