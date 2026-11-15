import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TermHelp } from "@/components/ui/trading/TermHelp";
import { ArrowRight, Bell, CheckCircle2, Database, Inbox, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import { SignalBadge } from "@/components/ui/trading/SignalBadge";
import { Badge } from "@/components/ui/badge";
import { useMT5DataSession } from "@/lib/mt5-data-session";
import { usePaperTrading } from "@/components/paper/PaperTradingProvider";
import { paperNumber } from "@/components/paper/PaperLayout";

const dateLabel = (time: number) => `${new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(time)} UTC`;

export function DashboardPositions() {
  const { state, unrealized } = usePaperTrading();
  const position = state.position;
  const pnlUSD = unrealized !== null && state.account ? unrealized * state.account.usdPerEur : null;
  const pnlPercent = pnlUSD !== null && position && position.entry * position.quantity > 0 ? pnlUSD / (position.entry * position.quantity) * 100 : null;
  return <section aria-labelledby="dashboard-positions" className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 id="dashboard-positions" className="flex items-center gap-2 text-lg font-semibold"><Layers className="h-5 w-5 text-primary" />Positions ouvertes</h2><Link to="/historique" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Voir le détail<ArrowRight className="h-3.5 w-3.5" /></Link></div>
    {position ? <article className="rounded-xl border border-border bg-background/40 p-4 sm:p-5">
      <div className="mb-5 flex flex-wrap items-center gap-3"><SignalBadge signal={position.direction} className="rounded-lg px-3 py-1" /><span className="font-semibold">XAU/USD</span><span className="rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">{position.timeframe === "1h" ? "Stratégie H1" : "Stratégie principale H4"} · PAPER</span></div>
      <p className="mb-4 text-xs text-muted-foreground">Ouverte le {dateLabel(position.entryTime)} · {paperNumber(position.quantity, 6)} oz / {paperNumber(position.lots, 4)} lots</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">{[
        ["Prix d’entrée ($)", paperNumber(position.entry, 4)],
        ["Prix actuel ($)", paperNumber(state.lastPrice?.price ?? null, 4)],
        ["Stop Loss · SL ($)", paperNumber(position.sl, 4)],
        ["Take Profit · TP ($)", paperNumber(position.tp, 4)],
      ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words font-mono text-sm font-medium sm:text-base">{value}</dd></div>)}<div className="min-w-0"><dt className="text-xs text-muted-foreground">P&L latent net<TermHelp term="P&L" explanation="Gain ou perte net simulé, converti en USD au taux figé du compte. Le pourcentage est rapporté au notionnel d’entrée (prix × onces), pas au capital ni au risque." /></dt><dd className={`mt-2 font-mono text-base font-semibold ${unrealized === null || unrealized === 0 ? "text-foreground" : unrealized > 0 ? "text-emerald-400" : "text-rose-400"}`}>{pnlUSD === null ? "—" : `${pnlUSD > 0 ? "+" : ""}${paperNumber(pnlUSD)} $`}<span className="mt-1 block text-xs">{pnlPercent === null ? "— %" : `${paperNumber(pnlPercent)} % du notionnel`} · {paperNumber(unrealized)} €</span></dd></div></dl>
      <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">Dernière valorisation : {state.lastPrice ? dateLabel(state.lastPrice.time) : "indisponible"}</p>
    </article> : <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-6"><span className="rounded-xl bg-secondary/60 p-3 text-muted-foreground"><Layers className="h-5 w-5" /></span><div><p className="text-sm font-medium">Aucune position ouverte</p><p className="mt-1 text-xs text-muted-foreground">Aucune position paper en cours.</p></div></div>}
  </section>;
}

interface ActivityEvent {
  id: string; time: number; timeframe: "1h" | "4h" | "1m";
  direction: "BUY" | "SELL" | "WAIT" | null;
  kind: "trade" | "open" | "signal" | "history"; pnl: number | null; description?: string;
}

function TimeframeBadge({ timeframe }: { timeframe: ActivityEvent["timeframe"] }) {
  const style = timeframe === "1h" ? "border-primary/25 bg-primary/10 text-primary" : timeframe === "4h" ? "border-violet-400/25 bg-violet-400/10 text-violet-300" : "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  return <Badge variant="outline" className={`rounded-lg px-2 py-0.5 text-[11px] hover:bg-transparent ${style}`}>{timeframe === "1h" ? "H1" : timeframe === "4h" ? "H4" : "Scalping M1 · BACKTEST"}</Badge>;
}

export function DashboardActivity() {
  const { state, error, strategyError } = usePaperTrading();
  const [filter, setFilter] = useState("TOUT");
  const { history } = useMT5DataSession();
  const entries: ActivityEvent[] = [
    ...state.trades.flatMap(trade => [{ id: `trade:${trade.positionId}`, time: trade.exitTime, direction: trade.direction, timeframe: trade.timeframe, kind: "trade" as const, pnl: trade.pnl }, { id: `open:${trade.positionId}`, time: trade.entryTime, direction: trade.direction, timeframe: trade.timeframe, kind: "open" as const, pnl: null }]),
    ...state.signals.map(signal => ({ id: `signal:${signal.id}`, time: signal.time, direction: signal.direction, timeframe: signal.timeframe, kind: "signal" as const, pnl: null })),
  ];
  if (state.position) entries.push({ id: `open:${state.position.id}`, time: state.position.entryTime, direction: state.position.direction, timeframe: state.position.timeframe, kind: "open", pnl: null });
  if (history) entries.push({ id: `history:${history.fetchedAt}`, time: Date.parse(history.fetchedAt), timeframe: "1m", direction: null, kind: "history", pnl: null, description: `MT5 · ${history.symbol} · ${history.candles.length.toLocaleString("fr-FR")} bougies · chargement, pas un trade` });
  const events = entries.filter(e => filter === "TOUT" || filter === "H1" && e.timeframe === "1h" || filter === "SCALPING" && e.timeframe === "1m" || filter === "TRADES" && (e.kind === "trade" || e.kind === "open") || filter === "SIGNAUX" && e.kind === "signal" || filter === "SYSTÈME" && e.kind === "history").sort((a, b) => b.time - a.time).slice(0, 8);
  return <section aria-labelledby="dashboard-activity" className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 id="dashboard-activity" className="flex items-center gap-2 text-lg font-semibold"><Bell className="h-5 w-5 text-primary" />Activité récente</h2><div className="flex gap-4 text-xs font-medium text-primary"><Link to="/historique" className="hover:underline">Tous les trades</Link><Link to="/historique" className="hover:underline">Tous les signaux</Link></div></div>
    <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Filtrer l’activité">{["TOUT", "H1", "SCALPING", "TRADES", "SIGNAUX", "SYSTÈME"].map(value => <Button key={value} type="button" variant="outline" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`h-10 rounded-xl px-3 text-[11px] ${filter === value ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground"}`}>{value}</Button>)}</div>
    {(filter === "TOUT" || filter === "SYSTÈME") && (error || strategyError) && <p className="my-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs"><strong>Système · {error ? "Erreur actuelle" : "Blocage H1"}</strong> : {error || strategyError}<span className="mt-1 block text-muted-foreground">État actuel, sans horodatage d’événement enregistré.</span></p>}
    <div aria-label="Repères des modules" className="mb-1 flex flex-wrap gap-2"><TimeframeBadge timeframe="1h" /><TimeframeBadge timeframe="4h" /><TimeframeBadge timeframe="1m" /></div>
    {events.length ? <ul className="divide-y divide-border">{events.map(event => <li key={event.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-4">
      <div className="flex min-w-0 items-center gap-3"><span className={`hidden rounded-xl p-2.5 sm:block ${event.kind === "history" ? "bg-emerald-400/10 text-emerald-300" : event.direction === "WAIT" ? "bg-secondary/30 text-muted-foreground" : "bg-primary/10 text-primary"}`}>{event.kind === "trade" ? <CheckCircle2 className="h-4 w-4" /> : event.kind === "history" ? <Database className="h-4 w-4" /> : <Bell className="h-4 w-4" />}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className={`text-sm ${event.direction === "WAIT" ? "text-muted-foreground" : "font-medium"}`}>{event.kind === "trade" ? "Trade fermé" : event.kind === "open" ? "Trade ouvert" : event.kind === "history" ? "Historique M1 chargé" : event.direction === "WAIT" ? "WAIT · attente" : `Signal ${event.direction}`}</p><TimeframeBadge timeframe={event.timeframe} /></div><time dateTime={new Date(event.time).toISOString()} className="mt-1 block text-xs text-muted-foreground">{dateLabel(event.time)}</time>{event.description && <p className="mt-1 break-words text-xs text-muted-foreground">{event.description}</p>}</div></div>
      {event.direction && <div className="ml-auto flex shrink-0 items-center gap-3">{event.direction === "WAIT" ? <span className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1 text-[11px] text-muted-foreground">WAIT</span> : <SignalBadge signal={event.direction} className="rounded-lg px-3 py-1 font-semibold" />}{event.pnl !== null && <span className={`min-w-20 text-right font-mono text-sm font-semibold ${event.pnl > 0 ? "text-emerald-400" : event.pnl < 0 ? "text-rose-400" : "text-foreground"}`}>{event.pnl > 0 ? "+" : ""}{paperNumber(event.pnl)} €</span>}</div>}
    </li>)}</ul> : <div className="flex items-center gap-3 py-6 text-muted-foreground"><Inbox className="h-5 w-5 shrink-0" /><p className="text-sm">Aucun événement disponible pour ce filtre.</p></div>}
  </section>;
}
