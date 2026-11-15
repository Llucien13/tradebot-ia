import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Play, ShieldCheck, Square, TrendingUp, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trialRequest } from "@/lib/paper-trial-api";

const money = (value: number) => value.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const date = (seconds: number) => new Date(seconds * 1000).toLocaleString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const key = ["paper-trial"];

export default function PaperTrialPanel() {
  const client = useQueryClient();
  const [message, setMessage] = useState("");
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => trialRequest("state", signal), refetchInterval: 3000, retry: false, refetchOnWindowFocus: false });
  const mutation = useMutation({
    mutationFn: (action: "start" | "stop") => trialRequest(action),
    onMutate: async () => { setMessage(""); await client.cancelQueries({ queryKey: key }); },
    onSuccess: data => { client.setQueryData(key, data); },
    onError: error => { setMessage(error.message); },
    onSettled: () => { void client.invalidateQueries({ queryKey: key }); },
  });
  const data = query.data;
  const s = data?.state;
  const fresh = !query.isError && !!data?.valuationFresh && !!data.feed && Date.now() / 1000 - data.feed.time <= 15;
  const active = !!s?.running;
  const points = s?.curve.slice(-120) ?? [];
  const values = points.map(p => p.equity);
  const min = Math.min(...values, 20000), max = Math.max(...values, 20000);
  const line = points.map((p, i) => `${points.length > 1 ? i / (points.length - 1) * 600 : 0},${85 - (p.equity - min) / Math.max(max - min, 1) * 70}`).join(" ");
  const error = message || (query.isError ? query.error.message : "") || (s?.quoteWaiting ? "" : s?.error);
  const status = !data ? "Passerelle non connectée" : data.storageFault ? "Registre bloqué" : s?.status === "FAILED" ? "Limite de perte atteinte" : s?.quoteWaiting ? "En attente de cotations fraîches" : active && fresh ? s?.position ? "En cours · position virtuelle suivie" : "En cours · attente d’un signal M15" : active ? "Cours non certifiables" : s?.position ? "Entrées arrêtées · position conservée" : "Essai arrêté";

  return <section className="overflow-hidden rounded-3xl border border-primary/35 bg-card shadow-sm" aria-labelledby="paper-trial-title">
    <div className="space-y-5 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary"><FlaskConical className="h-6 w-6" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">ESSAI PAPER · compte indépendant</p><h2 id="paper-trial-title" className="mt-1 text-2xl font-bold tracking-tight">GOLD M15 · 2,5R</h2><p className="mt-2 text-sm text-muted-foreground">20 000 € virtuels · risque maximal 0,5 % · une position à la fois</p></div></div>
        <span className="flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"><ShieldCheck className="h-4 w-4" />LIVE OFF · aucun ordre MT5</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-secondary/50 p-4">
        <div role="status"><p className="flex items-center gap-2 text-sm font-semibold"><span className={`h-2 w-2 rounded-full ${active && fresh ? "bg-primary" : s?.quoteWaiting ? "bg-amber-500" : "bg-muted-foreground"}`} />{status}</p><p className="mt-1 text-xs text-muted-foreground">{s?.quoteWaiting ? `${s.quoteWaitReason ?? s.error}${s.quoteWaitAge != null ? ` · âge ${s.quoteWaitAge.toFixed(3)} s` : ""}. La reprise est automatique dès que les deux cotations repassent sous 15 s.` : s?.lastObserved ? `Dernière observation : ${date(s.lastObserved)} UTC` : "Démarrez pour contrôler les cours et charger les signaux."}</p></div>
        <div className="flex flex-wrap gap-2"><Button className="min-h-11 rounded-xl px-5" disabled={mutation.isPending || !data || active || !!data.storageFault || s?.status === "FAILED"} onClick={() => mutation.mutate("start")}><Play className="mr-2 h-4 w-4" />{mutation.isPending && mutation.variables === "start" ? "Contrôle des données…" : "Démarrer l'essai PAPER"}</Button><Button variant="outline" className="min-h-11 rounded-xl" disabled={mutation.isPending || !active} onClick={() => mutation.mutate("stop")}><Square className="mr-2 h-4 w-4" />Arrêter</Button></div>
      </div>
      {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm"><WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><div className="min-w-0"><p className="font-semibold">Essai PAPER — {active ? "suivi non confirmé" : "démarrage refusé / essai suspendu"}</p><p className="mt-1 break-words">{error}</p><p className="mt-2 text-xs text-muted-foreground">Ce message concerne uniquement l’essai. La preuve UTC du challenge FTMO ne valide ni ne bloque ses cotations UTC directes.</p></div></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
        ["Solde virtuel", s ? money(s.balance) : "—"], [fresh ? "Equity virtuelle" : "Dernière equity · figée", s ? money(s.equity) : "—"],
        ["Gains / pertes clôturés", s ? money(s.trades.reduce((total, t) => total + t.pnl, 0)) : "—"], ["Trades clôturés", s ? String(s.trades.length) : "—"],
      ].map(([label, value]) => <div key={label} className="rounded-2xl border border-border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-words text-lg font-bold sm:text-xl">{value}</p></div>)}</div>
      {points.length > 1 && <div className="rounded-2xl border border-border bg-secondary/20 p-4"><p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><TrendingUp className="h-4 w-4" />Equity observée · {money(s!.equity)}{!s?.verifiedContinuous && " · suivi interrompu par endroits"}</p><svg viewBox="0 0 600 100" role="img" aria-label="Courbe des observations réelles du compte virtuel" className="mt-3 h-24 w-full text-primary" preserveAspectRatio="none"><line x1="0" x2="600" y1="90" y2="90" stroke="currentColor" opacity="0.15" /><polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg></div>}
      {s?.position && <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Position virtuelle · {s.position.side === 1 ? "BUY" : "SELL"} XAU/USD</h3><span className="text-sm font-semibold">{fresh ? money(s.equity - s.balance) : "P&L latent non certifiable"}</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Volume", `${s.position.lots} lots`], ["Entrée", s.position.entry.toFixed(2)], ["Stop loss", s.position.sl.toFixed(2)], ["Take profit", s.position.tp.toFixed(2)]].map(([label, value]) => <p key={label}><span className="block text-xs text-muted-foreground">{label}</span><span className="mt-1 block font-medium">{value}</span></p>)}</div><p className="mt-3 text-xs text-muted-foreground">Risque initial : {money(s.position.riskEUR)}. Arrêter suspend les entrées ; les sorties SL/TP/temps continuent avec des cours fiables. Si le flux est perdu, la position est conservée sans clôture inventée.</p></div>}
      <div><h3 className="text-sm font-semibold">Historique de l’essai</h3>{s?.trades.length ? <div className="mt-3 max-h-80 overflow-auto rounded-2xl border border-border"><table className="w-full min-w-[580px] text-left text-sm"><thead className="sticky top-0 bg-secondary"><tr>{["Clôture UTC", "Sens", "Lots", "Entrée → sortie", "Motif", "P&L"].map(label => <th key={label} className="px-4 py-3 text-xs font-medium text-muted-foreground">{label}</th>)}</tr></thead><tbody>{[...s.trades].reverse().map(t => <tr key={t.signalTime} className="border-t border-border"><td className="whitespace-nowrap px-4 py-3">{date(t.exitTime)}</td><td className="px-4 py-3">{t.side === 1 ? "BUY" : "SELL"}</td><td className="px-4 py-3">{t.lots}</td><td className="whitespace-nowrap px-4 py-3">{t.entry.toFixed(2)} → {t.exit.toFixed(2)}</td><td className="px-4 py-3">{t.reason}</td><td className={`whitespace-nowrap px-4 py-3 font-semibold ${t.pnl >= 0 ? "text-primary" : "text-destructive"}`}>{money(t.pnl)}</td></tr>)}</tbody></table></div> : <p className="mt-2 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Aucun trade clôturé. Le moteur attend un véritable signal à une nouvelle bougie M15 : démarrer ne force jamais une entrée.</p>}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">{data?.costModel ?? "Simulation indépendante, non certifiée FTMO. Swaps exclus ; spread, commission et slippage de simulation appliqués."} Les garde-fous de perte de 1 000 €/jour et 2 000 € au total sont conservés, sans objectifs ni passage de phase. Le challenge ci-dessous reste bloqué et son registre est inchangé.</p>
    </div>
  </section>;
}
