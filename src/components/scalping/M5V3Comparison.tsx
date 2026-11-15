import { useEffect, useState } from "react";
import { readBacktestHistory, type HistoryRecord } from "@/lib/backtest-history";
import type { V3Result } from "@/lib/scalping/m5-v3-model";

export function M5V3Comparison({ result }: { result: V3Result }) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  useEffect(() => { let active = true; void readBacktestHistory().then(data => { if (active) setRecords(data.records); }); return () => { active = false; }; }, []);
  const candidates = records.filter(r => r.result.engineVersion === "m5-session-continuity-2" && r.result.settings.start === result.settings.start && r.result.settings.end === result.settings.end);
  const compatible = candidates.filter(r => {
    const saved = r.result as unknown as { dataFingerprint?: string; comparisonContext?: { riskPercent: number; singlePosition: boolean; brokerFingerprint: string }; calendar?: unknown };
    const settings = r.result.settings;
    return saved.dataFingerprint === result.v3.dataFingerprint && saved.comparisonContext?.riskPercent === result.v3.config.riskPercent && saved.comparisonContext?.singlePosition === true
      && saved.comparisonContext?.brokerFingerprint === JSON.stringify(result.v3.broker) && JSON.stringify(saved.calendar) === JSON.stringify(result.calendar)
      && settings.initialCapital === result.settings.initialCapital && settings.spread === result.settings.spread && settings.slippage === result.settings.slippage && settings.commission === result.settings.commission;
  });
  return <div className="space-y-3 rounded-xl border border-primary/30 p-4"><h3 className="font-semibold">Comparaison avec V2 conservée · aucun recalcul</h3><p className="text-xs text-muted-foreground">Les règles de stratégie diffèrent volontairement. Comparaison admise seulement si période, empreinte des bougies, calendrier, coûts, capital, risque et contraintes broker sont vérifiables et identiques.</p>{compatible.map(r => <p key={r.id} className="text-sm">{r.label} · V2 {r.result.stats.netPnl.toFixed(2)} $ / {r.result.stats.trades} trades · V3 {result.stats.netPnl.toFixed(2)} $ / {result.stats.trades} trades</p>)}{!compatible.length && <p className="text-sm">Aucune comparaison certifiée disponible. {candidates.length} résultat(s) V2 de même période trouvé(s), mais les anciens résultats ne portent généralement pas d’empreinte des bougies ni de contraintes broker équivalentes. Ils restent consultables dans l’historique ; aucune métadonnée ajoutée rétroactivement.</p>}</div>;
}
