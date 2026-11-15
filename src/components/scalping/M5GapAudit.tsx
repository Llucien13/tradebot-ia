import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { listBackups, readBackup } from "@/lib/backup";
import { useMT5DataSession } from "@/lib/mt5-data-session";
import type { Candle } from "@/types";
import { NY_CALENDAR, calendarPolicy, type M5Calendar } from "@/lib/scalping/m5-calendar";
import { auditM5Gaps, gapDuration } from "@/lib/scalping/m5-gap-audit";

interface AuditLot { symbol: string; start: number; end: number; candles: Candle[] }
export function M5GapAudit({ calendar = NY_CALENDAR }: { calendar?: M5Calendar }) {
  const { history } = useMT5DataSession("M5");
  const [savedLot, setSavedLot] = useState<AuditLot | null>(null);
  const [message, setMessage] = useState("");
  const lot = savedLot ?? (history ? { symbol: history.symbol, start: Date.parse(history.coverage.requestedStart), end: Date.parse(history.coverage.requestedEnd), candles: history.candles as Candle[] } : null);
  const rows = useMemo(() => lot ? auditM5Gaps(lot.candles, lot.start, lot.end, calendar) : [], [lot, calendar]);
  const scan = async () => {
    try {
      const matches: AuditLot[] = [];
      for (const entry of await listBackups()) {
        const h = (await readBackup(entry.id)).mt5;
        if (h?.interval !== "5m" || h.symbol.toUpperCase() !== "XAUUSD-ECN") continue;
        const start = Date.parse(h.coverage.requestedStart), end = Date.parse(h.coverage.requestedEnd);
        if (start >= Date.parse("2026-09-01T00:00:00Z") || end <= Date.parse("2026-08-01T00:00:00Z")) continue;
        matches.push({ symbol: h.symbol, start, end, candles: h.candles as Candle[] });
      }
      const selected = matches.find(h => h.start === Date.parse("2026-08-01T00:00:00Z") && h.end === Date.parse("2026-09-01T00:00:00Z")) ?? matches[0];
      if (!selected) { setMessage("Aucun lot M5 XAUUSD-ECN d’août 2026 accessible dans les sauvegardes. Chargez le lot conservé ou fournissez son export JSON."); return; }
      setSavedLot(selected);
      const audit = auditM5Gaps(selected.candles, selected.start, selected.end, calendar);
      console.info("M5_AUGUST_GAP_AUDIT", { symbol: selected.symbol, start: selected.start, end: selected.end, gaps: audit });
      setMessage(`Lot lu sans restauration ni backtest. ${matches.length} sauvegarde(s) correspondante(s) ; priorité au mois complet, sinon au lot le plus récent. Vérifiez la période ci-dessous.`);
    } catch { setMessage("Lecture des sauvegardes impossible. Aucun historique modifié."); }
  };
  return <details className="rounded-xl border border-primary/30 bg-primary/5 p-4"><summary className="cursor-pointer text-sm font-semibold">Audit UTC des interruptions · lecture seule</summary><div className="mt-4 space-y-4"><div className="flex flex-wrap gap-3"><Button variant="outline" className="min-h-11 rounded-xl" onClick={() => void scan()}>Analyser la sauvegarde d’août 2026</Button><Button variant="outline" disabled={!history} className="min-h-11 rounded-xl" onClick={() => { setSavedLot(null); setMessage("Audit du lot chargé, sans backtest."); }}>Analyser le lot chargé</Button></div>{message && <p role="status" className="text-sm">{message}</p>}{lot && <><p className="text-sm font-semibold">{lot.symbol} · {new Date(lot.start).toISOString()} → {new Date(lot.end).toISOString()}<br />{rows.length} interruption(s) · {rows.filter(r => r.classification === "scheduled-close").length} normale(s) · {rows.filter(r => r.classification === "anomaly").length} anomalie(s)</p><p className="text-xs text-muted-foreground">Calendrier de cet audit : {calendarPolicy(calendar)}. Heures UTC d’ouverture des bougies. Écart = première bougie après − dernière avant. Durée sans cotation M5 = cet écart − 5 minutes, après clôture de la dernière bougie. Interruptions comptées à la reprise dans la période ; préchauffage antérieur exclu. Le calendrier officiel du broker n’est pas disponible : ce tableau ne certifie pas ses horaires.</p><div className="overflow-x-auto rounded-xl border border-border bg-background"><table className="w-full min-w-[1000px] text-left text-xs"><thead className="bg-secondary"><tr>{["#", "Dernière bougie avant (UTC)", "Première bougie après (UTC)", "Écart exact", "Durée sans bougie", "Créneaux absents", "Classification / raison"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={`${r.before}:${r.after}`} className="border-t border-border"><td className="p-3">{i + 1}</td><td className="whitespace-nowrap p-3">{new Date(r.before).toISOString()}</td><td className="whitespace-nowrap p-3">{new Date(r.after).toISOString()}</td><td className="whitespace-nowrap p-3">{gapDuration(r.elapsed)}</td><td className="whitespace-nowrap p-3">{gapDuration(r.missingDuration)}</td><td className="p-3">{r.missingSlots}</td><td className="max-w-sm p-3"><strong>{r.classification === "scheduled-close" ? "Fermeture normale reconnue" : "Anomalie"}</strong><p className="mt-1">{r.reason}</p></td></tr>)}</tbody></table></div><Button variant="outline" className="min-h-11 rounded-xl" onClick={() => {
    const text = ["#\tDernière avant UTC\tPremière après UTC\tÉcart exact\tDurée sans bougie\tCréneaux absents\tClassification\tRaison", ...rows.map((r, i) => [i + 1, new Date(r.before).toISOString(), new Date(r.after).toISOString(), gapDuration(r.elapsed), gapDuration(r.missingDuration), r.missingSlots, r.classification, r.reason].join("\t"))].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/tab-separated-values;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "TradeBot-audit-interruptions-M5.tsv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }}>Exporter le tableau des interruptions</Button></> }</div></details>;
}
