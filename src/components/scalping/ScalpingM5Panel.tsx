import { useEffect, useRef, useState } from "react";
import { Save, Play, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { NumberField, Section, Toggle, actionClass } from "@/components/strategy/StrategyFields";
import { BacktestResults } from "@/components/backtest/BacktestResults";
import { BacktestHistory, SaveBacktest } from "@/components/backtest/BacktestHistory";
import { MT5DataSourcePanel } from "./MT5DataSourcePanel";
import { M5SavedHistory } from "./M5SavedHistory";
import { M5GapAudit } from "./M5GapAudit";
import { M5CalendarFields } from "./M5CalendarFields";
import { validateM5Calendar, calendarPolicy, type M5Calendar } from "@/lib/scalping/m5-calendar";
import { useMT5DataSession } from "@/lib/mt5-data-session";
import { loadM5, M5_KEY, m5Schema, m5ScalpingConfig, type M5Config, type M5Result } from "@/lib/scalping/m5-model";
import { M5_ENGINE_LABELS, type M5EngineVersion } from "@/lib/scalping/m5-sessions";
import { validateM5History } from "@/lib/scalping/m5-engine";
import { reserveScalpingRun } from "@/lib/scalping/evidence";
import { mt5FrenchUTC } from "@/lib/mt5-data";
import { uiDateTime } from "@/lib/ui-presentation";

const costsSchema = z.object({ initialCapital: z.number().finite().positive().max(1e12), spread: z.number().finite().nonnegative().max(1000), slippage: z.number().finite().nonnegative().max(1000), commission: z.number().finite().nonnegative().max(1000) });
export function ScalpingM5Panel() {
  const { history } = useMT5DataSession("M5");
  const [initial] = useState(loadM5);
  const [draft, setDraft] = useState(() => {
    if (localStorage.getItem(M5_KEY)) return initial.config;
    return { ...initial.config, enabled: true, trendM15: true, emaDistanceFilter: true, emaDistanceThreshold: 1.5 };
  });
  const [saved, setSaved] = useState<M5Config | null>(initial.error || !localStorage.getItem(M5_KEY) ? null : initial.config);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(initial.error);
  const [costs, setCosts] = useState(() => {
    try { const value = localStorage.getItem("tradebot.scalping.m5.costs.v1"); return value ? costsSchema.parse(JSON.parse(value)) : { initialCapital: 300, spread: 0.3, slippage: 0.05, commission: 0 }; }
    catch { return { initialCapital: 300, spread: 0.3, slippage: 0.05, commission: 0 }; }
  });
  const [savedCosts, setSavedCosts] = useState<string | null>(() => localStorage.getItem("tradebot.scalping.m5.costs.v1"));
  const [busy, setBusy] = useState(false), [percent, setPercent] = useState(0);
  const [engineVersion, setEngineVersion] = useState<M5EngineVersion>("m5-session-continuity-2");
  const [calendar, setCalendar] = useState<M5Calendar | null>(null);
  const [result, setResult] = useState<M5Result | null>(null);
  const worker = useRef<Worker | null>(null), generation = useRef(0);
  useEffect(() => () => { generation.current++; worker.current?.terminate(); }, []);
  const dirty = !saved || JSON.stringify(draft) !== JSON.stringify(saved) || JSON.stringify(costs) !== savedCosts;
  const patch = (p: Partial<M5Config>) => { setDraft(c => ({ ...c, ...p })); setMessage(""); };
  const cancel = () => {
    generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false);
    setError("Test M5 annulé. Aucun nouveau résultat ; les historiques enregistrés restent intacts.");
  };
  const launch = async () => {
    if (busy) return;
    const id = ++generation.current;
    const runId = crypto.randomUUID();
    setError(""); setResult(null);
    try {
      if (dirty) throw new Error("Enregistrez les réglages M5 et les coûts avant le lancement.");
      if (!saved?.enabled) throw new Error("Activez et enregistrez explicitement le profil M5.");
      const lot = validateM5History(history);
      const validatedCosts = costsSchema.parse(costs);
      const settings = { ...validatedCosts, timeframe: "5m" as const, start: Date.parse(lot.coverage.requestedStart), end: Date.parse(lot.coverage.requestedEnd) };
      const snapshot = structuredClone(saved);
      const selectedEngine = engineVersion;
      const selectedCalendar = selectedEngine === "m5-session-continuity-2" ? validateM5Calendar(calendar, lot.symbol) : undefined;
      setBusy(true); setPercent(0);
      await reserveScalpingRun("backtest-scalping", "MT5", settings, selectedEngine === "m5-independent-1" ? m5ScalpingConfig(snapshot) : { ...m5ScalpingConfig(snapshot), engineVersion: selectedEngine, sessionPolicy: calendarPolicy(selectedCalendar!), ...(selectedCalendar?.kind === "xauusd-ecn-observed-utc" ? { calendar: selectedCalendar } : {}) });
      if (generation.current !== id) return;
      const instance = new Worker(new URL("../../lib/scalping/m5.worker.ts", import.meta.url), { type: "module" });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<{ type: string; runId?: string; percent?: number; result?: M5Result; message?: string }>) => {
        if (generation.current !== id) return;
        if (event.data.runId !== runId) {
          instance.terminate(); worker.current = null; setBusy(false);
          setError("Réponse M5 sans identifiant correspondant au lancement : résultat refusé."); return;
        }
        if (event.data.type === "progress") { setPercent(event.data.percent ?? 0); return; }
        instance.terminate(); worker.current = null; setBusy(false);
        if (event.data.type === "result" && event.data.result) {
          const computed = event.data.result;
          if (computed.engineVersion !== selectedEngine || computed.execution?.engineVersion !== selectedEngine || computed.execution?.runId !== runId || JSON.stringify(computed.calendar) !== JSON.stringify(selectedCalendar)) {
            setError("Version réellement exécutée différente de la sélection : résultat refusé."); return;
          }
          setResult(computed); setPercent(100);
        } else setError(event.data.message ?? "Le moteur M5 a échoué.");
      };
      instance.onerror = () => {
        if (generation.current !== id) return;
        instance.terminate(); worker.current = null; setBusy(false); setError("Le worker M5 a échoué. Aucun nouveau résultat.");
      };
      instance.postMessage({ config: snapshot, settings, history: lot, engineVersion: selectedEngine, runId, calendar: selectedCalendar, mode: "PAPER" });
    } catch (e) {
      if (generation.current !== id) return;
      worker.current?.terminate(); worker.current = null; setBusy(false);
      setError(e instanceof Error ? e.message : "Backtest M5 impossible.");
    }
  };
  return <section id="scalping-m5" className="space-y-5 rounded-3xl border border-primary/30 bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Profil indépendant · XAU/USD</p><h2 className="mt-1 text-2xl font-bold">Scalping M5</h2></div><span className="rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary">PAPER · aucun ordre réel</span></div>
    <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />EMA 20/50 et cassure de pivot confirmée à la clôture M5. SL fixe à 1,5 ATR(14), TP à 3 fois la distance du stop. Break-even et trailing désactivés. Aucun paramètre M1 ou H1 modifié.</p>
    <Section title="ÉTAPE 1 — DONNÉES HISTORIQUES" description="Source MT5 en lecture seule. M5 fixé ; aucun appel M1 ni lancement de backtest."><M5SavedHistory /><M5GapAudit calendar={engineVersion === "m5-session-continuity-2" ? calendar ?? undefined : undefined} /><MT5DataSourcePanel fixedTimeframe="M5" /></Section>
    <Section title="ÉTAPE 2 — RÉGLAGES" description="Profil M5 indépendant. Les profils déjà enregistrés restent inchangés.">
    <form noValidate className="space-y-4" onSubmit={e => {
      e.preventDefault();
      const parsed = m5Schema.safeParse(draft);
      if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join(" · ")); return; }
      try {
        const validatedCosts = costsSchema.parse(costs);
        localStorage.setItem(M5_KEY, JSON.stringify(parsed.data));
        localStorage.setItem("tradebot.scalping.m5.costs.v1", JSON.stringify(validatedCosts));
        setSavedCosts(JSON.stringify(validatedCosts)); setCosts(validatedCosts); setSaved(parsed.data); setDraft(parsed.data); setError("");
        setMessage("Profil M5 enregistré séparément. Aucun test, optimisation ou ordre lancé.");
      } catch { setError("Stockage indisponible : profil M5 non enregistré."); }
    }}>
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <NumberField label="Capital initial ($)" value={costs.initialCapital} min={0.01} step={1} onChange={initialCapital => setCosts(c => ({ ...c, initialCapital }))} />
        <Toggle label="Activer M5 pour ses backtests manuels" checked={draft.enabled} onChange={enabled => patch({ enabled })} />
        <NumberField label="Risque maximal par position (%)" value={draft.riskPercent} min={0.01} max={1} step={0.01} onChange={riskPercent => patch({ riskPercent })} hint="Une seule position M5 à la fois : risque total ouvert ≤ 1 % du capital à l’entrée. Les gaps peuvent dépasser le risque prévu." />
        <div className="space-y-4">
          <Toggle label="Confirmation de tendance M15" checked={draft.trendM15} onChange={trendM15 => patch({ trendM15 })} />
          {draft.trendM15 && <p className="text-xs text-muted-foreground">EMA 20/50 sur M15 reconstruit uniquement avec des triples M5 complets et clôturés. Aucune anticipation ; entrée refusée si la confirmation est indisponible.</p>}
          <Toggle label="Distance maximale à l’EMA20" checked={draft.emaDistanceFilter} onChange={emaDistanceFilter => patch({ emaDistanceFilter })} />
          {draft.emaDistanceFilter && <NumberField label="Seuil × ATR14 M5" value={draft.emaDistanceThreshold} min={0.1} step={0.1} onChange={emaDistanceThreshold => patch({ emaDistanceThreshold })} hint="Seuil initial : 1,5 × ATR14. Le signal est refusé si |clôture M5 − EMA20 M5| dépasse ce seuil, sur bougie clôturée uniquement." />}
          <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">Réglages avancés · filtres et coûts</summary><div className="mt-4 space-y-4">          <Toggle label="Filtre de volatilité ATR" checked={draft.volatility} onChange={volatility => patch({ volatility })} />
          {draft.volatility && <div className="grid gap-4 sm:grid-cols-2"><NumberField label="ATR / moyenne des 50 ATR précédents : minimum" value={draft.atrMinRatio} min={0.01} step={0.1} onChange={atrMinRatio => patch({ atrMinRatio })} /><NumberField label="Ratio ATR maximum" value={draft.atrMaxRatio} min={0.01} step={0.1} onChange={atrMaxRatio => patch({ atrMaxRatio })} /></div>}
          <Toggle label="Filtre de spread" checked={draft.spreadFilter} onChange={spreadFilter => patch({ spreadFilter })} />
          {draft.spreadFilter && <NumberField label="Spread maximum ($/oz)" value={draft.maxSpread} min={0} step={0.01} onChange={maxSpread => patch({ maxSpread })} hint="Comparé au spread simulé du test. Le lot OHLC ne fournit pas de spread historique tick par tick." />}
          <Toggle label="Filtre de session UTC" checked={draft.sessionFilter} onChange={sessionFilter => patch({ sessionFilter })} />
          {draft.sessionFilter && <div className="grid gap-4 sm:grid-cols-2"><NumberField label="Heure de début UTC (incluse)" value={draft.sessionStart} min={0} max={23} onChange={sessionStart => patch({ sessionStart })} /><NumberField label="Heure de fin UTC (exclue)" value={draft.sessionEnd} min={0} max={23} onChange={sessionEnd => patch({ sessionEnd })} hint="Une fin avant le début traverse minuit. Heures égales = 24 h." /></div>}
          <Toggle label="Pause après 3 pertes nettes consécutives" checked={draft.lossPause} onChange={lossPause => patch({ lossPause })} />
          {draft.lossPause && <NumberField label="Durée de pause (minutes)" value={draft.pauseMinutes} min={1} max={10080} onChange={pauseMinutes => patch({ pauseMinutes })} />}

          <div className="grid gap-4 sm:grid-cols-3">{([ ["spread", "Spread simulé ($/oz)"], ["slippage", "Slippage ($/oz/sens)"], ["commission", "Commission ($/oz/sens)"] ] as const).map(([key,label]) => <NumberField key={key} label={label} value={costs[key]} min={0} step={0.01} onChange={value => setCosts(c => ({ ...c, [key]: value }))} />)}</div>
          </div></details>
        </div>
        <Button type="submit" className={`${actionClass} min-h-12 bg-primary text-primary-foreground`}><Save className="mr-2 h-4 w-4" />Enregistrer les réglages M5</Button>
        <p className="text-xs text-muted-foreground">{dirty ? "Réglages non enregistrés : lancement bloqué." : "Réglages M5 enregistrés. Aucun lancement automatique."}</p>
      </fieldset>
    </form>
    </Section>
    {message && <p role="status" className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">{message}</p>}
    <Section title="ÉTAPE 3 — BACKTEST" description="Vérifiez la période et les filtres enregistrés. Lancement exclusivement sur clic.">
      <label className="block space-y-2 text-sm font-semibold">Version du moteur · PAPER uniquement<select disabled={busy} value={engineVersion} onChange={e => { setEngineVersion(e.target.value as M5EngineVersion); setResult(null); setError(""); setPercent(0); }} className="h-12 w-full rounded-xl border border-input bg-background px-3">{Object.entries(M5_ENGINE_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {engineVersion === "m5-session-continuity-2" && <M5CalendarFields disabled={busy} value={calendar} onChange={value => { setCalendar(value); setResult(null); setError(""); }} />}
      <p className="rounded-xl border border-border bg-background/40 p-3 text-sm">{history ? <>{history.symbol} · {history.interval} · {history.candles.length.toLocaleString("fr-FR")} bougies<br />{mt5FrenchUTC(history.coverage.requestedStart)} → {mt5FrenchUTC(history.coverage.requestedEnd)} (fin exclusive)</> : "Aucun lot MT5 chargé."}</p>
      <p className="text-sm">Capital : {costs.initialCapital} $ · risque : {saved?.riskPercent ?? draft.riskPercent} % · confirmation M15 : {saved?.trendM15 ? "Oui" : "Non"} · distance EMA20 : {saved?.emaDistanceFilter ? `${saved.emaDistanceThreshold} ATR14` : "Désactivée"}. SL 1,5 ATR14 · TP 3R.</p>
      <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs">Tous les paramètres du lancement</summary><pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify({profil:saved,couts:costs,moteur:engineVersion,calendrier:calendar},null,2)}</pre></details>
      <p className="text-xs leading-relaxed text-muted-foreground">Risque dimensionné avec slippage et commissions au stop, hors gaps. TP 3R en distance de prix : le résultat net peut être inférieur à 3R après coûts. SL prioritaire si SL et TP sont touchés dans la même bougie. Profil non validé ; aucune optimisation disponible ici.</p>
      <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy || dirty || (engineVersion === "m5-session-continuity-2" && !calendar) || !saved?.enabled || history?.interval !== "5m" || history?.apiTimeframe !== "TIMEFRAME_M5"} onClick={() => void launch()} className={`${actionClass} bg-primary text-primary-foreground`}><Play className="mr-2 h-4 w-4" />Lancer le backtest M5</Button>{busy && <Button type="button" variant="outline" className={actionClass} onClick={cancel}>Annuler</Button>}</div>
      {busy && <div role="status" className="space-y-2"><p className="text-xs">Calcul M5 : {percent} %</p><Progress value={percent} className="h-2 rounded-full bg-secondary [&>div]:bg-primary" /></div>}
    </Section>
    {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}
    <Section title="ÉTAPE 4 — RÉSULTATS" description="Résultats figés ; aucun ancien test relancé. Vert : gains. Rouge : pertes.">
    {!result && <p className="text-sm text-muted-foreground">Aucun résultat de nouveau calcul disponible. Les anciens résultats enregistrés restent consultables ci-dessous, séparément.</p>}
    {result && <div className="space-y-3"><div className="rounded-xl border border-primary/30 bg-primary/5 p-4"><p className="text-base font-bold text-primary">Moteur réellement exécuté : {result.execution?.engineVersion === "m5-session-continuity-2" ? "V2" : result.execution?.engineVersion === "m5-independent-1" ? "V1" : "Non vérifié"}</p><p className="mt-1 text-xs">{M5_ENGINE_LABELS[result.engineVersion as M5EngineVersion] ?? result.engineVersion}</p>{result.execution && <p className="mt-2 break-all text-xs text-muted-foreground">Exécution : {result.execution.runId}<br />Terminée : {uiDateTime(Date.parse(result.execution.completedAt))} · période {uiDateTime(result.settings.start)} → {uiDateTime(result.settings.end)}</p>}</div>
      {result.calendar && <div className="rounded-xl border border-primary/30 p-3 text-xs"><p className="font-semibold">Calendrier réellement utilisé : {result.calendar.kind === "xauusd-ecn-observed-utc" ? "XAUUSD-ECN · UTC observé (non officiel)" : "Gold New York · référence"}</p><pre className="mt-2 overflow-auto">{JSON.stringify(result.calendar, null, 2)}</pre></div>}
      {result.eligibility && <div className="rounded-xl border border-border p-4 text-sm"><div className="grid gap-3 sm:grid-cols-2"><p>Bougies réellement éligibles aux signaux : <strong>{result.eligibility.eligible.toLocaleString("fr-FR")}</strong></p><p>Bougies ignorées pour préchauffage dans la période : <strong>{result.eligibility.ignoredWarmup.toLocaleString("fr-FR")}</strong></p><p>Historique initial avant la période : <strong>{result.eligibility.initialHistory.toLocaleString("fr-FR")}</strong></p><p>Interruptions normales reconnues dans la période : <strong>{result.eligibility.normalClosures}</strong></p><p>Anomalies dans la période : <strong>{result.eligibility.anomalies}</strong></p><p>Confirmation M15 indisponible : <strong>{result.eligibility.unavailableM15}</strong></p></div><p className="mt-3 text-xs text-muted-foreground">Sur {result.eligibility.tested.toLocaleString("fr-FR")} bougies testées : indicateurs M5 indisponibles {result.eligibility.unavailableIndicators}, dernière bougie sans entrée suivante {result.eligibility.noNextBar}. Éligible = préchauffage terminé et indicateurs M5/M15 disponibles, avant cassure de pivot et filtres directionnels, session, spread, distance et volatilité. Cela ne signifie pas un trade.</p></div>}
      {result.gapAudit && <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm">Audit des interruptions M5 · historique complet, préchauffage inclus</summary><p className="mt-3 text-xs">Fermetures reconnues : {result.gapAudit.normalClosures} · anomalies : {result.gapAudit.anomalies} · entrées en attente annulées : {result.gapAudit.discardedPending}</p><p className="mt-2 text-xs">{result.gapAudit.pivots}. {result.gapAudit.pending}.</p></details>}
      <SaveBacktest result={result} /><p className="text-xs text-muted-foreground">Résultat M5 figé avec son profil et ses filtres au lancement. Modifier les réglages ne relance pas le test.</p>
          {(() => {
            const profile = result.scalping.m5Profile;
            const active = [
              `Distance maximale à l’EMA20 : ${profile.emaDistanceFilter ? "Activé" : "Désactivé"} · seuil ${profile.emaDistanceThreshold.toLocaleString("fr-FR")} × ATR14 M5`,
              ...(profile.trendM15 ? ["Confirmation tendance M15 : Activé"] : []),
              ...(profile.volatility ? [`Filtre volatilité ATR : Activé (${profile.atrMinRatio}–${profile.atrMaxRatio} × moyenne)`] : []),
              ...(profile.spreadFilter ? [`Filtre spread : Activé (max ${profile.maxSpread} $/oz)`] : []),
              ...(profile.sessionFilter ? [`Filtre session : Activé (${String(profile.sessionStart).padStart(2, "0")}:00–${String(profile.sessionEnd).padStart(2, "0")}:00 UTC)`] : []),
              ...(profile.lossPause ? [`Pause après ${String(profile.pauseMinutes)} min : Activé (seuil 3 pertes)`] : []),
            ];
            return <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs"><p className="font-semibold text-primary mb-1">État des filtres au lancement</p><ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{active.map((s, i) => <li key={i}>{s}</li>)}</ul></div>;
          })()}
          <BacktestResults result={result} showStrategyConfiguration={false} formatTime={uiDateTime} instrumentLabel={result.history.source === "MT5" ? result.history.symbol : "XAU/USD"} /></div>}
    <BacktestHistory strategy="M5" compareM5 />
    </Section>
  </section>;
}
