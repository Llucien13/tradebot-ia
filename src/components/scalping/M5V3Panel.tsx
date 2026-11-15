import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Waves, Save, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { NumberField, Toggle, Section, actionClass } from "@/components/strategy/StrategyFields";
import { M5SavedHistory } from "./M5SavedHistory";
import { MT5DataSourcePanel } from "./MT5DataSourcePanel";
import { M5CalendarFields } from "./M5CalendarFields";
import { M5GapAudit } from "./M5GapAudit";
import { BacktestResults } from "@/components/backtest/BacktestResults";
import { BacktestHistory, SaveBacktest } from "@/components/backtest/BacktestHistory";
import { useMT5DataSession } from "@/lib/mt5-data-session";
import { validateM5History } from "@/lib/scalping/m5-engine";
import { validateM5Calendar, type M5Calendar } from "@/lib/scalping/m5-calendar";
import { v3ConfigSchema, v3BrokerSchema, V3_KEY, V3_VERSION, validateV3Plan, v3Fingerprint, type V3Config, type V3Broker, type V3Result, type V3Plan } from "@/lib/scalping/m5-v3-model";
import { reserveScalpingRun } from "@/lib/scalping/evidence";
import { readBacktestHistory } from "@/lib/backtest-history";
import { M5V3Comparison } from "./M5V3Comparison";
import { M5V3RunSummary } from "./M5V3RunSummary";
import { sliceV3Period } from "@/lib/scalping/m5-v3-period";

const daysToPlan = (dates: string[]): V3Plan => ({ developmentStart: Date.parse(`${dates[0]}T00:00:00Z`), developmentEnd: Date.parse(`${dates[1]}T00:00:00Z`), validationStart: Date.parse(`${dates[2]}T00:00:00Z`), validationEnd: Date.parse(`${dates[3]}T00:00:00Z`) });
export function M5V3Panel() {
  const { history } = useMT5DataSession("M5");
  const [config, setConfig] = useState<V3Config>(() => v3ConfigSchema.parse({}) as V3Config);
  const [calendar, setCalendar] = useState<M5Calendar | null>(null);
  const [broker, setBroker] = useState({ contractSize: 0, minLot: 0, maxLot: 0, lotStep: 0, marginPerLotUSD: 0, provenance: "", confirmed: false });
  const [dates, setDates] = useState(["2026-07-01", "2026-07-21", "2026-07-21", "2026-08-01"]), [phase, setPhase] = useState<"development" | "validation">("development");
  const [costs, setCosts] = useState({ spread: 0.3, slippage: 0.05, commission: 0 });
  const [profileSaved, setProfileSaved] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [percent, setPercent] = useState(0), [result, setResult] = useState<V3Result | null>(null);
  const worker = useRef<Worker | null>(null), generation = useRef(0);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(V3_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setConfig(v3ConfigSchema.parse(saved.config) as V3Config);
        const b = v3BrokerSchema.parse(saved.broker) as V3Broker;
        const cal = validateM5Calendar(saved.calendar, b.symbol);
        if (!saved.costs || ![saved.costs.spread, saved.costs.slippage, saved.costs.commission].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) throw new Error("Coûts V3 enregistrés absents ou invalides.");
        setBroker(b); setCalendar(cal); setCosts(saved.costs); setProfileSaved(true);
        setMessage("Profil V3 enregistré restauré : coûts, contraintes broker et calendrier conservés. Cliquez pour lancer la phase choisie.");
      }
    } catch { setError("Profil V3 incomplet ou invalide : calendrier, coûts et spécifications broker confirmées requis. Complétez les réglages avancés une fois ; le profil existant reste conservé."); }
    return () => { generation.current++; worker.current?.terminate(); };
  }, []);
  const invalidate = () => { setProfileSaved(false); setResult(null); };
  const freeze = async (persist = true) => {
    setError("");
    try {
      const p = v3ConfigSchema.parse(config) as V3Config;
      const original = validateM5History(history);
      const parsedBroker = v3BrokerSchema.safeParse({ ...broker, symbol: original.symbol, accountCurrency: "USD" });
      if (!parsedBroker.success) throw new Error("Contraintes broker manquantes ou invalides : contrat, lots min/max/pas, marge USD, provenance et confirmation requis dans les réglages avancés.");
      const b = parsedBroker.data as V3Broker;
      if (!calendar) throw new Error("Calendrier de cotation manquant : choisissez-le une fois et enregistrez le profil V3.");
      const cal = validateM5Calendar(calendar, original.symbol), plan = daysToPlan(dates);
      const lot = sliceV3Period(history, phase === "development" ? plan.developmentStart : plan.validationStart, phase === "development" ? plan.developmentEnd : plan.validationEnd, cal);
      const settings = { ...costs, initialCapital: 300, timeframe: "5m" as const, start: Date.parse(lot.coverage.requestedStart), end: Date.parse(lot.coverage.requestedEnd) };
      if (!Object.values(costs).every(n => Number.isFinite(n) && n >= 0)) throw new Error("Coûts finis et non négatifs requis.");
      validateV3Plan(plan, settings, phase);
      const fingerprint = await v3Fingerprint({ config: p, broker: b, calendar: cal, plan, costs });
      const locks: { start: number; end: number; fingerprint: string }[] = JSON.parse(localStorage.getItem("tradebot.scalping.m5.v3.validation-locks") ?? "[]");
      if (locks.some(lock => lock.start < plan.validationEnd && lock.end > plan.validationStart && lock.fingerprint !== fingerprint)) throw new Error("Période hors échantillon déjà réservée avec un autre profil : utilisez une nouvelle période de validation.");
      const records = (await readBacktestHistory()).records;
      const validation = records.filter(r => r.result.engineVersion === V3_VERSION).map(r => (r.result as unknown as V3Result).v3).filter(v => v?.phase === "validation" && v.plan.validationStart < plan.validationEnd && v.plan.validationEnd > plan.validationStart);
      if (validation.some(v => v.profileFingerprint !== fingerprint)) throw new Error("Cette période a déjà été utilisée hors échantillon avec un autre profil. Choisissez une nouvelle période de validation, pas une optimisation sur celle-ci.");
      if (phase === "validation" && !records.some(r => r.result.engineVersion === V3_VERSION && (r.result as unknown as V3Result).v3?.phase === "development" && (r.result as unknown as V3Result).v3?.profileFingerprint === fingerprint)) throw new Error("Validation bloquée : enregistrez d’abord un résultat de développement du même profil figé.");
      if (persist) { localStorage.setItem(V3_KEY, JSON.stringify({ config: p, broker: b, calendar: cal, dates, costs, fingerprint })); setProfileSaved(true); }
      const prepared = { config: p, broker: b, calendar: cal, plan, costs: { ...costs }, fingerprint };
      if (persist) setMessage("Profil V3 enregistré. Le bouton principal réutilisera ces paramètres sans nouvelle saisie.");
      return prepared;
    } catch (e) { setError(e instanceof Error ? e.message : "Profil V3 invalide."); }
  };
  const launch = async () => {
    if (busy || worker.current) return;
    if (!profileSaved) { setError("Aucun profil V3 enregistré utilisable, ou modifications non enregistrées. Ouvrez les réglages avancés et enregistrez vos paramètres ; aucune valeur broker ne sera inventée."); return; }
    const id = ++generation.current, runId = crypto.randomUUID();
    setBusy(true); setPercent(0); setResult(null); setError("");
    try {
      const frozen = await freeze(false);
      if (generation.current !== id) return;
      if (!frozen) { setBusy(false); return; }
      const lot = sliceV3Period(history, phase === "development" ? frozen.plan.developmentStart : frozen.plan.validationStart, phase === "development" ? frozen.plan.developmentEnd : frozen.plan.validationEnd, frozen.calendar);
      if (lot.symbol !== frozen.broker.symbol) throw new Error("Le symbole a changé : reconfirmez le profil.");
      const settings = { ...frozen.costs, initialCapital: 300, timeframe: "5m" as const, start: Date.parse(lot.coverage.requestedStart), end: Date.parse(lot.coverage.requestedEnd) };
      validateV3Plan(frozen.plan, settings, phase);
      await reserveScalpingRun("backtest-scalping", "MT5", settings, { engineVersion: V3_VERSION, ...frozen, phase, dataFingerprint: await v3Fingerprint(lot.candles) });
      if (generation.current !== id) return;
      if (phase === "validation") {
        const key = "tradebot.scalping.m5.v3.validation-locks";
        const locks = JSON.parse(localStorage.getItem(key) ?? "[]");
        locks.push({ start: frozen.plan.validationStart, end: frozen.plan.validationEnd, fingerprint: frozen.fingerprint });
        localStorage.setItem(key, JSON.stringify(locks));
      }
      const instance = new Worker(new URL("../../lib/scalping/m5-v3.worker.ts", import.meta.url), { type: "module" }); worker.current = instance;
      instance.onmessage = event => {
        if (generation.current !== id) return;
        if (event.data.runId !== runId) { instance.terminate(); worker.current = null; setBusy(false); setError("Réponse V3 non corrélée : refusée."); return; }
        if (event.data.type === "progress") { setPercent(event.data.percent); return; }
        instance.terminate(); worker.current = null; setBusy(false);
        if (event.data.type === "result" && event.data.result?.execution?.runId === runId && event.data.result?.execution?.engineVersion === V3_VERSION && event.data.result?.v3?.profileFingerprint === frozen.fingerprint) { setResult(event.data.result); setPercent(100); }
        else setError(event.data.message ?? "Résultat V3 incompatible : refusé.");
      };
      instance.onerror = () => { if (generation.current !== id) return; instance.terminate(); worker.current = null; setBusy(false); setError("Worker V3 interrompu, aucun résultat remplacé."); };
      instance.postMessage({ mode: "PAPER", approved: true, runId, config: frozen.config, broker: frozen.broker, calendar: frozen.calendar, plan: frozen.plan, phase, settings, history: lot, profileFingerprint: frozen.fingerprint });
    } catch (e) { if (generation.current !== id) return; setBusy(false); setError(e instanceof Error ? e.message : "Lancement V3 impossible."); }
  };
  return <section className="space-y-5 rounded-3xl border border-primary/30 bg-card p-4 sm:p-6"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Price action · XAUUSD · moteur indépendant</p><h2 className="mt-2 flex items-center gap-2 text-2xl font-bold"><Waves className="h-7 w-7 text-primary" />M5 V3 — Rebond Price Action</h2></div><span className="h-fit rounded-full bg-primary/10 px-4 py-2 text-xs font-semibold text-primary">PAPER uniquement</span></div><p className="flex gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5 shrink-0 text-primary" />Zones confirmées + chandelier + structure M15 compatible. Aucune rentabilité garantie, aucun ordre réel, aucun ancien test relancé.</p>
    <Section title="Lancement rapide · juillet 2026" description="Capital 300 USD · risque enregistré ≤ 1 % · PAPER. Développement : 1–20 juillet inclus. Validation : 21–31 juillet inclus. Le clic est l’autorisation de lancer, aucun démarrage automatique."><label className="block space-y-2 text-sm font-semibold">Période<select disabled={busy} className="h-12 w-full rounded-xl border border-input bg-background px-3" value={phase} onChange={e => { setPhase(e.target.value as typeof phase); setResult(null); setError(""); }}><option value="development">Développement · 1 au 20 juillet 2026</option><option value="validation">Validation hors échantillon · 21 au 31 juillet 2026</option></select></label><Button disabled={busy} className={`${actionClass} min-h-14 w-full bg-primary text-primary-foreground sm:w-auto`} onClick={() => void launch()}><Play className="mr-2 h-5 w-5" />{busy ? "Calcul V3 en cours…" : "Lancer le backtest V3"}</Button><p className="text-xs text-muted-foreground">Paramètres enregistrés réutilisés. Préchauffage antérieur conservé ; aucune bougie future transmise. Validation : développement du même profil requis, réglages hors échantillon verrouillés.</p></Section>
    <details className="rounded-2xl border border-border p-4"><summary className="cursor-pointer font-semibold">Réglages avancés, données et audit · modifier seulement si nécessaire</summary>
    <Section title="1 · Historiques MT5 M5 existants"><M5SavedHistory /><MT5DataSourcePanel fixedTimeframe="M5" /><M5GapAudit calendar={calendar ?? undefined} />{history && <p className="text-xs">{history.symbol} · {history.coverage.requestedStart} → {history.coverage.requestedEnd} · {history.candles.length} bougies</p>}</Section>
    <fieldset disabled={busy} className="space-y-5 disabled:opacity-60"><Section title="2 · Zones, chandeliers et tendance" description="Deux réactions minimum. Corps strictement positif ; marteau haussier / étoile baissière. Englobante : corps opposé entièrement couvert, corps actuel strictement plus grand. Aucun signal de chandelier seul."><div className="grid gap-4 sm:grid-cols-2">{([
      ["pivotBars", "Bougies à gauche / droite du pivot", 2, 10, 1], ["zoneAtr", "Tolérance zone × ATR14", 0.05, 1, 0.05], ["reactionBars", "Espacement des réactions (M5)", 5, 50, 1], ["breakAtr", "Invalidation : clôture au-delà de × ATR", 0.1, 2, 0.1], ["stopAtr", "Marge SL derrière zone / mèche × ATR", 0.1, 2, 0.05], ["targetAtr", "Marge avant zone opposée × ATR", 0, 1, 0.05], ["wickBody", "Mèche dominante / corps minimum", 2, 5, 0.1], ["wickShare", "Part minimale mèche dominante", 0.6, 0.9, 0.05], ["oppositeWick", "Part maximale mèche opposée", 0, 0.2, 0.05], ["riskPercent", "Risque maximal (%)", 0.01, 1, 0.01], ["minRR", "RR potentiel minimum avant frais", 2, 10, 0.1]
    ] as const).map(([key, label, min, max, step]) => <NumberField key={key} label={label} value={config[key]} min={min} max={max} step={step} onChange={value => { setConfig(c => ({ ...c, [key]: value })); invalidate(); }} />)}</div><Toggle label="Autoriser une structure M15 neutre (jamais contraire)" checked={config.allowNeutral} onChange={allowNeutral => { setConfig(c => ({ ...c, allowNeutral })); invalidate(); }} /><Toggle label="Filtre secondaire EMA20/50 M15" checked={config.emaFilter} onChange={emaFilter => { setConfig(c => ({ ...c, emaFilter })); invalidate(); }} /><p className="text-xs text-muted-foreground">Tendance haussière : deux sommets et deux creux confirmés croissants ; inverse pour baissière. Structure absente = aucune entrée. Après interruption : zones, pivots et signaux en attente supprimés ; indicateurs conservés seulement sur fermeture reconnue. Break-even et trailing désactivés.</p></Section>
    <M5CalendarFields disabled={busy} value={calendar} onChange={value => { setCalendar(value); invalidate(); }} />
    <Section title="3 · Contraintes du symbole et coûts" description="Capital initial fixé à 300 $. Spécifications à fournir depuis MT5/broker pour ce symbole. Aucune valeur de lot ou marge inventée. Marge par lot en USD : estimation conservatrice à confirmer pour la période, non calcul MT5 order_calc_margin."><div className="grid gap-4 sm:grid-cols-2">{([ ["contractSize", "Taille du contrat (oz/lot)"], ["minLot", "Volume minimal (lots)"], ["maxLot", "Volume maximal (lots)"], ["lotStep", "Pas du volume (lots)"], ["marginPerLotUSD", "Marge conservative par lot (USD)"] ] as const).map(([key, label]) => <NumberField key={key} label={label} value={broker[key]} min={0} step={0.01} onChange={value => { setBroker(b => ({ ...b, [key]: value })); invalidate(); }} />)}{([ ["spread", "Spread ($/oz)"], ["slippage", "Slippage ($/oz/sens)"], ["commission", "Commission ($/oz/sens)"] ] as const).map(([key, label]) => <NumberField key={key} label={label} value={costs[key]} min={0} step={0.01} onChange={value => { setCosts(c => ({ ...c, [key]: value })); invalidate(); }} />)}</div><label className="block space-y-2 text-sm">Provenance des spécifications et date de vérification<input className="h-11 w-full rounded-xl border border-input bg-background px-3" value={broker.provenance} onChange={e => { setBroker(b => ({ ...b, provenance: e.target.value })); invalidate(); }} /></label><Toggle label="Je confirme ces spécifications pour le symbole et la période, compte USD" checked={broker.confirmed} onChange={confirmed => { setBroker(b => ({ ...b, confirmed })); invalidate(); }} /><p className="text-xs text-muted-foreground">Commission par lot et par sens ÷ taille du contrat = commission $/oz/sens. Taille arrondie vers le bas ; lot minimal, risque ou marge impossibles = entrée refusée. Les gaps peuvent dépasser le risque prévu au stop.</p></Section>
    <Section title="4 · Développement et validation hors échantillon" description="Bornes UTC, fins exclusives. Développement antérieur à la validation. Aucun optimiseur. Pour une validation, résultat de développement du même profil figé requis."><div className="grid gap-4 sm:grid-cols-2">{["Développement début", "Développement fin exclusive", "Validation début", "Validation fin exclusive"].map((label, i) => <label key={label} className="space-y-2 text-sm">{label}<input type="date" className="h-11 w-full rounded-xl border border-input bg-background px-3" value={dates[i]} onChange={e => { setDates(d => d.map((value, index) => index === i ? e.target.value : value)); invalidate(); }} /></label>)}</div><label className="block space-y-2 text-sm">Phase du prochain calcul<select className="h-11 w-full rounded-xl border border-input bg-background px-3" value={phase} onChange={e => { setPhase(e.target.value as typeof phase); setResult(null); }}><option value="development">Développement</option><option value="validation">Validation hors échantillon</option></select></label><Button className={`${actionClass} bg-primary text-primary-foreground`} onClick={() => void freeze()}><Save className="mr-2 h-4 w-4" />Enregistrer et figer le profil V3</Button></Section>
    </fieldset></details>
    {busy && <div className="space-y-3"><Progress value={percent} className="h-2 bg-secondary [&>div]:bg-primary" /><Button variant="outline" className={actionClass} onClick={() => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false); setError("Calcul V3 annulé. Historiques intacts."); }}>Annuler le calcul V3</Button></div>}{message && <p role="status" className="rounded-xl border border-primary/30 p-3 text-sm">{message}</p>}{error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">{error}</p>}
    {result && <Section title="Résultat V3 indépendant"><p className="font-semibold text-primary">Moteur réellement exécuté : M5 V3 — Rebond Price Action · PAPER · {result.v3.phase === "validation" ? "hors échantillon" : "développement"}</p><p className="break-all text-xs">Exécution {result.execution.runId} · profil SHA-256 {result.v3.profileFingerprint} · données SHA-256 {result.v3.dataFingerprint}</p><div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">{Object.entries(result.audit).map(([label, value]) => <p key={label} className="text-xs">{label} : <strong>{value}</strong></p>)}</div><M5V3RunSummary result={result} /><SaveBacktest result={result} /><BacktestResults result={result} showStrategyConfiguration={false} instrumentLabel={result.history.source === "MT5" ? result.history.symbol : "XAUUSD"} /><M5V3Comparison result={result} /></Section>}
    <BacktestHistory strategy="M5" />
  </section>;
}
