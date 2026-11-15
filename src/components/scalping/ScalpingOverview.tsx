import { useEffect, useState } from "react";
import { Activity, Bot, Coins, Layers, TrendingUp, ShieldCheck } from "lucide-react";
import { useMT5DataSession, updateMT5DataSession } from "@/lib/mt5-data-session";
import { readScalpingEvidence, recordedScalpingSchema, auditRecordedScalping, type RecordedScalping } from "@/lib/scalping/evidence";
import { SCALPING_ENGINE_VERSION } from "@/lib/scalping/safety";
import { checkScalpingInvariants } from "@/lib/scalping/invariants";
import { uiDateTime } from "@/lib/ui-presentation";

export function ScalpingOverview({ currentResult, enabled }: { currentResult: object | null; enabled: boolean }) {
  const session = useMT5DataSession();
  const [checks] = useState(checkScalpingInvariants);
  const [archives, setArchives] = useState<{ capturedAt: string; result: RecordedScalping; issues: string[] }[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    console.info("[Scalping contrôles internes] Vérifications synthétiques sans backtest", { passed: checks.length === 0, errors: checks });
  }, [checks]);
  useEffect(() => {
    let active = true;
    void readScalpingEvidence().then(evidence => {
      if (!active) return;
      setArchives(evidence.results); setWarnings(evidence.warnings);
      if (!session.history && evidence.history) updateMT5DataSession({ history: evidence.history });
      console.info("[Scalping audit] Lecture sans recalcul", { results: evidence.results.map(r => ({ capturedAt: r.capturedAt, capital: r.result.settings.initialCapital, netPnl: r.result.stats.netPnl, trades: r.result.trades.length, issues: r.issues, engineVersion: r.result.engineVersion ?? "ancien moteur" })), mt5Candles: evidence.history?.candles.length ?? 0, optimizationReports: evidence.captures.filter(c => c.kind === "optimization").length, warnings: evidence.warnings, validation: "Non validé" });
    }).catch(e => { if (active) setWarnings([e instanceof Error ? e.message : "Sauvegardes non disponibles."]); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.history]);
  const parsed = currentResult ? recordedScalpingSchema.safeParse(currentResult) : null;
  const result = parsed?.success ? parsed.data : archives[index]?.result;
  const issues = result ? auditRecordedScalping(result) : [];
  const oldEngine = result && result.engineVersion !== SCALPING_ENGINE_VERSION;
  const number = (value: number) => value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const status = checks.length ? "Bloqué · contrôle interne" : loading ? "Lecture des archives" : !session.history ? "Données manquantes" : issues.length ? "Résultat à vérifier" : enabled ? "Prêt pour simulation" : "En pause";
  const cards = [
    { label: "Capital", value: result ? `${number(result.stats.finalCapital)} $` : "300 $", detail: result ? `Initial du test : ${number(result.settings.initialCapital)} $` : "Référence · pas un solde broker", icon: Coins },
    { label: "Bénéfice net", value: result ? `${number(result.stats.netPnl)} $` : "Non disponible", detail: "Résultat historique, frais déduits", icon: TrendingUp },
    { label: "Positions", value: "0", detail: result ? `${result.trades.length} clôturées dans ce test terminé` : "Pas de bot M1 en exécution continue", icon: Layers },
    { label: "Signaux du test", value: result ? `${result.controls.buySignals} BUY · ${result.controls.sellSignals} SELL` : "Non disponible", detail: "Comptages historiques · pas des signaux live", icon: Activity },
    { label: "État du bot M1", value: status, detail: "PAPER · backtest manuel uniquement", icon: Bot },
  ];
  return <section aria-label="Synthèse Scalping M1" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">XAU/USD · M1 · PAPER</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">Scalping, en un regard.</h1></div><span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-200">Non validé</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map(card => <article key={card.label} className="min-w-0 rounded-2xl border border-border bg-card p-5"><card.icon className="mb-4 h-5 w-5 text-primary" /><h2 className="text-sm text-muted-foreground">{card.label}</h2><p className="mt-2 break-words text-xl font-semibold">{card.value}</p><p className="mt-2 text-xs text-muted-foreground">{card.detail}</p></article>)}</div>
    {!!archives.length && !currentResult && <label className="block text-sm"><span className="mb-2 block text-muted-foreground">Résultat enregistré à consulter · aucun recalcul</span><select className="min-h-11 w-full rounded-xl border border-input bg-card px-3" value={index} onChange={e => setIndex(Number(e.target.value))}>{archives.map((a, i) => <option key={i} value={i}>{uiDateTime(Date.parse(a.capturedAt))} · {number(a.result.stats.netPnl)} $ net · {a.result.trades.length} trades</option>)}</select></label>}
    <div className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="space-y-1 text-sm"><p>Risque total de salve ≤ 1 % du capital disponible et ≤ 3 $ ; jusqu’à 3 positions partageant ce budget. Une seule salve ouverte.</p><p className="text-xs text-muted-foreground">Perte quotidienne prévue ≤ 3 % de la base du jour et ≤ 9 $. Gaps et coûts réels peuvent dépasser ces limites ; aucune garantie de perte maximale.</p></div></div>
    <p className="text-sm text-muted-foreground">{session.history ? `${session.history.candles.length.toLocaleString("fr-FR")} bougies MT5 existantes disponibles, sans nouvel appel.` : "Bougies MT5 : Non disponible. Aucun remplacement fictif."} Aucune preuve indépendante de rentabilité pour la logique actuelle.</p>
    {oldEngine && <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">Ancien moteur : ce résultat est conservé à l’identique, pas recalculé. Il ne valide pas les corrections actuelles.</p>}
    {result && !issues.length && <p className="text-xs text-muted-foreground">Contrôles arithmétiques du résultat cohérents : capital, PnL, commissions, côtés SL/TP, horodatages et budget de salve. Cela ne constitue pas une validation de performance.</p>}
    {[...warnings, ...issues, ...checks].map((warning, i) => <p key={i} role="alert" className="rounded-xl border border-amber-400/30 p-3 text-sm text-amber-200">{warning}</p>)}
  </section>;
}
