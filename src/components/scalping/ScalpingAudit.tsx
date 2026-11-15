import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Section, actionClass } from "@/components/strategy/StrategyFields";
import { mt5FrenchUTC as utc } from "@/lib/mt5-data";
import type { ScalpingResult } from "@/lib/scalping/model";
const dollars = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ScalpingAudit({ result }: { result: ScalpingResult }) {
  const [page, setPage] = useState(0);
  const bursts = result.bursts.slice(page * 20, (page + 1) * 20);
  return <div className="space-y-4">
    <Section title="Audit des journées scalping · UTC" description="PnL = equity nette de fin de journée moins sa base. Le blocage reste acquis jusqu’au prochain jour UTC, même si le PnL se redresse ensuite. Aucun trade n’est fermé par le coupe-circuit quotidien. Les blocages conservateurs OHLC sont identifiés : ils ne signifient pas une perte effectivement réalisée.">
      <div className="max-h-80 overflow-auto rounded-xl border border-border"><table className="w-full min-w-[700px] text-left text-xs"><thead className="sticky top-0 bg-card"><tr>{["Jour UTC", "Base equity ($)", "PnL net + latent ($)", "Salves", "Blocage", "Heure du blocage UTC"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{result.days.map(d => <tr key={d.day} className="border-t border-border"><td className="p-3">{d.day.split("-").reverse().join("/")}</td><td className="p-3 font-mono">{dollars(d.baseline)}</td><td className="p-3 font-mono">{dollars(d.pnl)}</td><td className="p-3">{d.bursts}</td><td className="p-3">{d.reason ?? "Aucun"}{d.conservative && " · borne adverse OHLC"}</td><td className="p-3">{d.blockedAt === null ? "—" : utc(d.blockedAt)}</td></tr>)}</tbody></table></div>
    </Section>
    <Section title="Journal des salves & rattachement individuel" description="Une salve est déclenchée par un seul signal valide. Les numéros de trades renvoient au journal individuel détaillé ci-dessous ; chaque position a son propre enregistrement et son propre PnL.">
      <div className="overflow-auto rounded-xl border border-border"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-secondary/40"><tr>{["Salve", "Signal UTC", "Entrée UTC", "Sens", "Positions exécutées", "Budget max ($)", "Risque engagé ($)", "Trades individuels"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{bursts.map(b => <tr key={b.id} className="border-t border-border"><td className="p-3">{b.id}</td><td className="p-3">{utc(b.signalTime)}</td><td className="p-3">{utc(b.time)}</td><td className="p-3 text-primary">{b.direction}</td><td className="p-3">{b.positions} / {result.scalping.maxPositionsPerBurst} max</td><td className="p-3 font-mono">{dollars(b.budget)}</td><td className="p-3 font-mono">{dollars(b.committedRisk)}</td><td className="p-3">{result.trades.filter(t => t.burstId === b.id).map(t => `#${t.id}`).join(", ")}</td></tr>)}{!bursts.length && <tr><td colSpan={8} className="p-4 text-muted-foreground">Aucune salve exécutée.</td></tr>}</tbody></table></div>
      <div className="flex flex-wrap justify-between gap-3"><p className="text-xs text-muted-foreground">{result.bursts.length} salve(s) · page {page + 1} / {Math.max(1, Math.ceil(result.bursts.length / 20))}</p><div className="flex gap-2"><Button variant="outline" className={actionClass} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Précédent</Button><Button variant="outline" className={actionClass} disabled={(page + 1) * 20 >= result.bursts.length} onClick={() => setPage(p => p + 1)}>Suivant</Button></div></div>
    </Section>
    <details className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm text-primary">Configuration scalping exacte de ce résultat indépendant</summary><pre className="mt-3 max-h-80 overflow-auto text-xs">{JSON.stringify(result.scalping, null, 2)}</pre></details>
  </div>;
}
