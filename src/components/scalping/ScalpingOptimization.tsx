import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Field, NumberField, selectClass } from "@/components/strategy/StrategyFields";
import type { ScalpingConfig } from "@/lib/scalping/model";
import type { MT5History } from "@/lib/mt5-data";
import { validateMT5ScalpingHistory, type ScalpingHistory } from "@/lib/scalping/history";
import type { HistoricalData, BacktestSettings } from "@/lib/backtest/types";
import type { OptimizationReport } from "@/lib/scalping/optimizer";
import { scalpingWarmup } from "@/lib/scalping/signals";
import { OptimizationResults } from "./OptimizationResults";
import { reserveScalpingRun } from "@/lib/scalping/evidence";
const twelveSchema = z.object({ source: z.literal("TWELVE_DATA"), fetchedAt: z.string().datetime(), cached: z.boolean(), warnings: z.array(z.string()), candles: z.array(z.object({ time: z.number().int().positive(), open: z.number().finite().positive(), high: z.number().finite().positive(), low: z.number().finite().positive(), close: z.number().finite().positive(), volume: z.number().finite().nonnegative() })).min(150).max(5000) });
const completedReports: OptimizationReport[] = [];
export function ScalpingOptimization({ config, mt5History, onApply }: { config: ScalpingConfig | null; mt5History: MT5History | null; onApply: (config: ScalpingConfig) => void }) {
  const [source, setSource] = useState<"MT5" | "TWELVE_DATA">("MT5");
  useEffect(() => { if (mt5History) setSource("MT5"); }, [mt5History]);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const [start, setStart] = useState(yesterday), [end, setEnd] = useState(yesterday);
  const [costs, setCosts] = useState({ spread: 0.3, slippage: 0.05, commission: 0 });
  const [busy, setBusy] = useState(false), [percent, setPercent] = useState(0), [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<OptimizationReport | null>(completedReports.at(-1) ?? null);
  const worker = useRef<Worker | null>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { worker.current?.terminate(); controller.current?.abort(); }, []);
  const cancel = () => { controller.current?.abort(); worker.current?.terminate(); worker.current = null; controller.current = null; setBusy(false); setError("Recherche annulée ; les résultats précédents sont conservés."); };
  const launch = async () => {
    if (busy || !config) return;
    setError("");
    if (!Object.values(costs).every(v => Number.isFinite(v) && v >= 0 && v <= 1000)) { setError("Coûts finis requis entre 0 et 1 000 $/oz."); return; }
    const startTime = source === "MT5" && mt5History ? Date.parse(mt5History.coverage.requestedStart) : Date.parse(`${start}T00:00:00Z`);
    const endTime = source === "MT5" && mt5History ? Date.parse(mt5History.coverage.requestedEnd) : Date.parse(`${end}T00:00:00Z`) + 86400000;
    if (source === "MT5" && !mt5History) { setError("Chargez les données MT5 XAUUSD-ECN M1. Aucun repli automatique vers Twelve Data."); return; }
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime || endTime > Date.now()) { setError("Choisissez une période UTC passée valide."); return; }
    const warmup = scalpingWarmup(config.setup);
    if (source === "TWELVE_DATA" && (endTime - startTime) / 60000 + warmup > 5000) { setError("Twelve Data : plafond existant de 5 000 bougies, préchauffage inclus. Réduisez la période. Aucune pagination ni donnée fictive."); return; }
    const request = new AbortController(); controller.current = request;
    const snapshot = structuredClone(config);
    setBusy(true); setPercent(0); setStage("Vérification des données réelles");
    try {
      const settings: BacktestSettings = { ...costs, initialCapital: 300, timeframe: "1m", start: startTime, end: endTime };
      await reserveScalpingRun("optimization", source, settings, snapshot);
      if (request.signal.aborted) return;
      let history: ScalpingHistory;
      if (source === "MT5") history = validateMT5ScalpingHistory(mt5History, { ...snapshot, timeframe: "1m" }, settings);
      else {
        const query = new URLSearchParams({ timeframe: "1m", start: String(startTime), end: String(endTime), warmup: String(warmup) });
        const response = await fetch(`/api/backtest-history?${query}`, { signal: request.signal, cache: "no-store" });
        const body: unknown = await response.json();
        if (!response.ok) {
          const failure = z.object({ message: z.string().optional(), statusMessage: z.string().optional() }).safeParse(body);
          throw new Error(failure.success ? failure.data.statusMessage || failure.data.message || "Twelve Data indisponible." : "Twelve Data indisponible.");
        }
        history = twelveSchema.parse(body) as HistoricalData;
      }
      if (request.signal.aborted) return;
      const instance = new Worker(new URL("../../lib/scalping/optimization.worker.ts", import.meta.url), { type: "module" });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<{ type: string; percent?: number; stage?: string; result?: OptimizationReport; message?: string }>) => {
        if (worker.current !== instance) return;
        const message = event.data;
        if (message.type === "progress") { setPercent(message.percent ?? 0); setStage(message.stage ?? ""); return; }
        instance.terminate(); worker.current = null; controller.current = null; setBusy(false);
        if (message.type === "result" && message.result) { completedReports.push(message.result); setReport(message.result); setPercent(100); }
        else setError(message.message || "Recherche impossible ; aucun résultat inventé.");
      };
      instance.onerror = () => { instance.terminate(); worker.current = null; controller.current = null; setBusy(false); setError("Erreur du calcul d’optimisation. Les résultats précédents sont conservés."); };
      instance.postMessage({ config: snapshot, history, settings: { ...costs, initialCapital: 300, timeframe: "1m", start: startTime, end: endTime } });
    } catch (e) {
      if (request.signal.aborted) return;
      controller.current = null; worker.current?.terminate(); worker.current = null; setBusy(false);
      setError(e instanceof Error ? e.message : "Données réelles indisponibles.");
    }
  };
  return <section className="space-y-5 rounded-2xl border border-primary/30 bg-card p-4 sm:p-6">
    <h2 className="text-lg font-bold">Optimisation automatique · BACKTEST uniquement</h2>
    <p className="text-sm text-muted-foreground">Capital fixe 300 $. Recherche dédupliquée sous plafonds prudents, puis contrôle interne sur les 30 % restants. Non validé sur données indépendantes. Les périodes déjà optimisées sont bloquées, même après un changement de paramètres ; aucun calcul automatique.</p>
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 disabled:opacity-60">
      <Field label="Source unique"><select className={selectClass} value={source} onChange={e => setSource(e.target.value as typeof source)}><option value="MT5">MT5 XAUUSD-ECN M1</option><option value="TWELVE_DATA">Twelve Data · uniquement si disponible</option></select></Field>
      {source === "TWELVE_DATA" && <><Field label="Début UTC"><input type="date" value={start} onChange={e => setStart(e.target.value)} className={selectClass} /></Field><Field label="Fin incluse UTC"><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={selectClass} /></Field></>}
      {([['spread', 'Spread ($/oz)'], ['slippage', 'Slippage ($/oz/sens)'], ['commission', 'Commission ($/oz/sens)']] as const).map(([key, label]) => <NumberField key={key} label={label} value={costs[key]} min={0} step={0.01} onChange={v => setCosts(c => ({ ...c, [key]: v }))} />)}
    </fieldset>
    {source === "MT5" && <p className="text-xs text-muted-foreground">{mt5History ? `${mt5History.symbol} · ${mt5History.candles.length} bougies chargées · ${mt5History.coverage.requestedStart} → ${mt5History.coverage.requestedEnd}` : "Aucun historique MT5 en mémoire. Chargez-le dans l’onglet Backtest."} Aucun nouvel appel MT5, aucune interpolation, aucun mélange de sources.</p>}
    <div className="flex flex-wrap gap-3"><Button className="min-h-11 rounded-xl" disabled={busy || !config} onClick={() => void launch()}><WandSparkles className="mr-2 h-4 w-4" />Optimiser automatiquement la stratégie</Button>{busy && <Button variant="outline" className="min-h-11 rounded-xl" onClick={cancel}>Annuler</Button>}</div>
    {busy && <div role="status" className="space-y-2"><p className="text-xs">{stage} · {percent} %</p><Progress value={percent} className="h-2 rounded-full [&>div]:bg-primary" /></div>}
    {error && <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm">{error}</p>}
    <p className="text-xs text-muted-foreground">Les coûts sont des hypothèses, pas un spread historique mesuré. Une période de quelques jours ne suffit pas à valider la stabilité ; le plafond actuel de chargement n’est pas augmenté et aucun historique n’est supprimé. Les nouveaux rapports restent en mémoire pendant la session.</p>
    {report && <OptimizationResults report={report} onApply={onApply} disabled={busy} />}
  </section>;
}
