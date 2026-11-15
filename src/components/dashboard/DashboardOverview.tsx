import { Activity, Bot, Coins, Layers, TrendingUp, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { TermHelp } from "@/components/ui/trading/TermHelp";
import { uiDateTime } from "@/lib/ui-presentation";
import { SignalBadge } from "@/components/ui/trading/SignalBadge";
import { usePaperTrading } from "@/components/paper/PaperTradingProvider";
import { paperNumber } from "@/components/paper/PaperLayout";
import { Button } from "@/components/ui/button";
import { useDashboardStatus } from "./DashboardSystemStatus";

export function DashboardOverview() {
  const { state, strategy, equity } = usePaperTrading();
  const display = useDashboardStatus();
  const scalping = display.scalping;
  const now = Date.now();
  const date = new Date(now);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  // Display-only totals from the existing closed-trade journal, never execution inputs.
  const todayTrades = state.trades.filter(t => t.exitTime >= dayStart && t.exitTime <= now);
  const dayPnl = state.account ? todayTrades.reduce((sum, t) => sum + t.pnl, 0) : null;
  const crossesDay = todayTrades.some(t => t.entryTime < dayStart) || !!(state.position && state.position.entryTime < dayStart);
  const dayBase = state.account && !crossesDay ? state.account.initialCapital + state.trades.filter(t => t.exitTime < dayStart).reduce((sum, t) => sum + t.pnl, 0) : null;
  const dayPercent = dayPnl !== null && dayBase !== null && dayBase > 0 ? dayPnl / dayBase * 100 : null;
  const h1Pnl = state.account ? todayTrades.filter(t => t.timeframe === "1h").reduce((sum, t) => sum + t.pnl, 0) : null;
  const h1Signal = [...state.signals].reverse().find(s => s.timeframe === "1h");
  const blocked = display.h1Blocked;
  const botLabel = !state.account ? "À configurer" : blocked ? "Bloqué" : state.running && strategy?.enabled ? "Prêt" : "En attente";
  const activeBot = !!state.account && !blocked && state.running && !!strategy?.enabled;
  const money = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${paperNumber(value)} €`;
  const pnlColor = (value: number | null) => value === null || value === 0 ? "text-foreground" : value > 0 ? "text-emerald-400" : "text-rose-400";
  const enabledClass = "rounded-full border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300 hover:bg-emerald-500/10";
  const inactiveClass = "rounded-full border-border bg-secondary/60 px-3 py-1 text-muted-foreground hover:bg-secondary/60";
  return <div className="space-y-6">
    <section aria-label="Vue d’ensemble" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <article className="min-w-0 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5"><Coins className="mb-4 h-5 w-5 text-primary" /><p className="text-sm text-muted-foreground">Capital<TermHelp term="Equity" /></p><p className="mt-2 break-words font-mono text-xl font-semibold tracking-tight sm:text-2xl">{equity === null ? "—" : `${paperNumber(equity)} €`}</p><p className="mt-2 text-xs text-muted-foreground">Equity paper nette</p></article>
      <article className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"><TrendingUp className="mb-4 h-5 w-5 text-primary" /><p className="text-sm text-muted-foreground">P&L du jour<TermHelp term="P&L" /></p><p className={`mt-2 break-words font-mono text-xl font-semibold tracking-tight sm:text-2xl ${pnlColor(dayPnl)}`}>{money(dayPnl)}</p><p className="mt-2 text-xs text-muted-foreground">{dayPercent === null ? "— % · base quotidienne indisponible" : `${paperNumber(dayPercent)} % du solde de début de jour`}<br />{todayTrades.length ? "Clôturé · UTC · PAPER" : "Aucun trade aujourd’hui · PAPER"}</p></article>
      <article className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"><Layers className="mb-4 h-5 w-5 text-primary" /><p className="text-sm text-muted-foreground">Positions ouvertes</p><p className="mt-2 font-mono text-xl font-semibold sm:text-2xl">{state.position ? 1 : 0}</p><p className="mt-2 text-xs text-muted-foreground">Registre paper</p></article>
      <article className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"><Bot className="mb-4 h-5 w-5 text-primary" /><p className="text-sm text-muted-foreground">État du bot</p><p className={`mt-2 flex items-center gap-2 text-lg font-semibold sm:text-xl ${activeBot ? "text-emerald-400" : blocked ? "text-amber-300" : "text-foreground"}`}><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${activeBot ? "bg-emerald-400" : blocked ? "bg-amber-300" : "bg-muted-foreground"}`} />{botLabel}</p><p className="mt-2 text-xs text-muted-foreground">Simulation uniquement</p></article>
    </section>
    <section aria-label="Les deux stratégies" className="grid gap-4 md:grid-cols-2">
      <article className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-2.5 text-primary"><Activity className="h-5 w-5" /></span><h2 className="font-semibold">Stratégie principale H1</h2></div><Badge variant="outline" className={display.h1Blocked ? "rounded-full border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-200 hover:bg-amber-400/10" : display.h1Disabled ? inactiveClass : enabledClass}>{display.h1Label}</Badge></div>
        {display.h1Blocked && <div role="status" className="mt-4 space-y-2 border-l-2 border-amber-400/40 pl-3"><p className="text-xs leading-relaxed text-amber-200">{display.h1Reason}</p><Button variant="outline" size="sm" asChild className="min-h-10 rounded-lg border-amber-400/30 bg-transparent text-xs text-amber-200 hover:bg-amber-400/10 hover:text-amber-100"><Link to="/strategy-h1">Corriger dans Stratégies</Link></Button></div>}
                <dl className="mt-5 space-y-4 text-sm"><div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Dernier signal H1</dt><dd>{h1Signal ? <SignalBadge signal={h1Signal.direction} className="rounded-lg px-3 py-1" /> : "Aucun signal H1"}{h1Signal && <time className="mt-1 block text-right text-[11px] text-muted-foreground">{uiDateTime(h1Signal.time)}</time>}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Positions H1 ouvertes</dt><dd className="font-mono font-semibold">{state.position?.timeframe === "1h" ? 1 : 0}</dd></div><div className="flex justify-between gap-3 border-t border-border pt-4"><dt className="text-muted-foreground">Résultat H1 du jour</dt><dd className={`font-mono font-semibold ${pnlColor(h1Pnl)}`}>{money(h1Pnl)}</dd></div></dl>
                <p className="mt-4 text-xs text-muted-foreground">H1 · Twelve Data · PAPER<TermHelp term="Paper" /></p><div className="mt-2 flex flex-wrap gap-2"><Button asChild variant="outline" className="h-11 rounded-xl border-primary/25 text-xs text-primary"><Link to="/historique">Voir les signaux</Link></Button><Button asChild variant="outline" className="h-11 rounded-xl text-xs"><Link to="/strategy-h1">Voir la stratégie</Link></Button></div>
      </article>
      <article className="min-w-0 rounded-2xl border border-primary/20 bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-2.5 text-primary"><Zap className="h-5 w-5" /></span><h2 className="font-semibold">Scalping M1</h2></div><Badge variant="outline" className={display.scalpingLabel === "BACKTEST" ? "rounded-full border-primary/30 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/10" : inactiveClass}>{display.scalpingLabel}</Badge></div>
        <dl className="mt-5 space-y-4 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Dernier signal</dt><dd className="text-right text-muted-foreground">—<span className="block text-[11px]">Aucun signal Scalping disponible</span></dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Positions ouvertes</dt><dd className="text-muted-foreground">— · backtest uniquement</dd></div><div className="flex justify-between gap-3 border-t border-border pt-4"><dt className="text-muted-foreground">Résultat du jour</dt><dd className="text-muted-foreground">—</dd></div></dl>
        <p className="mt-4 text-xs text-muted-foreground">M1 · {display.history ? `MT5 / ${display.history.symbol}, historique chargé` : "MT5 : historique non chargé ; Twelve Data sélectionnable dans le module"}<TermHelp term="Backtest" /></p><p className="mt-1 text-xs text-muted-foreground">Dernière performance : — · aucun résultat partagé avec le Dashboard.</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">Backtests uniquement{!scalping.error && scalping.config.timeframe !== "1m" ? ` · réglage enregistré : ${scalping.config.timeframe}` : ""}</span><div className="flex flex-wrap gap-2"><Link to="/scalping" className="inline-flex min-h-11 items-center rounded-xl border border-primary/25 px-3 text-primary hover:bg-primary/5">Voir le module</Link><Link to="/scalping" className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-primary hover:bg-secondary">Voir les backtests</Link></div></div>
      </article>
    </section>
  </div>;
}
