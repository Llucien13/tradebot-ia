import { useEffect, useState } from "react";
import { Save, Zap, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScalpingOptimization } from "./ScalpingOptimization";
import { loadScalping, saveScalping, scalpingSchema, SCALPING_KEY, type ScalpingConfig } from "@/lib/scalping/model";
import { safeScalpingConfig } from "@/lib/scalping/safety";
import { ScalpingOverview } from "./ScalpingOverview";
import { NumberField, Section, Toggle, actionClass } from "@/components/strategy/StrategyFields";
import { ScalpingSetupEditor } from "./ScalpingSetupEditor";
import { ScalpingBacktest } from "./ScalpingBacktest";
import { MT5DataSourcePanel } from "./MT5DataSourcePanel";
import { useMT5DataSession } from "@/lib/mt5-data-session";

export function ScalpingLabEditor() {
  const { history: mt5History } = useMT5DataSession();
  const [initial] = useState(() => { const loaded = loadScalping(); return { ...loaded, config: safeScalpingConfig(loaded.config) }; });
  const [draft, setDraft] = useState(initial.config);
  const [saved, setSaved] = useState<ScalpingConfig | null>(initial.error ? null : initial.config);
  const [message, setMessage] = useState(initial.error ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [tab, setTab] = useState("configuration");
  const [currentResult, setCurrentResult] = useState<object | null>(null);
  useEffect(() => {
    if (initial.error) return;
    try {
      const previous = localStorage.getItem(SCALPING_KEY);
      if (previous !== JSON.stringify(initial.config)) {
        if (previous) localStorage.setItem(`${SCALPING_KEY}:archive:safety:${Date.now()}`, previous);
        saveScalping(initial.config);
        setMessage("Profil prudent M1 appliqué automatiquement. Ancienne configuration conservée ; activation inchangée. Non validé sur données indépendantes.");
      }
    } catch { setSaved(null); setErrors(["Profil prudent non enregistré : stockage indisponible. Calculs bloqués."]); }
  }, [initial]);
  const dirty = !saved || JSON.stringify(saved) !== JSON.stringify(draft);
  const patch = (update: Partial<ScalpingConfig>) => { setDraft(c => ({ ...c, ...update })); setMessage(""); setErrors([]); };
  const fields: { key: "maxPositionsPerBurst" | "individualProfit" | "individualLoss" | "maxBurstsPerDay" | "delayMinutes" | "dailyLoss" | "dailyGain" | "burstRiskPercent" | "stopDistance"; label: string; min: number; max?: number; step?: number; hint?: string }[] = [
    { key: "maxPositionsPerBurst", label: "Positions maximum par salve", min: 1, max: 10 },
    { key: "individualProfit", label: "Objectif de gain individuel net ($)", min: 0.01, step: 0.01 },
    { key: "individualLoss", label: "Perte maximale individuelle prévue ($)", min: 0.01, step: 0.01, hint: "Plafond au stop hors gap. Le budget de salve peut imposer un risque inférieur." },
    { key: "maxBurstsPerDay", label: "Salves maximum par jour UTC", min: 1, max: 1000 },
    { key: "delayMinutes", label: "Délai minimum entre salves (minutes)", min: 0, max: 10080, step: 0.1, hint: "Entre les ouvertures de deux salves, y compris d’un jour à l’autre." },
    { key: "dailyLoss", label: "Perte maximale quotidienne nette ($)", min: 0.01, step: 0.01 },
    { key: "dailyGain", label: "Gain maximal quotidien net ($)", min: 0.01, step: 0.01 },
    { key: "burstRiskPercent", label: "Budget de risque maximum par salve (%)", min: 0.01, max: 100, step: 0.01, hint: "Réparti entre les positions, sans dépasser la perte individuelle prévue." },
    { key: "stopDistance", label: "Distance de stop propre au scalping ($/oz)", min: 0.01, max: 10000, step: 0.01, hint: "Nécessaire pour convertir le risque en dollars en volume d’onces. Indépendante des stops H1." },
  ];
  return <div className="space-y-5">
    <ScalpingOverview currentResult={currentResult} enabled={!!saved?.enabled} />
    <details className="rounded-3xl border border-border bg-card">
      <summary className="min-h-14 cursor-pointer rounded-3xl px-5 py-4 text-sm font-semibold text-primary">Outils de simulation et réglages avancés</summary>
    <section id="mode-scalping" className="space-y-5 border-t border-border p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-2xl bg-primary/15 p-3 text-primary"><Zap className="h-6 w-6" /></span><div><p className="text-xs uppercase tracking-widest text-primary">Module indépendant · XAU/USD</p><h2 className="mt-1 text-2xl font-bold">Mode Scalping</h2></div></div><span className="rounded-full border border-border bg-card px-3 py-2 text-xs">{saved?.enabled ? "Activé pour les backtests scalping" : "Désactivé"}</span></div>
    <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Stockage, règles, budget et résultats séparés de la stratégie principale. Désactivé par défaut. L’activation autorise uniquement des simulations ; aucun bot, Paper Trading ou ordre réel n’est lancé.</p>
    <Tabs value={tab} onValueChange={setTab} className="space-y-5">
    <TabsList className="sticky top-2 z-10 grid h-auto w-full grid-cols-3 rounded-2xl border border-border bg-card p-1 shadow-sm">
      <TabsTrigger value="configuration" className="min-h-12 whitespace-normal rounded-xl text-xs sm:text-sm data-[state=active]:bg-primary/15 data-[state=active]:text-primary">Configuration actuelle</TabsTrigger>
      <TabsTrigger value="optimization" className="min-h-12 whitespace-normal rounded-xl text-xs sm:text-sm data-[state=active]:bg-primary/15 data-[state=active]:text-primary">Optimisation automatique</TabsTrigger>
      <TabsTrigger value="backtest" className="min-h-12 rounded-xl data-[state=active]:bg-primary/15 data-[state=active]:text-primary">Backtest</TabsTrigger>
    </TabsList>
    <TabsContent forceMount value="configuration" className="data-[state=inactive]:hidden">
    <form noValidate className="space-y-4" onSubmit={e => {
      e.preventDefault(); const parsed = scalpingSchema.safeParse({ ...draft, timeframe: "1m" });
      if (!parsed.success) { setErrors([...new Set(parsed.error.issues.map(i => `${i.path.join(".")} : ${i.message}`))]); return; }
      try { const prudent = safeScalpingConfig(parsed.data); saveScalping(prudent); setSaved(prudent); setDraft(prudent); setErrors([]); setMessage("Profil prudent enregistré : filtres de qualité et plafonds de risque restent obligatoires. H1 et anciens résultats inchangés. Non validé."); }
      catch { setErrors(["Stockage indisponible : le module n’a pas été enregistré."]); }
    }}>
      <Section title="Activation, salves & limites">
        <Toggle label="Activer le Mode Scalping pour ses backtests" checked={draft.enabled} onChange={enabled => patch({ enabled })} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <p className="text-sm font-semibold text-primary">Scalping M1 · timeframe 1m</p>
          {fields.map(f => <NumberField key={f.key} label={f.label} value={draft[f.key]} min={f.min} max={f.max} step={f.step} hint={f.hint} onChange={v => patch({ [f.key]: v })} />)}
        </div>
        <p className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs leading-relaxed">Le nombre par salve est un plafond, jamais une obligation. Aucune entrée sans signal valide. Le nombre exécuté dépend aussi du budget : au plus ceil(budget / perte individuelle), borné par le maximum configuré. Le risque unitaire est au plus le budget réparti et la perte individuelle. Une seule salve est ouverte à la fois : le plafond de positions et le budget ne sont jamais multipliés par des salves superposées. Le TP net vise le maximum entre l’objectif individuel et le ratio net gain/risque.</p>
      </Section>
      <ScalpingSetupEditor value={draft.setup} onChange={setup => patch({ setup })} />
      {errors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-xl border border-destructive/40 bg-destructive/10 p-4 pl-8 text-sm">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
      {message && <p role="status" className="rounded-xl border border-primary/25 bg-card p-3 text-sm">{message}</p>}
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" className={`${actionClass} bg-primary text-primary-foreground hover:bg-primary/90`}><Save className="mr-2 h-4 w-4" />Enregistrer le module scalping</Button><p className="text-xs text-muted-foreground">{dirty ? "Modifications non enregistrées : le backtest utilise seulement la version enregistrée." : "Configuration scalping prête pour un test indépendant."}</p></div>
    </form>
    </TabsContent>
    <TabsContent forceMount value="optimization" className="data-[state=inactive]:hidden"><ScalpingOptimization config={saved} mt5History={mt5History} onApply={config => {
      try { const prudent = safeScalpingConfig(config); saveScalping(prudent); setSaved(prudent); setDraft(prudent); setErrors([]); setMessage("Profil prudent enregistré dans Scalping uniquement. Non validé ; aucun ordre ni backtest déclenché, H1 inchangé."); setTab("configuration"); }
      catch { setMessage("Stockage indisponible : configuration non appliquée."); setTab("configuration"); }
    }} /></TabsContent>
    <TabsContent forceMount value="backtest" className="space-y-5 data-[state=inactive]:hidden"><MT5DataSourcePanel fixedTimeframe="M1" /><ScalpingBacktest config={saved} mt5History={mt5History} onResult={setCurrentResult} /></TabsContent>
    </Tabs>
    </section>
    </details>
  </div>;
}
