import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useDashboardStatus } from "./DashboardSystemStatus";
import { useMarketData } from "@/components/market-data/MarketDataProvider";

export function DashboardAttention() {
  const d = useDashboardStatus();
  const market = useMarketData();
  const alerts: { title: string; reason: string; action: string; to: string }[] = [];
  if (d.h1Blocked && d.issue) alerts.push({ title: "Entrées H1 bloquées", reason: d.h1Reason, action: "Vérifier la configuration enregistrée dans Stratégies, sans correction automatique.", to: "/strategy-h1" });
    if (d.scalping.error) alerts.push({ title: "Configuration Scalping indisponible", reason: d.scalping.error, action: "Vérifier la configuration du module dans Stratégies.", to: "/scalping" });
  if (market.source !== "TWELVE_DATA" && !market.refreshing) alerts.push({ title: "Cotations réelles indisponibles", reason: "Le Dashboard ne dispose pas d’un flux réel utilisable. Aucun prix de remplacement n’est affiché.", action: "Vérifier la source et la connexion dans Paramètres.", to: "/settings" });
  if (!alerts.length) return null;
  return <section aria-labelledby="dashboard-attention" className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4"><h2 id="dashboard-attention" className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-200"><AlertTriangle className="h-4 w-4" />Attention requise</h2><ul className="divide-y divide-amber-400/15">{alerts.map(a => <li key={a.title} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{a.title}</p><p className="mt-1 break-words text-xs text-muted-foreground">{a.reason}</p><p className="mt-1 text-xs text-muted-foreground">À faire : {a.action}</p></div><Link to={a.to} className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-amber-400/25 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-400/10">Vérifier →</Link></li>)}</ul></section>;
}
