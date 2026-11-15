import type { OptimizationMetrics, OptimizationReport } from "@/lib/scalping/optimizer";
import type { ScalpingConfig } from "@/lib/scalping/model";
import { Button } from "@/components/ui/button";
import { uiDateTime } from "@/lib/ui-presentation";
import { useEffect } from "react";
import { captureResult } from "@/lib/backup";
const number = (v: number | null) => v === null ? "—" : v === Infinity ? "∞" : v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
function Metrics({ title, metrics: m }: { title: string; metrics: OptimizationMetrics }) {
  const rows = [["Bénéfice net ($)", m.netPnl], ["Trades", m.trades], ["Salves", m.bursts], ["Profit factor", m.profitFactor], ["Drawdown max ($)", m.maxDrawdownMoney], ["Drawdown max (%)", m.maxDrawdown], ["Coûts supposés ($)", m.totalCosts], ["Jours UTC", m.days]] as const;
  return <div className="rounded-xl border border-border bg-background/50 p-4"><h4 className="mb-3 text-xs font-bold tracking-widest text-primary">{title}</h4><dl className="space-y-2 text-xs">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono">{number(value)}</dd></div>)}</dl></div>;
}
export function OptimizationResults({ report, onApply, disabled }: { report: OptimizationReport; onApply: (config: ScalpingConfig) => void; disabled: boolean }) {
  useEffect(() => { captureResult("optimization", `Optimisation · ${report.source} · ${report.createdAt} · ${report.tested} configurations`, report); }, [report]);
  return <div className="space-y-4">
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm"><p>{report.tested} configurations uniques · {report.source} · référence 300 $</p><p className="mt-2 text-xs text-muted-foreground">Découpage interne : 70 % recherche / 30 % contrôle. Frontière : {uiDateTime(report.splitTime)}. Rapport du {uiDateTime(Date.parse(report.createdAt))}.</p></div>
    <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200"><strong>Non validé.</strong> Le découpage d’un historique ne prouve pas une validation indépendante. Une nouvelle optimisation sur une période déjà utilisée est bloquée. Aucune rentabilité future n’est certifiée.</p>
    {!report.candidates.length && <p className="text-sm text-muted-foreground">Aucune configuration n’a passé les critères internes. Aucun paramètre appliqué.</p>}
    <div className="grid items-start gap-4 xl:grid-cols-3">{report.candidates.map((candidate, i) => <article key={i} className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <h3 className="font-bold">#{i + 1} Présélection de recherche</h3>
      <p className="inline-flex rounded-full border border-amber-400/30 px-3 py-1 text-xs text-amber-200">Non validé{candidate.status === "Rejetée" ? " · critères internes rejetés" : ""}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{candidate.reason}</p>
      <Metrics title="RECHERCHE · 70 %" metrics={candidate.training} /><Metrics title="CONTRÔLE INTERNE · 30 %" metrics={candidate.validation} />
      <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs text-primary">Configuration de ce rapport</summary><pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify(candidate.config, null, 2)}</pre></details>
      {i === 0 && <Button disabled={disabled || candidate.status === "Rejetée"} onClick={() => onApply(candidate.config)} className="h-auto min-h-11 w-full whitespace-normal rounded-xl">Appliquer avec plafonds prudents · Non validé</Button>}
    </article>)}</div>
    <p className="text-xs leading-relaxed text-muted-foreground">Application explicite uniquement, sans ordre ni calcul automatique. Les anciens rapports décrivent leur moteur d’origine, pas la logique corrigée. Prix OHLC, coûts supposés, lots minimum et marge broker non modélisés.</p>
  </div>;
}
