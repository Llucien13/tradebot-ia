import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, FlaskConical, Plus, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { BACKTEST_STORAGE_KEY, STRATEGY_STORAGE_KEY, TIMEFRAMES, SESSIONS, INDICATORS, INDICATOR_LABELS, defaultStrategy, loadStrategies, saveStrategies, strategySchema, type Strategy } from "@/lib/strategies";
import { ConditionEditor } from "./ConditionEditor";
import { Field, NumberField, Section, Toggle, selectClass, actionClass } from "./StrategyFields";

export function StrategyLabEditor() {
  const [initial] = useState(loadStrategies);
  const [strategies, setStrategies] = useState(initial.strategies);
  const [draft, setDraft] = useState<Strategy>(initial.strategies[0]);
  const [message, setMessage] = useState(initial.error ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const navigate = useNavigate();
  const saved = strategies.find(s => s.id === draft.id);
  const dirty = !saved || JSON.stringify(saved) !== JSON.stringify(draft);
  useEffect(() => {
    if (initial.error) return;
    try {
      if (!localStorage.getItem(STRATEGY_STORAGE_KEY)) saveStrategies(initial.strategies);
    } catch { setMessage("Le stockage local est indisponible. Vos changements ne seront pas conservés sans un enregistrement réussi."); }
  }, [initial]);
  const patch = (update: Partial<Strategy>) => { setDraft(s => ({ ...s, ...update })); setErrors([]); setMessage(""); };
  const persist = (candidate: Strategy, success: string): Strategy | null => {
    const result = strategySchema.safeParse(candidate);
    if (!result.success) { setErrors([...new Set(result.error.issues.map(issue => `${issue.path.join(".") || "Configuration"} : ${issue.message}`))]); setMessage(""); return null; }
    const next = strategies.some(s => s.id === candidate.id) ? strategies.map(s => s.id === candidate.id ? result.data : s) : [...strategies, result.data];
    try { saveStrategies(next); } catch { setErrors(["Enregistrement impossible : stockage local indisponible ou plein. Vos modifications restent dans l’éditeur."]); return null; }
    setStrategies(next); setDraft(result.data); setErrors([]); setMessage(success); return result.data;
  };
  const canLeave = () => !dirty || window.confirm("Abandonner les modifications non enregistrées ?");
  const duplicate = () => {
    const clone = { ...draft, id: crypto.randomUUID(), name: `${draft.name.slice(0, 70)} — copie`, enabled: false, buy: draft.buy.map(r => ({ ...r, id: crypto.randomUUID() })), sell: draft.sell.map(r => ({ ...r, id: crypto.randomUUID() })) };
    persist(clone, "Copie créée et enregistrée localement, désactivée par défaut.");
  };
  const send = () => {
    const strategy = persist(draft, "Stratégie enregistrée.");
    if (!strategy) return;
    try { localStorage.setItem(BACKTEST_STORAGE_KEY, JSON.stringify(strategy)); navigate(`/strategy-h1?view=backtest&strategy=${encodeURIComponent(strategy.id)}`); }
    catch { setErrors(["Stratégie enregistrée, mais le transfert au module a échoué : stockage local indisponible."]); }
  };
  const toggleArray = <T extends string,>(values: T[], item: T) => values.includes(item) ? values.filter(v => v !== item) : [...values, item];
  const param = (key: keyof Strategy["parameters"], value: number) => patch({ parameters: { ...draft.parameters, [key]: value } });

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">XAU/USD · Strategy Lab</p><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Construisez votre méthode.</h1><p className="mt-2 text-sm text-muted-foreground">Des règles explicites, un risque maîtrisé. Aucune performance inventée.</p></div>
      <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-xs text-primary"><ShieldCheck className="h-4 w-4" />Simulation uniquement</div>
    </div>
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"><FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p className="text-xs leading-relaxed text-muted-foreground">L’activation rend la configuration disponible pour la simulation ; elle ne lance aucun bot et ne passe aucun ordre. Aucune connexion broker. Les stratégies sont conservées uniquement dans ce navigateur. Aucun backtest calculé : aucun win rate affiché.</p></div>
    <div className="grid items-start gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Mes stratégies</h2><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{strategies.length}</span></div>
        {strategies.map(s => <button type="button" key={s.id} aria-pressed={s.id === draft.id} onClick={() => { if (s.id !== draft.id && canLeave()) { setDraft(s); setErrors([]); setMessage(""); } }} className={`w-full space-y-2 rounded-xl border p-3 text-left transition-colors ${s.id === draft.id ? "border-primary/40 bg-primary/10" : "border-border hover:bg-secondary/40"}`}><span className="block break-words text-sm font-semibold">{s.name}</span><span className="block text-xs text-muted-foreground">{s.timeframes.join(" · ")} · {s.riskPercent}% risque</span><span className={`block text-xs ${s.enabled ? "text-emerald-400" : "text-muted-foreground"}`}>{s.enabled ? "Activée en simulation" : "Désactivée"}</span></button>)}
        <Button type="button" variant="outline" className={`${actionClass} w-full border-dashed border-primary/40 text-primary hover:bg-primary/10`} onClick={() => { if (canLeave()) { const s = defaultStrategy(); s.name = "Nouvelle stratégie XAU"; setDraft(s); setErrors([]); setMessage("Nouvelle stratégie : enregistrez-la pour la conserver."); } }}><Plus className="mr-2 h-4 w-4" />Créer une stratégie</Button>
        <p className="text-xs leading-relaxed text-muted-foreground">{strategies.filter(s => s.enabled).length} activée(s) · sauvegarde locale explicite</p>
      </aside>
      <form className="min-w-0 space-y-5" noValidate onSubmit={e => { e.preventDefault(); persist(draft, "Stratégie enregistrée localement."); }}>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{dirty ? "Modifications non enregistrées" : "Configuration enregistrée"}</p><span className="rounded-full border border-border px-3 py-1 text-xs">XAU/USD · {draft.enabled ? "Activée" : "Désactivée"}</span></div>
        {message && <p role="status" className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">{message}</p>}
        {!!errors.length && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"><p className="mb-2 font-semibold">Vérifiez la configuration</p><ul className="list-disc space-y-1 pl-5">{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        <Section title="01 / Identité & horizons">
          <Field label="Nom de la stratégie"><Input value={draft.name} maxLength={80} onChange={e => patch({ name: e.target.value })} className="h-11 rounded-xl bg-background/60" /></Field>
          <Toggle label="Activation en simulation" checked={draft.enabled} onChange={enabled => patch({ enabled })} />
          <fieldset className="space-y-3"><legend className="mb-2 text-sm font-medium">Timeframes autorisés</legend><div className="flex flex-wrap gap-2">{TIMEFRAMES.map(tf => <label key={tf} className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background/40 px-4 py-3 text-sm"><Checkbox checked={draft.timeframes.includes(tf)} onCheckedChange={() => patch({ timeframes: toggleArray(draft.timeframes, tf) })} />{tf}</label>)}</div></fieldset>
        </Section>
        <Section title="02 / Indicateurs" description="EMA 20/50/200 et RSI 14 ont des périodes fixes. Activez les indicateurs utilisés dans vos conditions.">
          <div className="grid gap-3 sm:grid-cols-2">{INDICATORS.map(id => <Toggle key={id} label={INDICATOR_LABELS[id]} checked={draft.indicators[id]} onChange={value => patch({ indicators: { ...draft.indicators, [id]: value } })} />)}</div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {draft.indicators.macd && <><NumberField label="MACD · période rapide" value={draft.parameters.macdFast} min={2} max={500} onChange={v => param("macdFast", v)} /><NumberField label="MACD · période lente" value={draft.parameters.macdSlow} min={2} max={500} onChange={v => param("macdSlow", v)} /><NumberField label="MACD · période signal" value={draft.parameters.macdSignal} min={2} max={500} onChange={v => param("macdSignal", v)} /></>}
            {draft.indicators.adx && <NumberField label="ADX · période" value={draft.parameters.adxPeriod} min={2} max={500} onChange={v => param("adxPeriod", v)} />}
            {draft.indicators.atr && <NumberField label="ATR · période" value={draft.parameters.atrPeriod} min={2} max={500} onChange={v => param("atrPeriod", v)} />}
            {draft.indicators.bollinger && <><NumberField label="Bollinger · période" value={draft.parameters.bbPeriod} min={2} max={500} onChange={v => param("bbPeriod", v)} /><NumberField label="Bollinger · écarts-types" value={draft.parameters.bbDeviation} min={0.1} max={10} step={0.1} onChange={v => param("bbDeviation", v)} /></>}
          </div>
        </Section>
        <ConditionEditor side="BUY" rules={draft.buy} onChange={buy => patch({ buy })} />
        <ConditionEditor side="SELL" rules={draft.sell} onChange={sell => patch({ sell })} />
        <Section title="03 / Validation du signal" description="Confiance prévue = 100 × conditions satisfaites / conditions du sens. Le minimum de confirmations ET le seuil de confiance doivent être atteints. Si BUY et SELL sont valides simultanément, la règle prévue est WAIT.">
          <div className="grid gap-4 sm:grid-cols-2"><NumberField label="Confirmations minimales" value={draft.minConfirmations} min={1} max={Math.min(draft.buy.length, draft.sell.length)} onChange={minConfirmations => patch({ minConfirmations })} /><NumberField label="Confiance minimale (%)" value={draft.minConfidence} min={0} max={100} step={1} onChange={minConfidence => patch({ minConfidence })} /></div>
        </Section>
        <Section title="04 / Risque & sorties" description="Les distances XAU/USD sont exprimées en dollars par once, et non en pips. Le risque est un pourcentage du capital simulé.">
          <div className="grid gap-4 sm:grid-cols-2"><NumberField label="Risque par trade (%)" value={draft.riskPercent} min={0.01} max={100} step={0.01} onChange={riskPercent => patch({ riskPercent })} /><NumberField label="Take Profit · ratio R:R" hint="2 = objectif à deux fois la distance du stop initial." value={draft.takeProfitRR} min={0.1} max={100} step={0.1} onChange={takeProfitRR => patch({ takeProfitRR })} />
            <Field label="Méthode Stop Loss"><select className={selectClass} value={draft.stopLoss.mode} onChange={e => patch({ stopLoss: { ...draft.stopLoss, mode: e.target.value as Strategy["stopLoss"]["mode"] } })}><option value="atr">ATR</option><option value="fixed">Distance fixe</option><option value="structure">Structure de marché</option></select></Field>
            {draft.stopLoss.mode === "atr" && <NumberField label="Stop · multiplicateur ATR" value={draft.stopLoss.atrMultiplier} min={0.1} max={100} step={0.1} onChange={v => patch({ stopLoss: { ...draft.stopLoss, atrMultiplier: v } })} />}
            {draft.stopLoss.mode === "fixed" && <NumberField label="Stop · distance fixe ($/oz)" value={draft.stopLoss.fixedDistance} min={0.01} max={10000} step={0.01} onChange={v => patch({ stopLoss: { ...draft.stopLoss, fixedDistance: v } })} />}
            {draft.stopLoss.mode === "structure" && <><NumberField label="Structure · bougies précédentes" hint="BUY : sous le plus bas ; SELL : au-dessus du plus haut." value={draft.stopLoss.structureLookback} min={2} max={500} onChange={v => patch({ stopLoss: { ...draft.stopLoss, structureLookback: v } })} /><NumberField label="Structure · marge ($/oz)" value={draft.stopLoss.structureBuffer} min={0} max={1000} step={0.01} onChange={v => patch({ stopLoss: { ...draft.stopLoss, structureBuffer: v } })} /></>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-3"><Toggle label="Break-even" checked={draft.breakEven.enabled} onChange={enabled => patch({ breakEven: { ...draft.breakEven, enabled } })} />{draft.breakEven.enabled && <NumberField label="Break-even · seuil en R" hint="Déplace le stop au prix d’entrée une fois ce gain atteint." value={draft.breakEven.thresholdR} min={0.1} max={100} step={0.1} onChange={thresholdR => patch({ breakEven: { ...draft.breakEven, thresholdR } })} />}</div><div className="space-y-3"><Toggle label="Trailing stop" checked={draft.trailing.enabled} onChange={enabled => patch({ trailing: { ...draft.trailing, enabled } })} />{draft.trailing.enabled && <NumberField label="Trailing · distance ATR" hint="Distance de suivi prévue : multiple de l’ATR ; le stop ne recule jamais." value={draft.trailing.distanceATR} min={0.1} max={100} step={0.1} onChange={distanceATR => patch({ trailing: { ...draft.trailing, distanceATR } })} />}</div></div>
        </Section>
        <Section title="05 / Filtres d’exécution simulée">
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-3"><Toggle label="Filtre de spread" checked={draft.spread.enabled} onChange={enabled => patch({ spread: { ...draft.spread, enabled } })} />{draft.spread.enabled && <NumberField label="Spread maximal ($/oz)" value={draft.spread.maxUSD} min={0} max={1000} step={0.01} onChange={maxUSD => patch({ spread: { ...draft.spread, maxUSD } })} />}</div><NumberField label="Cooldown entre trades (minutes)" hint="Délai minimum après la clôture d’un trade simulé." value={draft.cooldownMinutes} min={0} max={10080} onChange={cooldownMinutes => patch({ cooldownMinutes })} /></div>
          <Field label="Positions simultanées max" hint="Backtest uniquement : de 1 à 5 positions, chacune avec sa taille et ses sorties indépendantes. Défaut : 1. Un nouveau signal valide sur une bougie clôturée peut préparer une entrée si une place reste libre ; les filtres et le cooldown restent applicables. Le risque est calculé par trade sur le capital comptabilisé, sans ajouter les gains latents. Le risque cumulé peut dépasser celui d’un seul trade. Le Paper Trading reste mono-position."><select className={selectClass} value={draft.maxConcurrentPositions} onChange={e => patch({ maxConcurrentPositions: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} {n === 1 ? "position" : "positions"}</option>)}</select></Field>
          <fieldset><legend className="mb-3 text-sm font-medium">Sessions autorisées (UTC, plages fixes)</legend><div className="flex flex-wrap gap-3">{SESSIONS.map(session => <label key={session} className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm"><Checkbox checked={draft.sessions.includes(session)} onCheckedChange={() => patch({ sessions: toggleArray(draft.sessions, session) })} />{session}</label>)}</div><p className="mt-3 text-xs text-muted-foreground">Asie : 00–09h · Londres : 07–16h · New York : 13–22h UTC. Au moins une session ; pas d’ajustement été/hiver.</p></fieldset>
        </Section>
        <div className="flex flex-wrap gap-3 rounded-2xl border border-primary/20 bg-card p-4">
          <Button type="submit" className={`${actionClass} bg-primary text-primary-foreground hover:bg-primary/90`}><Save className="mr-2 h-4 w-4" />Enregistrer</Button>
          <Button type="button" variant="outline" className={actionClass} onClick={duplicate}><Copy className="mr-2 h-4 w-4" />Dupliquer</Button>
          <Button type="button" variant="outline" className={actionClass} onClick={() => persist({ ...draft, enabled: !draft.enabled }, draft.enabled ? "Stratégie désactivée et enregistrée." : "Stratégie activée en simulation et enregistrée.")}>{draft.enabled ? "Désactiver" : "Activer"}</Button>
          <Button type="button" variant="outline" className={`${actionClass} border-primary/40 text-primary hover:bg-primary/10`} onClick={send}><FlaskConical className="mr-2 h-4 w-4" />Envoyer au Backtest</Button>
        </div>
        <p className="text-xs text-muted-foreground">Dupliquer, Activer / Désactiver et Envoyer au Backtest enregistrent la configuration validée. Aucun de ces boutons n’exécute un ordre.</p>
      </form>
    </div>
  </div>;
}
