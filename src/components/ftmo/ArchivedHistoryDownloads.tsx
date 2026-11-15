import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { readBacktestHistory, type HistoryRecord } from "@/lib/backtest-history";
import { encodeBackup } from "@/lib/backup";
import { readPaperState } from "@/lib/paper/model";

export default function ArchivedHistoryDownloads() {
  const [records, setRecords] = useState<HistoryRecord[]>([]), [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void readBacktestHistory().then(value => { if (active) { setRecords(value.records); setWarnings(value.warnings); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Lecture des archives impossible."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const download = (name: string, value: unknown) => {
    const url = URL.createObjectURL(new Blob([encodeBackup(value)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6"><h2 className="text-xl font-bold">Historiques antérieurs · lecture seule</h2><p className="text-sm text-muted-foreground">Les résultats, paramètres et audits sont exportés tels qu’enregistrés. Les anciens moteurs restent inactifs ; aucun résultat n’est recalculé et aucune donnée n’est remplacée.</p>
    {loading ? <p role="status" className="text-sm text-primary">Lecture progressive des copies conservées…</p> : <><p className="text-sm">{records.length} résultat(s) distinct(s) accessible(s).</p><div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11 rounded-xl" disabled={!records.length} onClick={() => download("tradebot-historiques-archives.json", records)}>Exporter les résultats chargés</Button><Button variant="outline" className="min-h-11 rounded-xl" onClick={() => { try { download("tradebot-registre-paper-anterieur.json", readPaperState()); } catch (e) { setError(e instanceof Error ? e.message : "Ancien registre inaccessible. Il n’a pas été modifié."); } }}>Exporter le registre PAPER antérieur</Button></div><ul className="space-y-2">{records.map(record => <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-4"><div><p className="text-sm font-semibold">{record.label}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(record.savedAt).toLocaleString("fr-FR")} · {record.origin}</p></div><Button variant="outline" className="min-h-10 rounded-xl" onClick={() => download(`tradebot-resultat-${record.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`, record)}>Exporter</Button></li>)}</ul></>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {warnings.length > 0 && <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">Disponibilité et réserves</summary><ul className="mt-3 space-y-2 text-xs text-muted-foreground">{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
  </section>;
}
