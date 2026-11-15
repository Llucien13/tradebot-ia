import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import type { FTMOSnapshot } from "@/lib/ftmo-api";

export const euros = (value: number) => value.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
export const dateTime = (time: number) => new Date(time * 1000).toLocaleString("fr-FR", { timeZone: "Europe/Prague" });

export function FTMOLedger({ data }: { data: FTMOSnapshot }) {
  const [phase, setPhase] = useState("current"), [page, setPage] = useState(0);
  const s = data.state;
  const selected = phase === "current" ? s.phase : Number(phase);
  const trades = s.trades.filter(t => t.phase === selected);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(trades.length/50)-1));
  const curve = s.curve.filter(p => p.phase === selected);
  const daily: Record<string, number> = {}, monthly: Record<string, number> = {};
  for (const event of s.cashEvents.filter(e => e.phase === selected)) {
    const day = new Date(event.time * 1000).toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });
    daily[day] = (daily[day] ?? 0) + event.amount;
    monthly[day.slice(0, 7)] = (monthly[day.slice(0, 7)] ?? 0) + event.amount;
  }
  const exportTrades = () => {
    const text = JSON.stringify({ mode: "PAPER", state: s, generatedAt: new Date().toISOString() }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "ftmo-20k-paper.json"; a.click(); URL.revokeObjectURL(url);
  };
  return <section className="space-y-5 rounded-3xl border border-border bg-card p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Registre PAPER · phases séparées</h2><div className="flex flex-wrap gap-2"><select aria-label="Phase du registre" className="h-11 rounded-xl border border-input bg-background px-3 text-sm" value={phase} onChange={e => { setPhase(e.target.value); setPage(0); }}><option value="current">Phase actuelle</option><option value="1">Phase 1</option><option value="2">Phase 2</option></select><Button variant="outline" onClick={exportTrades} className="h-11 rounded-xl">Exporter le registre</Button></div></div>
    {s.position && <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm"><p className="font-semibold">Position virtuelle {s.position.side === 1 ? "BUY" : "SELL"} · {s.position.lots} lots · phase {s.position.phase}</p><p className="mt-2">Entrée {s.position.entry.toFixed(2)} · SL {s.position.sl.toFixed(2)} · TP {s.position.tp.toFixed(2)} · risque initial {euros(s.position.riskEUR)}</p><p className="mt-1 text-xs text-muted-foreground">{dateTime(s.position.entryTime)} Europe/Prague · swaps cumulés {euros(s.position.swapsEUR)}. Aucun ordre chez le broker.</p></div>}
    <h3 className="text-sm font-semibold">Courbe d’equity · phase {selected}</h3>
    {curve.length > 1 ? <div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={curve}><CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" /><XAxis dataKey="time" tickFormatter={value => new Date(value * 1000).toLocaleDateString("fr-FR")} minTickGap={40} /><YAxis domain={["auto", "auto"]} /><Tooltip labelFormatter={value => dateTime(Number(value))} formatter={value => euros(Number(value))} /><Line dataKey="equity" name="Equity EUR" stroke="hsl(var(--primary))" dot={false} isAnimationActive={false} /><Line dataKey="balance" name="Solde EUR" stroke="hsl(var(--muted-foreground))" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div> : <p className="text-sm text-muted-foreground">La courbe apparaîtra après réception de mesures MT5. Aucun tracé de démonstration.</p>}
    <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full whitespace-nowrap text-left text-xs"><caption className="sr-only">Transactions PAPER phase {selected}</caption><thead className="bg-secondary"><tr>{["Entrée Prague", "Sortie Prague", "Sens / lots", "Entrée", "SL", "TP", "Sortie", "Motif", "P&L net EUR"].map(h => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>{[...trades].reverse().slice(currentPage*50, (currentPage+1)*50).map((t, i) => <tr key={i} className="border-t border-border"><td className="px-3 py-3">{dateTime(t.entryTime)}</td><td className="px-3 py-3">{dateTime(t.exitTime)}</td><td className="px-3 py-3">{t.side === 1 ? "BUY" : "SELL"} / {t.lots}</td>{[t.entry, t.sl, t.tp, t.exit].map((v, j) => <td key={j} className="px-3 py-3 font-mono">{v.toFixed(2)}</td>)}<td className="px-3 py-3">{t.reason}</td><td className="px-3 py-3 font-semibold">{euros(t.pnl)}</td></tr>)}</tbody></table></div>
    {trades.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{trades.length} transactions · page {currentPage+1} / {Math.ceil(trades.length/50)} · export intégral inchangé</p><div className="flex gap-2"><Button variant="outline" className="min-h-11 rounded-xl" disabled={currentPage === 0} onClick={() => setPage(currentPage-1)}>Précédent</Button><Button variant="outline" className="min-h-11 rounded-xl" disabled={(currentPage+1)*50 >= trades.length} onClick={() => setPage(currentPage+1)}>Suivant</Button></div></div>}
    {!trades.length && <p className="text-sm text-muted-foreground">Aucune transaction clôturée pour cette phase.</p>}
    <div className="grid gap-4 md:grid-cols-2">{[["Gains journaliers nets", daily], ["Gains mensuels nets", monthly]].map(([title, rows]) => <details key={String(title)} className="rounded-2xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">{String(title)}</summary><dl className="mt-3 space-y-2 text-sm">{Object.entries(rows).map(([period, amount]) => <div key={period} className="flex justify-between gap-3"><dt>{period}</dt><dd>{euros(Number(amount))}</dd></div>)}</dl></details>)}</div>
    <div className="space-y-3"><h3 className="font-semibold">Historique des phases validées</h3>{s.phases.map(p => <div key={p.phase} className="rounded-xl bg-secondary/50 p-4 text-sm">Phase {p.phase} · {euros(p.gain)} virtuels · {p.days} jours · {p.trades} transactions<br />{p.start ? dateTime(p.start) : "—"} → {dateTime(p.end)} · durée {p.start ? ((p.end-p.start)/86400).toFixed(1) : "—"} jours</div>)}<p className="text-xs text-muted-foreground">Phase actuelle : {s.startedAt ? `début ${dateTime(s.startedAt)} · durée ${((Date.now()/1000-s.startedAt)/86400).toFixed(1)} jours` : "non démarrée"}. Les réinitialisations de phase ne sont pas des retraits.</p></div>
    {s.interruptions.length > 0 && <details className="rounded-2xl border border-amber-500/30 p-4"><summary className="cursor-pointer text-sm font-semibold">Interruptions et limites de vérification ({s.interruptions.length})</summary><ul className="mt-3 space-y-2 text-xs">{s.interruptions.slice(-30).map((gap, i) => <li key={i}>{gap.from ? dateTime(gap.from) : "—"} → {dateTime(gap.to)} : {gap.reason}</li>)}</ul></details>}
  </section>;
}
