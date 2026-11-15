import { useEffect, useState } from "react";
import { z } from "zod";
import { Bot, Cable, FlaskConical, Play, ShieldCheck, Square } from "lucide-react";
import { AppNavigation } from "@/components/navigation/AppNavigation";
import { Button } from "@/components/ui/button";
import { FTMOHistory } from "@/components/ftmo/FTMOHistory";
import { FTMOLedger, dateTime, euros } from "@/components/ftmo/FTMOLedger";
import { ftmoRequest, ftmoSnapshotSchema, startSchema, type FTMOSnapshot } from "@/lib/ftmo-api";

export default function FTMO20K() {
  const [data, setData] = useState<FTMOSnapshot | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [costs, setCosts] = useState({ swapLongUSD: "", swapShortUSD: "", swapHourUTC: "", commissionUSD: "3", slippageUSD: "0.05" });
  useEffect(() => {
    let active = true; let current: AbortController | null = null;
    const refresh = async () => {
      if (current) return;
      const controller = new AbortController(); current = controller;
      const timer = window.setTimeout(() => controller.abort(), 25000);
      try { const value = await ftmoRequest("state", ftmoSnapshotSchema, "GET", undefined, controller.signal); if (active) { setData(value); setError(""); } }
      catch (e) { if (active) { setData(null); setError(e instanceof Error ? e.message : "Lecture FTMO impossible."); } }
      finally { window.clearTimeout(timer); current = null; }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 3000);
    return () => { active = false; current?.abort(); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!data) return;
    const s = data.state;
    if (s.swapLongUSD !== null) setCosts({ swapLongUSD: String(s.swapLongUSD), swapShortUSD: String(s.swapShortUSD), swapHourUTC: String(s.swapHourUTC), commissionUSD: String(s.commissionUSD), slippageUSD: String(s.slippageUSD) });
  }, [data?.state.swapLongUSD, data?.state.swapShortUSD, data?.state.swapHourUTC, data?.state.commissionUSD, data?.state.slippageUSD]);
  const action = async (path: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (path === "verify") { await ftmoRequest(path, z.object({ started: z.literal(true) }), "POST"); }
      else {
        let body: unknown;
        if (path === "start") {
          if (Object.values(costs).some(value => !value.trim())) throw new Error("Renseignez les swaps signés USD/lot/nuit et l’heure de rollover UTC. Aucun swap nul ne sera supposé automatiquement.");
          body = startSchema.parse(Object.fromEntries(Object.entries(costs).map(([key, value]) => [key, Number(value)])));
        }
        if (path === "reset" && !window.confirm("Archiver ce challenge local et créer un nouveau compte virtuel de 20 000 € ? Aucun historique n’est supprimé.")) return;
        const value = await ftmoRequest(path, ftmoSnapshotSchema, path === "feed" ? "GET" : "POST", body);
        setData(value);
      }
    } catch (e) { setError(e instanceof z.ZodError ? "Coûts invalides : swaps signés, heure UTC entière de 0 à 23, commission et slippage non négatifs." : e instanceof Error ? e.message : "Action FTMO impossible."); }
    finally { setBusy(false); }
  };
  const s = data?.state;
  const closed = s?.trades.filter(t => t.phase === s.phase) ?? [];
  const won = closed.filter(t => t.pnl > 0);
  const gains = won.reduce((sum, t) => sum+t.pnl, 0), losses = -closed.filter(t => t.pnl < 0).reduce((sum, t) => sum+t.pnl, 0);
  const statusLabel = !s ? "Indisponible" : s.status === "SUCCEEDED" ? "Challenge simulé réussi" : s.status === "FAILED" ? "Challenge simulé échoué" : `Phase ${s.phase}`;
  return <div className="min-h-screen bg-background text-foreground lg:flex">
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-card/50 lg:flex"><div className="flex items-center gap-3 border-b border-border p-5"><Bot className="h-6 w-6 text-primary" /><div><p className="font-bold">TradeBot IA</p><p className="text-xs text-muted-foreground">FTMO 20K indépendant</p></div></div><nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Navigation principale"><AppNavigation /></nav><p className="m-4 rounded-xl border border-primary/20 p-3 text-xs text-muted-foreground">Aucun ordre broker.<br />Le solde MT5 n’est jamais le capital de ce challenge.</p></aside>
    <div className="min-w-0 flex-1"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-4 sm:px-6"><h1 className="text-xl font-bold">FTMO 20K · GOLD M15</h1><span className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"><ShieldCheck className="h-4 w-4" />PAPER uniquement · LIVE désactivé</span></header>
      <main className="mx-auto max-w-[1500px] space-y-6 p-4 pb-28 sm:p-6 lg:pb-8">
        <section className="space-y-5 rounded-3xl border border-primary/25 bg-card p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Trading PAPER actuel · cours MT5 réels</p><h2 className="mt-2 text-2xl font-bold">GOLD M15 2,5R — FTMO 20K EUR</h2><p className="mt-2 text-sm text-muted-foreground">20 000 € virtuels · risque maximal 0,5 % · une seule position · 5R réservé à la comparaison historique</p></div><div className="space-y-2 text-right"><p className="rounded-full border border-border px-3 py-2 text-sm font-semibold">{statusLabel}</p><p className="text-xs text-muted-foreground">{s?.running ? "BOT RUNNING · virtuel" : "BOT STOPPED"} · {data?.connected ? "MT5 connecté" : "MT5 déconnecté / non testé"}</p></div></div>
          <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void action("feed")} variant="outline" className="min-h-12 rounded-xl"><Cable className="mr-2 h-4 w-4" />Tester la connexion MT5</Button><Button disabled={busy || !data || data.verifying || s?.running || !!s?.position} onClick={() => void action("verify")} variant="outline" className="min-h-12 rounded-xl"><FlaskConical className="mr-2 h-4 w-4" />{data?.verifying ? "Vérification en cours…" : "Vérifier le moteur original"}</Button><Button disabled={busy || !data || data.verification.status !== "PASSED" || s?.running || s?.status === "FAILED" || s?.status === "SUCCEEDED"} onClick={() => void action("start")} className="min-h-12 rounded-xl font-bold"><Play className="mr-2 h-4 w-4" />START BOT PAPER</Button><Button disabled={busy || !s?.running} variant="outline" onClick={() => void action("stop")} className="min-h-12 rounded-xl"><Square className="mr-2 h-4 w-4" />STOP</Button></div>
          {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">{error}</p>}
          {s?.error && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{s.error}</p>}
          {s && !s.verifiedContinuous && <p role="alert" className="text-sm">Le suivi a été interrompu. Des excursions d’equity entre mesures sont inconnues : ce résultat n’est pas une preuve de respect continu des limites.</p>}
          {data?.feed && <div className="rounded-2xl border border-border bg-secondary/40 p-4 text-sm"><p className="font-semibold">Source officielle MT5 · XAUUSD-ECN · {data.feed.accountType} · {data.feed.company} / {data.feed.server}</p><p className="mt-2">BID {data.feed.bid.toFixed(2)} · ASK {data.feed.ask.toFixed(2)} · spread {data.feed.spread.toFixed(3)} USD/oz<br />{data.feed.fxSymbol} : 1 EUR = {data.feed.fx.toFixed(5)} USD · tick {dateTime(data.feed.time)} Prague</p><p className="mt-2 text-xs text-muted-foreground">Contrat {data.feed.contract.size} oz/lot · lots {data.feed.contract.minLot} à {data.feed.contract.maxLot}, pas {data.feed.contract.step} · tick size/value {data.feed.contract.tickSize} / {data.feed.contract.tickValue}<br />Swaps MT5 bruts : mode {data.feed.contract.swapMode}, long {data.feed.contract.swapLong}, short {data.feed.contract.swapShort}. Convertissez ces valeurs en USD/lot/nuit selon les spécifications du broker ci-dessous. Ne copiez pas des points comme des USD.</p>{Date.now()/1000-data.feed.time > 15 && <p className="mt-2 font-semibold">Cotation ancienne : aucune nouvelle entrée autorisée.</p>}</div>}
          <details className="rounded-2xl border border-border p-4" open={!s || s.swapLongUSD === null}><summary className="cursor-pointer text-sm font-semibold">Frais PAPER et swaps — saisie explicite requise</summary><p className="mt-3 text-xs text-muted-foreground">Commission et slippage : hypothèses historiques modifiables pour la simulation. Swaps signés en USD par lot et par nuit, avec heure de rollover UTC du broker. Un débit est négatif. Le multiplicateur triple est lu dans MT5. Ces hypothèses ne garantissent pas les frais FTMO réels ; vérifiez-les auprès du broker, notamment lors du changement d’heure.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
            ["swapLongUSD", "Swap long USD/lot/nuit"], ["swapShortUSD", "Swap short USD/lot/nuit"], ["swapHourUTC", "Rollover broker (heure UTC)"], ["commissionUSD", "Commission USD/lot/sens"], ["slippageUSD", "Slippage USD/oz/sens"],
          ].map(([key, label]) => <label key={key} className="space-y-2 text-xs"><span>{label}</span><input type="number" step={key === "swapHourUTC" ? "1" : "0.01"} disabled={!!s?.position || !!s?.running} value={costs[key as keyof typeof costs]} onChange={e => setCosts(v => ({ ...v, [key]: e.target.value }))} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm" /></label>)}</div></details>
          {s && data && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
            ["Capital initial de phase", euros(20000)], ["Solde virtuel", euros(s.balance)], ["Equity virtuelle", euros(s.equity)], ["Gain net de phase", `${euros(s.balance-20000)} · ${((s.balance/20000-1)*100).toFixed(2)} %`],
            ["Objectif restant (solde clôturé)", euros(data.limits.remainingTarget)], ["Perte quotidienne disponible", euros(data.limits.dailyAvailable)], ["Perte totale disponible", euros(data.limits.totalAvailable)], ["Jours de trading", `${s.days.length} / minimum 4`],
            ["Positions ouvertes / clôturées", `${s.position ? 1 : 0} / ${closed.length}`], ["Taux de réussite", closed.length ? `${(won.length/closed.length*100).toFixed(1)} %` : "—"], ["Profit factor", losses ? (gains/losses).toFixed(2) : gains ? "∞" : "—"], ["Drawdown maximal de phase", euros(s.maxDrawdown)],
          ].map(([label, value]) => <div key={label} className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-bold">{value}</p></div>)}</div>}
          <p className="text-xs text-muted-foreground">Limites fixes : quotidien 1 000 € sur equity, reset minuit Europe/Prague avec changement d’heure ; plancher total 18 000 €. Objectifs : solde 22 000 €, puis nouveau capital 20 000 € et solde 21 000 €, sans position ouverte et au moins 4 jours par phase.</p>
          {data && <details className="rounded-2xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">Fidélité et vérifications · {data.verification.status}</summary><p className="mt-3 text-sm">Les contrôles recalculent uniquement quatre replays originaux et comparent toutes les colonnes de transactions, ainsi que les signaux, stops et horodatages sur des points ciblés. Aucune grille d’optimisation n’est lancée. START reste bloqué tant que les contrôles ne sont pas réussis.</p>{data.verification.error && <p className="mt-3 text-sm text-destructive">{data.verification.error}</p>}{data.verification.replays?.map(r => <div key={`${r.year}-${r.tpR}`} className="mt-3 rounded-xl bg-secondary/50 p-3 text-sm">{r.year} · {r.tpR}R : {r.passed ? "replay conforme à l’archive" : "écarts détectés"}{r.errors.length > 0 && <pre className="mt-2 whitespace-pre-wrap text-xs">{JSON.stringify(r.errors, null, 2)}</pre>}</div>)}<p className="mt-3 text-xs text-muted-foreground">Le moteur de signaux exécute les expressions originales. Les fills PAPER sont aux ticks BID/ASK observés, pas aux ouvertures OHLC historiques : spread variable, change au tick, swaps, reset Prague et retard de polling peuvent changer les résultats. EMA initialisée sur les bougies MT5 disponibles, non sur tout le CSV ancien.</p></details>}
          <p className="text-xs text-muted-foreground">Suivi toutes les 2 s dans la passerelle, même si cette page est fermée. Ce n’est pas un enregistreur de tous les ticks : des franchissements entre deux lectures peuvent échapper au suivi. Gardez le PC, MT5 et la passerelle ouverts. Aucune garantie de réussite réelle.</p>
          {data && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="max-w-3xl break-words text-xs text-muted-foreground">Sauvegarde atomique locale : {data.storage}. Un redémarrage conserve la progression mais remet le bot STOPPED. Les positions virtuelles restantes continuent d’être surveillées au retour des cotations.</p><Button disabled={busy || s.running || !!s.position} variant="outline" onClick={() => void action("reset")} className="min-h-11 rounded-xl">Archiver / nouveau challenge</Button></div>}
        </section>
        {data && <FTMOLedger data={data} />}
        <FTMOHistory />
      </main><nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-2 lg:hidden"><AppNavigation mobile /></nav>
    </div>
  </div>;
}
