import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { FlaskConical, Play, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { BACKTEST_STORAGE_KEY, STRATEGY_STORAGE_KEY, strategySchema, type Strategy } from "@/lib/strategies";
import { INTERVAL_MS, warmupBars, type BacktestResult, type BacktestSettings, type HistoricalData } from "@/lib/backtest/types";
import { BacktestResults } from "@/components/backtest/BacktestResults";
import { Field, NumberField, Section, selectClass, actionClass } from "./StrategyFields";

const historySchema = z.object({ source: z.literal("TWELVE_DATA"), fetchedAt: z.string().datetime(), cached: z.boolean(), warnings: z.array(z.string()), candles: z.array(z.object({ time: z.number().finite(), open: z.number().positive().finite(), high: z.number().positive().finite(), low: z.number().positive().finite(), close: z.number().positive().finite(), volume: z.number().nonnegative().finite() })).min(2).max(5000) });
const costsSchema = z.object({ initialCapital: z.number().positive().max(1e12), spread: z.number().min(0).max(1000), slippage: z.number().min(0).max(1000), commission: z.number().min(0).max(1000) });
interface Option { key: string; strategy: Strategy; label: string }
function readOptions(requested: string | null) {
  try {
    const options: Option[] = [];
    const rawSnapshot = localStorage.getItem(BACKTEST_STORAGE_KEY);
    if (rawSnapshot) { const s = strategySchema.parse(JSON.parse(rawSnapshot)); options.push({ key: `snapshot:${s.id}`, strategy: s, label: `${s.name} · instantané transféré` }); }
    const rawSaved = localStorage.getItem(STRATEGY_STORAGE_KEY);
    if (rawSaved) for (const s of z.array(strategySchema).parse(JSON.parse(rawSaved))) options.push({ key: `saved:${s.id}`, strategy: s, label: `${s.name} · version enregistrée` });
    const selected = requested ? options.find(o => o.strategy.id === requested) : options[0];
    return { options, selected: selected?.key ?? "", error: requested && !selected ? "Stratégie demandée introuvable. Renvoyez-la depuis Strategy Lab." : null };
  } catch { return { options: [] as Option[], selected: "", error: "Les configurations locales sont invalides ou inaccessibles. Enregistrez et renvoyez la stratégie depuis Strategy Lab." }; }
}
const day = 86400000;
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);

export function BacktestStrategy() {
  const [params] = useSearchParams();
  const [initial] = useState(() => readOptions(params.get("strategy")));
  const [selected, setSelected] = useState(initial.selected);
  const strategy = initial.options.find(o => o.key === selected)?.strategy;
  const [timeframe, setTimeframe] = useState<BacktestSettings["timeframe"]>(strategy?.timeframes[0] ?? "1h");
  const today = Date.parse(isoDay(Date.now()) + "T00:00:00Z");
  const [startDate, setStartDate] = useState(isoDay(today - 7 * day));
  const [endDate, setEndDate] = useState(isoDay(today - day));
  const [costs, setCosts] = useState({ initialCapital: 10000, spread: 0.3, slippage: 0.05, commission: 0 });
  const [error, setError] = useState(initial.error ?? "");
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); workerRef.current?.terminate(); workerRef.current = null; }, []);
  const reset = () => { setResult(null); setError(""); setPercent(0); };
  const changeCost = (key: keyof typeof costs, value: number) => { reset(); setCosts(c => ({ ...c, [key]: value })); };
  const launch = async () => {
    if (requestRef.current || workerRef.current) return;
    reset();
    if (!strategy) { setError("Sélectionnez une stratégie enregistrée."); return; }
    const validCosts = costsSchema.safeParse(costs);
    const start = Date.parse(`${startDate}T00:00:00Z`), end = Date.parse(`${endDate}T00:00:00Z`) + day;
    if (!validCosts.success) { setError("Capital initial positif et fini requis ; spread, slippage et commission doivent être compris entre 0 et 1 000."); return; }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end > Date.now()) { setError("Choisissez une période passée valide, en jours entiers UTC. La fin est inclusive ; aujourd’hui est exclu pour ne traiter que des bougies clôturées."); return; }
    if (!strategy.timeframes.includes(timeframe)) { setError("Timeframe non autorisé par cette stratégie."); return; }
    const warmup = warmupBars(strategy);
    if (Math.ceil((end - start) / INTERVAL_MS[timeframe]) + warmup > 5000) { setError("Cette période dépasse le plafond de 5 000 bougies, préchauffage inclus. Réduisez la période ou choisissez un timeframe plus élevé. Le backtest n’effectue pas de pagination pour préserver le quota Twelve Data."); return; }
    const settings: BacktestSettings = { ...costs, start, end, timeframe };
    setBusy(true); setStage("Récupération et validation des bougies Twelve Data…");
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const query = new URLSearchParams({ timeframe, start: String(start), end: String(end), warmup: String(warmup) });
      const response = await fetch(`/api/backtest-history?${query}`, { signal: controller.signal, cache: "no-store" });
      let body: unknown;
      try { body = await response.json(); } catch { throw new Error("Le serveur historique ne renvoie pas de données JSON valides."); }
      if (!response.ok) {
        const failure = z.object({ statusMessage: z.string().optional(), message: z.string().optional() }).safeParse(body);
        throw new Error(failure.success ? failure.data.statusMessage || failure.data.message || "Historique Twelve Data indisponible." : "Historique Twelve Data indisponible.");
      }
      const parsed = historySchema.safeParse(body);
      if (!parsed.success) throw new Error("Historique réel invalide. Le backtest ne peut pas utiliser de données DEMO.");
      if (controller.signal.aborted) return;
      const history = parsed.data as HistoricalData;
      setPercent(10); setStage("Calcul des indicateurs et simulation bougie par bougie…");
      const worker = new Worker(new URL("../../lib/backtest/backtest.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ type: string; percent?: number; result?: BacktestResult; message?: string }>) => {
        if (workerRef.current !== worker) return;
        const message = event.data;
        if (message.type === "progress") setPercent(10 + Math.round(0.9 * (message.percent ?? 0)));
        else {
          worker.terminate(); workerRef.current = null; requestRef.current = null; setBusy(false);
          if (message.type === "result" && message.result) { setResult(message.result); setPercent(100); setStage("Backtest terminé sur les données historiques réelles."); }
          else { setResult(null); setError(message.message || "Le calcul a échoué. Aucun résultat affiché."); }
        }
      };
      worker.onerror = () => { worker.terminate(); workerRef.current = null; requestRef.current = null; setBusy(false); setResult(null); setError("Le moteur de calcul a échoué. Aucun résultat de remplacement n’est généré."); };
      worker.postMessage({ strategy, settings, history });
    } catch (e) {
      if (controller.signal.aborted) return;
      requestRef.current = null; setBusy(false); setResult(null); setError(e instanceof Error ? e.message : "Backtest impossible. Aucun résultat généré.");
    }
  };
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">XAU/USD · Backtest</p><h1 className="text-2xl font-bold sm:text-3xl">Éprouvez vos règles sur l’histoire.</h1><p className="mt-2 text-sm text-muted-foreground">Données Twelve Data réelles. Calcul local, sans broker ni ordre réel.</p></div><span className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-xs text-primary"><ShieldCheck className="h-4 w-4" />Simulation uniquement</span></div>
    <form noValidate onSubmit={e => { e.preventDefault(); if (!busy) void launch(); }}>
      <Section title="Paramètres du backtest" description="Les versions enregistrées et l’instantané envoyé depuis le Lab sont distingués. Aucun paramètre de stratégie n’est modifié ici.">
        <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Stratégie"><select className={selectClass} value={selected} onChange={e => { reset(); setSelected(e.target.value); const s = initial.options.find(o => o.key === e.target.value)?.strategy; if (s) setTimeframe(s.timeframes[0]); }}><option value="" disabled>Sélectionnez une stratégie</option>{initial.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></Field><Field label="Timeframe enregistré"><select className={selectClass} value={timeframe} onChange={e => { reset(); setTimeframe(e.target.value as BacktestSettings["timeframe"]); }}>{(strategy?.timeframes ?? []).map(tf => <option key={tf} value={tf}>{tf}</option>)}</select></Field><Field label="Date de début (UTC)"><Input type="date" value={startDate} max={isoDay(today - day)} onChange={e => { reset(); setStartDate(e.target.value); }} className="h-11 rounded-xl bg-background" /></Field><Field label="Date de fin incluse (UTC)"><Input type="date" value={endDate} min={startDate} max={isoDay(today - day)} onChange={e => { reset(); setEndDate(e.target.value); }} className="h-11 rounded-xl bg-background" /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><NumberField label="Capital initial ($)" min={0.01} step={100} value={costs.initialCapital} onChange={v => changeCost("initialCapital", v)} /><NumberField label="Spread simulé ($/oz)" hint="Écart bid/ask constant ; moitié à chaque sens." min={0} max={1000} step={0.01} value={costs.spread} onChange={v => changeCost("spread", v)} /><NumberField label="Slippage ($/oz/sens)" hint="Dégradation du prix à chaque entrée et sortie." min={0} max={1000} step={0.01} value={costs.slippage} onChange={v => changeCost("slippage", v)} /><NumberField label="Commission ($/oz/sens)" hint="Frais par once, à l’entrée et à la sortie." min={0} max={1000} step={0.01} value={costs.commission} onChange={v => changeCost("commission", v)} /></div>
        </fieldset>
        {strategy && !strategy.enabled && <p className="rounded-xl border border-border p-3 text-sm">Cette configuration est désactivée : le calcul est possible, mais aucun trade ne sera exécuté. Activez et enregistrez la stratégie dans le Lab, puis renvoyez-la pour la tester activée.</p>}
        {strategy && <details><summary className="cursor-pointer text-sm text-primary">Vérifier la configuration exacte sélectionnée</summary><pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-background p-4 text-xs">{JSON.stringify(strategy, null, 2)}</pre></details>}
        <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || !strategy} className={`${actionClass} bg-primary text-primary-foreground hover:bg-primary/90`}><Play className="mr-2 h-4 w-4" />{busy ? "Calcul en cours…" : "Lancer le backtest"}</Button>{busy && <Button type="button" variant="outline" className={actionClass} onClick={() => { requestRef.current?.abort(); workerRef.current?.terminate(); requestRef.current = null; workerRef.current = null; setBusy(false); setStage(""); setError("Backtest annulé. Aucun résultat affiché."); }}>Annuler</Button>}<Link to="/strategy-h1" className="inline-flex items-center rounded-xl border border-border px-4 py-3 text-sm hover:bg-secondary">Retour à la Stratégie H1</Link></div>
        {(busy || result) && <div role="status" aria-live="polite" className="space-y-2"><p className="text-sm text-muted-foreground">{stage} {busy ? `${percent}%` : ""}</p><Progress value={percent} aria-label={`Progression du backtest : ${percent}%`} className="h-2 rounded-full bg-secondary [&>div]:bg-primary" /></div>}
        {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm leading-relaxed">{error}</p>}
      </Section>
    </form>
    <details className="rounded-2xl border border-border p-4"><summary className="cursor-pointer text-sm text-primary">Détails · modèle d’exécution et limites</summary><div className="mt-4">
    <Section title="Modèle d’exécution & limites" description="Hypothèses explicites pour rendre les résultats reproductibles, sans look-ahead bias.">
      <ul className="list-disc space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">
        <li>Signal à la clôture, entrée à l’ouverture suivante ; jusqu’à {strategy?.maxConcurrentPositions ?? 1} position(s) simultanée(s), selon le réglage enregistré dans Strategy Lab (1 par défaut, maximum 5). Un signal valide sur chaque nouvelle bougie peut préparer une entrée si une place reste libre, sans file d’attente des signaux refusés à la limite. Aucun retournement automatique ; des positions de sens opposés peuvent coexister si leurs signaux successifs sont valides. Conditions opposées valides simultanément : WAIT. Les filtres de sessions UTC et de spread sont vérifiés au signal puis à l’entrée.</li>
        <li>Confiance = conditions satisfaites / conditions du sens × 100. Confirmations minimales ET confiance minimale requises. Cooldown inchangé après la dernière clôture, y compris si d’autres positions restent ouvertes. La dernière bougie ne peut pas créer de nouvelle entrée.</li>
        <li>OHLC utilisés comme prix de référence ; achats au ask, ventes au bid, spread constant et slippage adverse. SL/TP initialisés au prix exécuté. Risque monétaire par trade = capital comptabilisé courant × risque enregistré ; résultats réalisés et commissions d’entrée inclus, gains latents exclus. Taille en onces intégrant le slippage de sortie et les commissions aller-retour dans le risque au SL, hors gaps. Chaque position conserve sa taille, son entrée, ses SL/TP, son break-even et son trailing indépendamment. Le risque cumulé de plusieurs positions peut dépasser le risque par trade.</li>
        <li>Stop structure : extrêmes des dernières bougies clôturées et marge enregistrée. Take Profit à la distance initiale du SL × R:R. BE au prix d’entrée (frais non remboursés) et trailing sur la meilleure clôture depuis l’entrée, à la distance ATR enregistrée. Changements de SL uniquement après clôture, effectifs à la bougie suivante ; le SL ne recule jamais.</li>
        <li>Si SL et TP sont touchés sans ordre intrabougie connu, le SL est prioritaire ; un gap à l’ouverture est traité d’abord. Un gap peut dépasser le risque prévu. L’heure exacte intrabougie étant inconnue, les sorties non-gap sont horodatées à la clôture de leur bougie. Toutes les positions restantes sont liquidées en fin de période. Les sorties sont enregistrées par horodatage, puis par ordre d’ouverture en cas d’égalité.</li>
        <li>Equity et drawdown nets calculés à chaque clôture, avec les gains/pertes latents et frais de liquidation estimés de toutes les positions ouvertes. Pas de drawdown tick par tick, de swap, de marge broker ni de levier modélisé. Les statistiques portent sur les trades clôturés, commissions déduites.</li>
        <li>Une seule requête historique, au maximum 5 000 bougies avec préchauffage. Cache serveur 6 heures (12 périodes maximum) et requêtes identiques mutualisées. Délai minimum de 10 secondes entre historiques différents ; aucune relance ni pagination automatique. Droits historiques et quotas réels dépendent de l’offre Twelve Data.</li>
      </ul>
    </Section></div></details>
    {result ? <BacktestResults key={`${result.history.fetchedAt}:${result.strategy.id}:${result.settings.start}`} result={result} /> : !busy && <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5"><FlaskConical className="h-6 w-6 shrink-0 text-primary" /><div><h2 className="font-semibold">Aucun résultat calculé pour cette configuration</h2><p className="mt-2 text-sm text-muted-foreground">Lancez le backtest pour récupérer et vérifier l’historique. Aucun trade, taux de réussite ou graphique n’est inventé en cas d’erreur.</p></div></div>}
  </div>;
}
