import { AppNavigation } from "@/components/navigation/AppNavigation";
import { Link } from "react-router-dom";
import { BacktestStrategy } from "@/components/strategy/BacktestStrategy";
import { TradingStateBadge } from "@/components/ui/trading/TradingStateBadge";
import { useMarketData } from "@/components/market-data/MarketDataProvider";
import { Activity } from "lucide-react";

export default function Backtest() {
  const { source } = useMarketData();
  const isDemo = source === "DEMO";



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
          <div><p className="text-sm font-medium">Backtests <span className={`ml-2 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wider ${source === "TWELVE_DATA" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-primary/30 bg-primary/10 text-primary"}`}>{source}</span></p></div>
          <div className="flex flex-wrap items-center gap-3"><TradingStateBadge>BACKTEST</TradingStateBadge><span className="text-xs text-muted-foreground">Simulation uniquement · aucun ordre réel</span></div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-6 pb-28 sm:px-6 lg:pb-6">
          <BacktestStrategy />
        </main>

        <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-2 lg:hidden"><AppNavigation mobile /></nav>
      </div>
    </div>
  );
}