import { RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMarketData } from "./MarketDataProvider";

export function MarketDataBadge() {
  const { status } = useMarketData();
  const colors = {
    LIVE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    DEMO: "border-primary/30 bg-primary/10 text-primary",
    OFFLINE: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    ERROR: "border-red-400/40 bg-red-400/10 text-red-300",
  };
  return <span role="status" className={`ml-2 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wider ${colors[status]}`}>{status}</span>;
}

export function MarketDataNotice() {
  const { source, message, fetchedAt, candles, refreshing, refresh } = useMarketData();
  const live = source === "TWELVE_DATA";
  const date = (value: string | number) => new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
  return (
    <div role="status" className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
      <div className="flex min-w-0 flex-1 items-start gap-3"><Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div>
        <p><strong className="text-foreground">{live ? "Données de marché réelles." : "Données DEMO fictives."}</strong> {message}</p>
        <p>Les signaux du bot, le PnL, le drawdown et le budget de risque restent simulés. Aucun broker connecté, aucun ordre envoyé.</p>
        {live && fetchedAt && <p className="mt-1">Récupération : {date(fetchedAt)} UTC · Dernière bougie : {date(candles[candles.length - 1].time)} UTC · Retard éventuel selon l’offre Twelve Data et les heures de marché.</p>}
      </div></div>
      <Button size="sm" variant="outline" disabled={refreshing} onClick={() => { void refresh(); }} className="h-8 shrink-0 gap-2 rounded-lg text-xs"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? "Connexion…" : "Actualiser"}</Button>
    </div>
  );
}
