import { DashboardPositions } from "@/components/dashboard/DashboardLedger";
import { Section } from "@/components/strategy/StrategyFields";
import { usePaperTrading } from "@/components/paper/PaperTradingProvider";
import { PaperLayout, PaperEmpty, paperUtc, paperNumber } from "@/components/paper/PaperLayout";
import { PaperMetrics } from "@/components/paper/PaperAccountPanel";

export default function Positions() {
  const { state, unrealized } = usePaperTrading();
  const p = state.position;
  return <PaperLayout title="Positions virtuelles" description="Aucune position d’exemple. Seules les entrées exécutées par le Risk Manager à partir de signaux Twelve Data sont affichées.">
    <DashboardPositions />
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm text-primary">Détails · compte et audit de la position</summary><div className="mt-4 space-y-5">
    <PaperMetrics />
    {!p ? <PaperEmpty title="Aucune position virtuelle ouverte" description="Une position apparaîtra uniquement après un signal valide de la stratégie enregistrée, un compte initialisé et le démarrage explicite du paper trading." /> : <Section title={`Position ${p.direction} · XAU/USD · ${p.timeframe}`} description="Le prix de valorisation provient des dernières bougies réelles 1h. La position conserve la configuration exacte qui a autorisé son entrée.">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Entrée UTC", paperUtc(p.entryTime)], ["Prix exécuté ($/oz)", paperNumber(p.entry, 4)], ["Dernier prix réel ($/oz)", paperNumber(state.lastPrice?.price ?? null, 4)], ["PnL latent net de sortie (€)", paperNumber(unrealized)], ["Taille (onces)", paperNumber(p.quantity, 6)], ["Volume (lots)", paperNumber(p.lots, 4)], ["Budget théorique de risque (€)", paperNumber(p.riskBudgetEUR)], ["Marge initiale (€)", paperNumber(p.marginEUR)], ["Risque réel initial (€)", paperNumber(p.riskMoney)], ["SL initial / actuel ($/oz)", `${paperNumber(p.initialSL, 4)} / ${paperNumber(p.sl, 4)}`], ["Take Profit initial ($/oz)", paperNumber(p.tp, 4)], ["Confiance calculée", `${paperNumber(p.confidence)}%`], ["Signal UTC", paperUtc(p.signalTime)], ["Source", p.source], ["Valorisation observée UTC", state.lastPrice ? paperUtc(state.lastPrice.time) : "Indisponible"]].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-background/40 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-sm font-medium">{value}</dd></div>)}</dl>
      <h3 className="text-sm font-semibold">Conditions réellement validées à l’entrée</h3><ul className="space-y-1 text-sm text-muted-foreground">{p.conditions.map((condition, i) => <li key={i}>{condition}</li>)}</ul>
      <h3 className="text-sm font-semibold">Changements du Stop Loss</h3>{p.changes.length ? <ul className="space-y-2 text-xs text-muted-foreground">{p.changes.map((change, i) => <li key={i}>{paperUtc(change.time)} · {change.reason} · {paperNumber(change.oldSL, 4)} → {paperNumber(change.newSL, 4)}</li>)}</ul> : <p className="text-sm text-muted-foreground">Aucun changement du SL n’a été calculé.</p>}
      <details><summary className="cursor-pointer text-sm text-primary">Configuration enregistrée à l’entrée</summary><pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-background p-4 text-xs">{JSON.stringify(state.versions[p.version], null, 2)}</pre></details>
    </Section>}
    </div></details>
  </PaperLayout>;
}
