import { ArrowUpRight, ShieldCheck, Square, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useFTMOWorkspace } from "@/components/ftmo/FTMOWorkspace";
import PaperTrialPanel from "@/components/paper/PaperTrialPanel";

const euros = (value: number) => value.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

export default function Index() {
  const { data, busy, action } = useFTMOWorkspace();
  const s = data?.state;
  const closed = s?.trades.filter(t => t.phase === s.phase) ?? [];
  const won = closed.filter(t => t.pnl > 0);
  const gains = won.reduce((sum, t) => sum+t.pnl, 0), losses = -closed.filter(t => t.pnl < 0).reduce((sum, t) => sum+t.pnl, 0);
  const statusLabel = !s ? "Registre FTMO indisponible" : s.status === "SUCCEEDED" ? "Challenge simulé réussi" : s.status === "FAILED" ? "Challenge simulé échoué" : `Phase ${s.phase}`;
  return <>
    <PaperTrialPanel />
    <section className="space-y-6 rounded-3xl border border-primary/25 bg-card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Un seul cadre · une seule stratégie de référence</p><h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">GOLD M15 <span className="text-primary">2,5R</span></h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Challenge FTMO de 20 000 € virtuels. Le moteur, les signaux et les contrôles de risque sont conservés. La variante 5R reste une comparaison historique uniquement.</p></div><span className="flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" />{s?.running ? "BOT RUNNING · virtuel" : "BOT STOPPED"}</span></div>
      <div className="grid gap-3 sm:grid-cols-3">{[["Capital de référence", "20 000 €", Target], ["Risque maximal par trade", "0,5 %", ShieldCheck], ["Positions simultanées", "1 maximum", Square]].map(([label, value, Icon]) => { const Symbol = Icon as typeof Target; return <div key={String(label)} className="rounded-2xl border border-border bg-secondary/40 p-4"><Symbol className="mb-3 h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">{String(label)}</p><p className="mt-2 text-xl font-bold">{String(value)}</p></div>; })}</div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5"><div><p className="text-sm font-semibold">{statusLabel}</p><p className="mt-1 text-xs text-muted-foreground">{data?.connected ? "Connexion MT5 rapportée par la passerelle" : "MT5 déconnecté / non testé"} · PAPER exclusivement · LIVE désactivé</p></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline" className="min-h-11 rounded-xl"><Link to="/mt5">Connexion MT5<ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button><Button disabled className="min-h-11 rounded-xl">Démarrage PAPER suspendu</Button><Button disabled={busy || !s?.running} variant="outline" className="min-h-11 rounded-xl" onClick={() => void action("stop")}><Square className="mr-2 h-4 w-4" />STOP</Button></div></div>
      <p className="text-xs leading-relaxed text-muted-foreground">L’étape B maintient le bot arrêté : le démarrage est désactivé dans l’interface, sans changer le moteur. Aucun ordre n’est envoyé au broker.</p>
    </section>
    <section className="space-y-4" aria-labelledby="ftmo-metrics"><h2 id="ftmo-metrics" className="text-lg font-semibold">Progression du challenge</h2>
      {s && data ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Solde virtuel", euros(s.balance)], ["Equity virtuelle", euros(s.equity)], ["Gain net de phase", `${euros(s.balance-20000)} · ${((s.balance/20000-1)*100).toFixed(2)} %`], ["Objectif restant (solde clôturé)", euros(data.limits.remainingTarget)],
        ["Perte quotidienne disponible", euros(data.limits.dailyAvailable)], ["Perte totale disponible", euros(data.limits.totalAvailable)], ["Jours de trading", `${s.days.length} / minimum 4`], ["Positions ouvertes / clôturées", `${s.position ? 1 : 0} / ${closed.length}`],
        ["Taux de réussite", closed.length ? `${(won.length/closed.length*100).toFixed(1)} %` : "—"], ["Profit factor", losses ? (gains/losses).toFixed(2) : gains ? "∞" : "—"], ["Drawdown maximal de phase", euros(s.maxDrawdown)], ["Capital initial de phase", euros(20000)],
      ].map(([label, value]) => <div key={label} className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-bold">{value}</p></div>)}</div> : <div className="rounded-2xl border border-border bg-card p-5 text-sm leading-relaxed text-muted-foreground">Aucun registre FTMO reçu de la passerelle. Le capital de référence ci-dessus n’est pas un solde mesuré. Aucun gain, trade ou graphique fictif n’est affiché.</div>}
    </section>
    {s?.position && <section className="rounded-2xl border border-primary/25 bg-card p-5"><h2 className="font-semibold">Position virtuelle en cours</h2><p className="mt-3 text-sm">{s.position.side === 1 ? "BUY" : "SELL"} · {s.position.lots} lots · entrée {s.position.entry.toFixed(2)} · SL {s.position.sl.toFixed(2)} · TP {s.position.tp.toFixed(2)} · risque initial {euros(s.position.riskEUR)}</p></section>}
    <div className="grid gap-4 sm:grid-cols-2"><Link to="/historique" className="rounded-2xl border border-border bg-card p-5 hover:border-primary/40"><p className="font-semibold">Historique et performances ↗</p><p className="mt-2 text-sm text-muted-foreground">Registre PAPER et références originales 2,5R / 5R, chargés à la demande.</p></Link><Link to="/settings" className="rounded-2xl border border-border bg-card p-5 hover:border-primary/40"><p className="font-semibold">Paramètres et sauvegardes ↗</p><p className="mt-2 text-sm text-muted-foreground">Limites fixes, frais de simulation, contrôles Windows et copies conservées.</p></Link></div>
  </>;
}
