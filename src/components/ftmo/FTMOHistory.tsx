import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { archivedTradesSchema, ftmoRequest, referenceSchema, type FTMOReferences } from "@/lib/ftmo-api";
import { euros } from "./FTMOLedger";
import type { z } from "zod";

export function FTMOHistory() {
  const [references, setReferences] = useState<FTMOReferences | null>(null);
  const [trades, setTrades] = useState<z.infer<typeof archivedTradesSchema>["trades"]>([]);
  const [year, setYear] = useState("2025"), [tp, setTP] = useState("2p5"), [error, setError] = useState("");
  const [reload, setReload] = useState(0), [showTrades, setShowTrades] = useState(false), [loadingTrades, setLoadingTrades] = useState(false), [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void ftmoRequest("references", referenceSchema, "GET", undefined, controller.signal).then(value => { if (!controller.signal.aborted) { setReferences(value); setError(""); } }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Archive inaccessible."); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!references || !showTrades) return;
    const controller = new AbortController(); setTrades([]); setLoadingTrades(true); setPage(0);
    void ftmoRequest(`reference-trades?year=${year}&tp=${tp}`, archivedTradesSchema, "GET", undefined, controller.signal).then(data => { if (!controller.signal.aborted) { setTrades(data.trades); setError(""); } }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Transactions inaccessibles."); }).finally(() => { if (!controller.signal.aborted) setLoadingTrades(false); });
    return () => controller.abort();
  }, [references, year, tp, showTrades]);
  const reference = references?.results.find(r => r.summary.year === Number(year) && r.summary.tpR === (tp === "2p5" ? 2.5 : 5) && r.summary.spread === .3);
  return <section className="space-y-5 rounded-3xl border border-border bg-card p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Archive originale · distincte du PAPER actuel</p><h2 className="mt-1 text-xl font-bold">Backtests historiques 2025 / 2026</h2></div><Button variant="outline" className="min-h-11 rounded-xl" disabled={loadingTrades} onClick={() => { setShowTrades(false); setTrades([]); setReload(v => v+1); }}>Relire l’archive</Button></div>
    <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">Gains virtuels de replay, non retirables. Données déjà utilisées pour sélectionner la stratégie : pas de validation hors échantillon et pas de certification FTMO.</p>
    <div className="flex flex-wrap gap-3"><select aria-label="Année historique" disabled={loadingTrades} value={year} onChange={e => { setYear(e.target.value); setShowTrades(false); setTrades([]); setPage(0); }} className="h-11 rounded-xl border border-input bg-background px-4"><option>2025</option><option>2026</option></select><select aria-label="Variante historique comparative" disabled={loadingTrades} value={tp} onChange={e => { setTP(e.target.value); setShowTrades(false); setTrades([]); setPage(0); }} className="h-11 rounded-xl border border-input bg-background px-4"><option value="2p5">2,5R · référence</option><option value="5">5R · comparaison seulement</option></select></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {reference && <><div className="grid gap-3 sm:grid-cols-3">{[["Somme virtuelle des deux phases", euros(reference.summary.net)], ["Transactions archivées", String(reference.summary.trades)], ["Drawdown OHLC archivé", `${reference.summary.max_dd_ohlc_pct} %`]].map(([label, value]) => <div key={label} className="rounded-2xl bg-secondary/50 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-bold">{value}</p></div>)}</div><div className="grid gap-3 sm:grid-cols-2">{reference.phases.map(p => <div key={p.phase} className="rounded-2xl border border-border p-4 text-sm"><p className="font-semibold">Phase {p.phase} · {euros(p.equity-20000)}</p><p className="mt-2">{p.start} → {p.end}<br />{p.days} jours de trading · {p.trades} transactions</p></div>)}</div></>}
    {!showTrades && <Button variant="outline" className="min-h-11 rounded-xl" disabled={!references} onClick={() => setShowTrades(true)}>Charger les transactions originales</Button>}
    {loadingTrades && <p role="status" className="text-sm text-primary">Lecture des transactions archivées…</p>}
    {showTrades && !loadingTrades && error && <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => { setShowTrades(false); setError(""); }}>Réessayer le chargement</Button>}
    {trades.length > 0 && <div className="space-y-4 rounded-2xl border border-border p-4"><p className="text-sm font-semibold">Transactions originales ({trades.length}) · 50 par page</p><div className="max-h-96 overflow-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="bg-secondary"><tr>{["Phase", "Entrée serveur", "Sortie serveur", "Sens", "Lots", "Entrée", "SL", "TP", "Sortie", "Motif", "Net EUR"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{trades.slice(page*50, (page+1)*50).map((t, i) => <tr key={i} className="border-t border-border"><td className="p-3">{t.phase}</td><td className="p-3">{t.entry}</td><td className="p-3">{t.exit}</td><td className="p-3">{t.side === 1 ? "BUY" : "SELL"}</td><td className="p-3">{t.lot}</td>{[t.entry_price, t.stop_price, t.tp_price, t.exit_price].map((v, j) => <td key={j} className="p-3">{v.toFixed(2)}</td>)}<td className="p-3">{t.exit_reason}</td><td className="p-3">{euros(t.pnl)}</td></tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Page {page+1} / {Math.ceil(trades.length/50)} · aucune transaction supprimée</p><div className="flex gap-2"><Button variant="outline" className="min-h-11 rounded-xl" disabled={page === 0} onClick={() => setPage(p => p-1)}>Précédent</Button><Button variant="outline" className="min-h-11 rounded-xl" disabled={(page+1)*50 >= trades.length} onClick={() => setPage(p => p+1)}>Suivant</Button></div></div></div>}
    {showTrades && !loadingTrades && !error && !trades.length && <p className="text-sm text-muted-foreground">Aucune transaction retournée pour cette archive.</p>}
    <p className="text-sm text-muted-foreground">Frais historiques : spread 0,30 USD/oz · slippage 0,05 USD/oz/sens · commission 3 USD/lot/sens · levier supposé 1:20. Swaps non modélisés. 2025 : change fixe hypothétique 1,15. 2026 : proxy EUR/USD M5 ouverture/clôture. Reset journalier : jour serveur, pas Prague vérifié.</p>
    <p className="text-sm">Résistance aux frais 2026 : avec spread 0,60 USD/oz, 2,5R atteint les deux objectifs ; 5R n’atteint pas la phase 2 avant le 9 octobre. Aucun basculement automatique vers 5R.</p>
    {references && <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">Rapport original et réserves</summary><pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{references.report}</pre></details>}
  </section>;
}
