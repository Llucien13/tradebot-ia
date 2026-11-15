import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportJournal, readJournal } from "@/lib/paper-monitor-api";
import { date, money, number, Panel, tone } from "./MonitorCards";
import { useMonitor } from "./MonitorLayout";

export default function MonitorJournal({ compact = false }: { compact?: boolean }) {
  const { connected, data } = useMonitor();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState("all");
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const limit = compact ? 5 : 20;
  const params = new URLSearchParams({ result, offset: String(page*limit), limit: String(limit) });
  if (from) params.set("start", String(new Date(`${from}T00:00:00Z`).getTime()/1000));
  if (to) params.set("end", String(new Date(`${to}T23:59:59Z`).getTime()/1000));
  const invalid = !!from && !!to && from > to;
  const query = useQuery({ queryKey: ["monitor-journal", params.toString()], queryFn: ({ signal }) => readJournal(params, signal),
    enabled: !!data && !invalid, refetchInterval: 12000, retry: false });
  const change = (setter: (value: string) => void, value: string) => { setter(value); setPage(0); };
  const rows = query.data?.items ?? [];
  async function download() {
    setMessage(""); setExporting(true);
    try { await exportJournal(params); setMessage("Export des trades filtrés téléchargé, sans limite à la page affichée."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Export indisponible"); }
    finally { setExporting(false); }
  }
  return <Panel title={compact ? "Dernières transactions enregistrées" : "Journal des trades PAPER"} aside={!compact && <Button variant="outline" className="min-h-11 rounded-xl border-slate-700 bg-transparent text-xs" disabled={!data || exporting || invalid} onClick={() => void download()}><Download size={15} className="mr-2" />{exporting ? "Export…" : "Exporter CSV"}</Button>}>
    {!compact && <div className="mb-5 grid gap-3 sm:grid-cols-3"><label className="text-xs text-slate-400">À partir du (UTC)<input type="date" className="mt-2 block min-h-11 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 [color-scheme:dark]" value={from} onChange={e => change(setFrom, e.target.value)} /></label><label className="text-xs text-slate-400">Jusqu’au (UTC)<input type="date" className="mt-2 block min-h-11 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100 [color-scheme:dark]" value={to} onChange={e => change(setTo, e.target.value)} /></label><label className="text-xs text-slate-400">Résultat<select className="mt-2 block min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100" value={result} onChange={e => change(setResult, e.target.value)}><option value="all">Tous les trades</option><option value="win">Gagnants</option><option value="loss">Perdants</option><option value="neutral">Neutres</option><option value="open">Non clôturés</option></select></label></div>}
    {invalid && <p role="alert" className="mb-4 text-sm text-amber-200">La date de début doit précéder la date de fin.</p>}
    {query.isError && <p role="alert" className="mb-4 text-sm text-amber-200">{query.error.message}</p>}
    {!connected && rows.length > 0 && <p className="mb-4 text-xs text-amber-200">Historique conservé en affichage ; état des positions ouvertes non confirmé.</p>}
    {message && <p role="status" className="mb-4 text-sm text-cyan-200">{message}</p>}
    {!rows.length ? <p className="rounded-xl border border-dashed border-slate-700 p-6 text-sm leading-relaxed text-slate-400">{!data ? "Journal inaccessible tant que le registre local n’est pas disponible." : query.isPending ? "Lecture du journal…" : "Aucun trade enregistré pour cette sélection. Aucun résultat de démonstration."}</p> : <ol className="divide-y divide-slate-800">{rows.map(item => {
      const t = item.trade;
      const closed = t.exitTime != null;
      const review = item.needsReview || (!closed && (data?.position?.id !== item.id || !!data?.position?.needsReview));
      return <li key={item.id} className="py-4 first:pt-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">XAUUSD <span className={t.side === 1 ? "text-emerald-300" : "text-rose-300"}>{t.side === 1 ? "ACHAT" : "VENTE"}</span><span className="ml-2 text-xs text-slate-400">{closed ? "Clôturé" : !connected ? "Non confirmé" : review ? "À vérifier" : "Ouvert"}</span></p><p className="mt-2 break-all font-mono text-[11px] text-slate-400">{item.id}</p></div><div className="text-right"><p className={`font-semibold tabular-nums ${tone(t.pnl)}`}>{money(t.pnl)}</p><p className="mt-1 text-xs text-slate-400">{t.pnl != null ? `${number(t.pnl/200, " %")} · ${t.riskEUR > 0 ? number(t.pnl/t.riskEUR, " R") : "R indisponible"}` : "Résultat non clôturé"}</p></div></div>
        <p className="mt-3 text-xs leading-relaxed text-slate-300">{date(t.entryTime)} → {closed ? date(t.exitTime) : "—"} · Europe/Paris</p>
        {!compact && <><p className="mt-1 text-xs text-slate-400">{date(t.entryTime, "UTC")} → {closed ? date(t.exitTime, "UTC") : "—"} · UTC</p><dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">{[["Entrée → sortie", `${number(t.entry)} → ${number(t.exit)}`], ["SL / TP", `${number(t.sl)} / ${number(t.tp)}`], ["Volume", number(t.lots, " lots")], ["Risque initial", money(t.riskEUR)]].map(([label, value]) => <div key={label}><dt className="text-slate-400">{label}</dt><dd className="mt-1 tabular-nums">{value}</dd></div>)}</dl><p className="mt-3 text-xs leading-relaxed text-slate-400">Entrée : {t.entryReason || "motif non enregistré"} · Sortie : {t.reason || "non clôturé / non enregistré"}</p></>}
      </li>;
    })}</ol>}
    {!compact && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4"><p className="text-xs text-slate-400">{query.data?.total ?? "—"} trade(s) · plus récent d’abord · période par chevauchement</p><div className="flex gap-2"><Button variant="outline" className="min-h-11 rounded-xl border-slate-700 bg-transparent text-xs" disabled={!page || query.isFetching} onClick={() => setPage(p => p-1)}>Précédent</Button><Button variant="outline" className="min-h-11 rounded-xl border-slate-700 bg-transparent text-xs" disabled={!query.data || (page+1)*limit >= query.data.total || query.isFetching} onClick={() => setPage(p => p+1)}>Suivant</Button></div></div>}
  </Panel>;
}
