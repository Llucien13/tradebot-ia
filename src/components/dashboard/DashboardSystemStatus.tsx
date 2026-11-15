import { ShieldCheck } from "lucide-react";
import { usePaperTrading } from "@/components/paper/PaperTradingProvider";
import { useMarketData } from "@/components/market-data/MarketDataProvider";
import { loadScalping } from "@/lib/scalping/model";
import { useMT5DataSession } from "@/lib/mt5-data-session";
import { TradingStateBadge } from "@/components/ui/trading/TradingStateBadge";

// Read-only presentation of the states already published by the existing providers.
export function useDashboardStatus() {
  const { strategy, strategyError, error } = usePaperTrading();
  const { source } = useMarketData();
  const { status, history } = useMT5DataSession();
  const scalping = loadScalping();
  const h1Disabled = strategy?.enabled === false;
  const h1Blocked = !h1Disabled && (!strategy || !!strategyError || !!error);
  const issue = strategyError || error;
  return {
    h1Label: h1Disabled ? "Inactive" : h1Blocked ? "Bloquée" : "Active",
    h1Blocked, h1Disabled, h1Reason: h1Blocked ? issue || "Configuration non encore vérifiée." : "", issue,
    scalping, scalpingLabel: scalping.error ? "Indisponible" : scalping.config.enabled ? "BACKTEST" : "Inactif",
    marketLabel: source === "TWELVE_DATA" ? "Twelve Data" : "Aucun flux réel", demoSource: source === "DEMO",
    mt5Connected: status?.connected === true, mt5Label: status ? status.connected ? "Connecté" : "Déconnecté" : "Non vérifié", history,
  };
}
export function DashboardSystemStatus() {
  const d = useDashboardStatus();
  return <section aria-labelledby="dashboard-system-status" className="rounded-2xl border border-primary/25 bg-card p-4">
    <h2 id="dashboard-system-status" className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" />État du système</h2>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{[
      ["Mode", <TradingStateBadge key="mode">PAPER</TradingStateBadge>],
      ["MT5", <TradingStateBadge key="mt5" tone={d.mt5Connected ? "good" : "muted"}>{d.mt5Label}</TradingStateBadge>],
      ["Instrument", <span key="instrument" className="font-mono text-sm">XAU/USD</span>],
      ["Données temps réel", <TradingStateBadge key="source" tone={d.demoSource ? "muted" : "good"}>{d.marketLabel}</TradingStateBadge>],
      ["Stratégie H1", <TradingStateBadge key="h1" tone={d.h1Blocked ? "warning" : d.h1Disabled ? "muted" : "good"}>{d.h1Label}</TradingStateBadge>],
      ["Scalping M1", <TradingStateBadge key="scalping" tone={d.scalpingLabel === "BACKTEST" ? "info" : "muted"}>{d.scalpingLabel}</TradingStateBadge>],
    ].map(([label, value], i) => <div key={i} className="min-w-0"><dt className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="mt-3 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">MT5 : dernière détection connue. {d.history ? `Historique M1 : ${d.history.symbol}, ${d.history.candles.length.toLocaleString("fr-FR")} bougies, backtest uniquement.` : "Aucun historique MT5 chargé."} Cotations Dashboard : bougies H1, pas de flux tick. Aucun LIVE.</p>
  </section>;
}
