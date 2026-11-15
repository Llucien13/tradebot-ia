import { uiDateTime } from "@/lib/ui-presentation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Play, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { BacktestResults } from "@/components/backtest/BacktestResults";
import { Field, NumberField, Section, actionClass, selectClass } from "@/components/strategy/StrategyFields";
import { INTERVAL_MS, type BacktestSettings, type HistoricalData } from "@/lib/backtest/types";
import type { ScalpingConfig, ScalpingResult } from "@/lib/scalping/model";
import { ScalpingAudit } from "./ScalpingAudit";
import { ScalpingDataProvenance } from "./ScalpingDataProvenance";
import { mt5FrenchUTC, frenchDateToISO, type MT5History } from "@/lib/mt5-data";
import { validateMT5ScalpingHistory, type ScalpingHistory, type ScalpingMT5History } from "@/lib/scalping/history";

import { scalpingWarmup } from "@/lib/scalping/signals";
import { reserveScalpingRun } from "@/lib/scalping/evidence";

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const candleSchema = z.object({ time: z.number().finite(), open: z.number().finite().positive(), high: z.number().finite().positive(), low: z.number().finite().positive(), close: z.number().finite().positive(), volume: z.number().finite().nonnegative() });
const historySchema = z.object({ source: z.literal("TWELVE_DATA"), fetchedAt: z.string().datetime(), cached: z.boolean(), warnings: z.array(z.string()), candles: z.array(candleSchema).min(2).max(5000) });
const costsSchema = z.object({ initialCapital: z.number().finite().positive().max(1e12), spread: z.number().finite().min(0).max(1000), slippage: z.number().finite().min(0).max(1000), commission: z.number().finite().min(0).max(1000) });

export function ScalpingBacktest({ config, mt5History, onResult }: { config: ScalpingConfig | null; mt5History: MT5History | null; onResult: (result: ScalpingResult) => void }) {
  const [source, setSource] = useState<"TWELVE_DATA" | "MT5">("MT5");
  useEffect(() => { if (mt5History) setSource("MT5"); }, [mt5History]);
  const today = Date.parse(`${iso(Date.now())}T00:00:00Z`);
  const frenchDay = (time: number) => new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(time));
  const [startDate, setStart] = useState(frenchDay(today - DAY));
  const [endDate, setEnd] = useState(frenchDay(today - DAY));
  const [costs, setCosts] = useState({ initialCapital: 300, spread: 0.3, slippage: 0.05, commission: 0 });
  const [busy, setBusy] = useState(false), [percent, setPercent] = useState(0), [error, setError] = useState("");
  const [result, setResult] = useState<ScalpingResult | null>(null);
  const worker = useRef<Worker | null>(null), request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); worker.current?.terminate(); }, []);
  const cancel = () => { request.current?.abort(); worker.current?.terminate(); request.current = null; worker.current = null; setBusy(false); setError("Backtest scalping annulé. Aucun résultat de remplacement."); };
  const launch = async () => {
    if (request.current || worker.current) return;
    setError("");
    if (!config?.enabled) { setError("Activez et enregistrez explicitement le module avant de lancer son backtest."); return; }
    const validated = costsSchema.safeParse(costs);
    if (source === "MT5" && !mt5History) { setError("Données MT5 non chargées : chargez XAUUSD-ECN M1 dans le panneau ci-dessus. Aucun repli vers Twelve Data."); return; }
    const startISO = frenchDateToISO(startDate), endISO = frenchDateToISO(endDate);
    const start = source === "MT5" ? Date.parse(mt5History!.coverage.requestedStart) : startISO ? Date.parse(`${startISO}T00:00:00Z`) : NaN;
    const end = source === "MT5" ? Date.parse(mt5History!.coverage.requestedEnd) : endISO ? Date.parse(`${endISO}T00:00:00Z`) + DAY : NaN;
    if (!validated.success) { setError("Capital positif requis ; coûts simulés finis entre 0 et 1 000 $/oz."); return; }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end > Date.now()) { setError("Choisissez des dates JJ/MM/AAAA valides et des journées UTC passées, fin incluse et aujourd’hui exclu."); return; }
    const warmup = scalpingWarmup(config.setup);
    if (source === "TWELVE_DATA" && Math.ceil((end - start) / INTERVAL_MS[config.timeframe]) + warmup > 5000) { setError("Plafond de 5 000 bougies, préchauffage inclus. Réduisez la période (1 à 3 jours en 1m) ou augmentez le timeframe. Aucun historique fictif ni pagination automatique."); return; }
    const settings: BacktestSettings = { ...costs, start, end, timeframe: config.timeframe };
    const snapshot = structuredClone(config);
    let loadedMT5: ScalpingMT5History | null = null;
    if (source === "MT5") {
      try { loadedMT5 = validateMT5ScalpingHistory(mt5History, snapshot, settings); }
      catch (e) { setError(e instanceof Error ? e.message : "Historique MT5 insuffisant. Aucun repli Twelve Data."); return; }
    }
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setPercent(0);
    try {
      await reserveScalpingRun("backtest-scalping", source, settings, snapshot);
      if (controller.signal.aborted) return;
      let history: ScalpingHistory;
      if (source === "MT5") {
        history = loadedMT5!;
      } else {
        const query = new URLSearchParams({ timeframe: snapshot.timeframe, start: String(start), end: String(end), warmup: String(warmup) });
        const response = await fetch(`/api/backtest-history?${query}`, { signal: controller.signal, cache: "no-store" });
        let body: unknown;
        try { body = await response.json(); } catch { throw new Error("Réponse historique non JSON : aucun résultat scalping calculé."); }
        if (!response.ok) {
          const failure = z.object({ statusMessage: z.string().optional(), message: z.string().optional() }).safeParse(body);
          throw new Error(failure.success ? failure.data.statusMessage || failure.data.message || "Historique réel indisponible." : "Historique réel indisponible.");
        }
        const parsedHistory = historySchema.safeParse(body);
        if (!parsedHistory.success) throw new Error("Historique scalping invalide. Aucune donnée DEMO n’est acceptée.");
        history = parsedHistory.data as HistoricalData;
      }
      if (controller.signal.aborted) return;
      setPercent(10);
      const instance = new Worker(new URL("../../lib/scalping/scalping.worker.ts", import.meta.url), { type: "module" });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<{ type: string; percent?: number; result?: ScalpingResult; message?: string }>) => {
        if (worker.current !== instance) return;
        const message = event.data;
        if (message.type === "progress") setPercent(10 + Math.round(0.9 * (message.percent ?? 0)));
        else {
          instance.terminate(); worker.current = null; request.current = null; setBusy(false);
          if (message.type === "result" && message.result) { setResult(message.result); onResult(message.result); setPercent(100); }
          else setError(message.message || "Le moteur scalping a échoué.");
        }
      };
      instance.onerror = () => { instance.terminate(); worker.current = null; request.current = null; setBusy(false); setError("Le worker scalping a échoué. Aucun nouveau résultat généré."); };
      instance.postMessage({ config: snapshot, settings, history });
    } catch (e) {
      if (controller.signal.aborted) return;
      worker.current?.terminate(); worker.current = null; request.current = null; setBusy(false);
      setError(e instanceof Error ? e.message : "Backtest scalping impossible.");
    }
  };
  return <div className="space-y-5 border-t border-primary/25 pt-6">
    <Section title="Backtest indépendant · Mode Scalping" description="Cette simulation ne lance pas la stratégie H1 et n’importe ni ses positions ni ses résultats. Version scalping enregistrée uniquement ; capital et coûts propres à ce test, en USD.">
      <form noValidate onSubmit={e => { e.preventDefault(); void launch(); }} className="space-y-4">
        <p className="text-sm">Timeframe enregistré : <span className="font-mono text-primary">{config?.timeframe ?? "—"}</span> · {config?.enabled ? "Module activé pour ce test manuel" : "Module désactivé"}</p>
        <Field label="Source de données du backtest Scalping"><select disabled={busy} className={selectClass} value={source} onChange={e => { setSource(e.target.value as "TWELVE_DATA" | "MT5"); setError(""); }}><option value="TWELVE_DATA">Twelve Data · uniquement si disponible</option><option value="MT5">MT5 XAUUSD-ECN M1 · bougies chargées</option></select></Field>
        {source === "MT5" && <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">{mt5History ? <>Données chargées : <strong>{mt5History.symbol}</strong> · M1 · {mt5History.candles.length.toLocaleString("fr-FR")} bougies dont {mt5History.coverage.warmupCount} de préchauffage.<br />Période demandée : {mt5FrenchUTC(mt5History.coverage.requestedStart)} → {mt5FrenchUTC(mt5History.coverage.requestedEnd)} (fin exclusive).</> : "Aucune donnée MT5 chargée. Chargez XAUUSD-ECN M1 dans le panneau ci-dessus avant de lancer le test."}<p className="mt-2 text-xs text-muted-foreground">Le test utilise exactement la plage chargée. Aucun nouvel appel de données, aucun repli Twelve Data, aucune interpolation. Le timeframe enregistré doit être 1m ; il ne sera pas changé automatiquement.</p></div>}
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 disabled:opacity-60">
          {source === "TWELVE_DATA" && <><Field label="Début du test UTC · JJ/MM/AAAA"><Input type="text" inputMode="numeric" placeholder="JJ/MM/AAAA" className="h-11 rounded-xl bg-background" value={startDate} onChange={e => setStart(e.target.value)} /></Field><Field label="Fin incluse UTC · JJ/MM/AAAA"><Input type="text" inputMode="numeric" placeholder="JJ/MM/AAAA" className="h-11 rounded-xl bg-background" value={endDate} onChange={e => setEnd(e.target.value)} /></Field></>}
          <Field label="Capital de référence ($)"><Input value="300" readOnly className="h-11 rounded-xl bg-background" /></Field>
          {([ ["spread", "Spread ($/oz)"], ["slippage", "Slippage ($/oz/sens)"], ["commission", "Commission ($/oz/sens)"] ] as const).map(([key, label]) => <NumberField key={key} label={label} value={costs[key]} min={0} step={0.01} onChange={value => setCosts(c => ({ ...c, [key]: value }))} />)}
        </fieldset>
        <div className="flex flex-wrap gap-3"><Button disabled={busy || !config?.enabled || (source === "MT5" && !mt5History)} type="submit" className={`${actionClass} bg-primary text-primary-foreground hover:bg-primary/90`}><Play className="mr-2 h-4 w-4" />{busy ? "Simulation scalping en cours…" : "Lancer un nouveau test manuel"}</Button>{busy && <Button type="button" variant="outline" className={actionClass} onClick={cancel}>Annuler</Button>}</div>
        {busy && <div role="status" className="space-y-2"><p className="text-xs text-muted-foreground">{percent < 10 ? "Vérification de l’historique réel…" : `Calcul scalping : ${percent} %`}</p><Progress value={percent} className="h-2 rounded-full bg-secondary [&>div]:bg-primary" /></div>}
        {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}{result && " Le résultat précédent ci-dessous est conservé et reste associé à son ancien instantané."}</p>}
      </form>
    </Section>
    <details className="rounded-2xl border border-border p-4"><summary className="cursor-pointer text-sm text-primary">Détails · règles d’exécution et limites</summary><div className="mt-4">
    <Section title="Règles d’exécution & limites du scalping">
      <ul className="list-disc space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">
        <li>Signal calculé après clôture ; salve à l’ouverture suivante, jamais sans signal valide. Délai vérifié à l’entrée. Les signaux refusés ne sont pas mis en réserve ; aucune entrée lors d’une lacune après la bougie de signal. Pas de filtre H1, de break-even ou de trailing importé : chaque position garde ici ses SL/TP fixes.</li>
        <li>Budget de salve = pourcentage du moindre du capital comptabilisé et de l’equity nette à l’ouverture, plafonné par la perte quotidienne encore disponible. Nombre = minimum du maximum configuré et de ceil(budget / perte individuelle). Risque unitaire = minimum de la perte individuelle et du budget / nombre. Volume = risque unitaire / (distance de stop + slippage de sortie + commissions aller-retour). Aucun minimum de lot, levier ou marge broker modélisé ; le volume est en onces fractionnaires.</li>
        <li>Objectif individuel en PnL net : maximum de l’objectif configuré et du risque unitaire × ratio gain/risque. Le TP compense les commissions et le slippage de sortie ; le spread est inclus dans les prix exécutés. SL prioritaire si SL et TP sont touchés dans la même bougie. Les gaps peuvent dépasser la perte individuelle et quotidienne ; ces montants ne sont pas des garanties de perte maximale.</li>
        <li>Journées UTC : base = dernière equity nette de la journée précédente (capital initial pour la première). Les gaps après un changement de jour sont imputés à la nouvelle journée. Les périodes sans bougie ne sont pas interpolées. Les sorties intrabougie sont horodatées à la fin de leur bougie moins 1 ms pour les rattacher à sa journée UTC.</li>
        <li>Coupe-circuit quotidien sur réalisé + latent net : contrôles avant toute entrée à l’ouverture, puis sur les valorisations de la bougie. Pour la perte, une borne adverse intrabougie, limitée par les stops hors gaps, déclenche un blocage conservateur. Avec des positions opposées, leurs extrêmes OHLC peuvent ne pas être simultanés : un blocage anticipé est donc possible. Pour le gain, seules les valorisations à l’ouverture et à la clôture sont retenues, pas un gain intrabougie supposé.</li>
        <li>Une limite quotidienne atteinte bloque les nouvelles entrées jusqu’au jour UTC suivant, même si le PnL se redresse. Les positions ouvertes continuent leurs sorties individuelles. Le compteur de salves repart à zéro chaque jour ; le délai entre salves n’est pas réinitialisé. Une seule salve ouverte à la fois, sans empilement de risque. Un signal n’est pas reporté à travers une lacune de données.</li>
        <li>Simulation sur OHLC, sans suivi tick par tick : impossible de garantir l’instant exact où une limite est franchie. Toutes les positions restantes sont liquidées en fin de période. Twelve Data conserve son endpoint et ses protections de quota. Avec MT5, seules les bougies XAUUSD-ECN M1 déjà chargées sont utilisées ; aucune donnée inventée ni repli de source.</li>
      </ul>
    </Section></div></details>
    {result ? <div className="space-y-5"><p className="rounded-xl border border-primary/25 bg-card p-4 text-sm">Résultat scalping indépendant · instantané enregistré lors du lancement. Les modifications ultérieures du module ne recalculent ni ne remplacent ce résultat.</p><BacktestResults key={`${result.history.fetchedAt}:${result.settings.start}:trades`} result={result} showStrategyConfiguration={false} formatTime={uiDateTime} instrumentLabel={result.history.source === "MT5" ? result.history.symbol : "XAU/USD"} /><details className="rounded-2xl border border-border p-4"><summary className="cursor-pointer text-sm text-primary">Détails · provenance et audit Scalping</summary><div className="mt-4 space-y-5"><ScalpingDataProvenance result={result} /><ScalpingAudit key={`${result.history.fetchedAt}:${result.settings.start}`} result={result} /></div></details></div> : <p className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"><FlaskConical className="h-5 w-5 text-primary" />Aucun résultat scalping calculé. L’activation seule ne lance aucun test.</p>}
  </div>;
}
