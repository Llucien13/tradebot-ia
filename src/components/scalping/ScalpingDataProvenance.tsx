import { Section } from "@/components/strategy/StrategyFields";
import { mt5FrenchUTC } from "@/lib/mt5-data";
import type { ScalpingResult } from "@/lib/scalping/model";

export function ScalpingDataProvenance({ result }: { result: ScalpingResult }) {
  const history = result.history;
  if (history.source !== "MT5") return null;
  return <Section title="Données utilisées · MT5 / XAUUSD-ECN / M1" description="Provenance figée au lancement manuel. Les OHLC reçus sont utilisés dans leur ordre d’origine, sans interpolation ni bougie créée.">
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[
        ["Source", history.source], ["Symbole", history.symbol], ["Timeframe", "M1 · TIMEFRAME_M1"],
        ["Bougies totales utilisées", String(result.controls.candles + result.controls.warmup)],
        ["Bougies de la période", String(result.controls.candles)], ["Bougies de préchauffage (indicateurs seuls)", String(result.controls.warmup)],
        ["Période demandée · fin exclusive", `${mt5FrenchUTC(result.settings.start)} → ${mt5FrenchUTC(result.settings.end)}`],
        ["Période réellement couverte · fin exclusive", `${mt5FrenchUTC(result.controls.first)} → ${mt5FrenchUTC(result.controls.last + 60000)}`],
        ["Minutes sans bougie dans la plage demandée", String(history.coverage.missingMinutes)],
        ["Base OHLC", `${history.priceBasis} · volume de ticks`],
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>)}
    </dl>
    <p className="text-xs leading-relaxed text-muted-foreground">Aucun signal ni trade pendant le préchauffage. Les décisions commencent sur la première bougie disponible de la période ; une entrée nécessite ensuite le signal clôturé et l’ouverture réelle suivante. Les absences restent des absences, y compris à l’intérieur de la période couverte.</p>
    <p className="text-xs leading-relaxed text-muted-foreground">Exécution simulée sur base Bid : achat à l’Ask (Bid + spread configuré), vente au Bid ; liquidation BUY au Bid, SELL à l’Ask. Slippage et commissions configurés restent appliqués. Aucun spread historique MT5 n’est ajouté ni aucun OHLC transformé.</p>
    <p className="text-xs">Coûts de cet instantané : spread {result.settings.spread.toLocaleString("fr-FR")} $/oz · slippage {result.settings.slippage.toLocaleString("fr-FR")} $/oz/sens · commission {result.settings.commission.toLocaleString("fr-FR")} $/oz/sens.</p>
    {result.dataGaps?.length ? <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm text-primary">{result.dataGaps.length} intervalle(s) sans bougie · aucune interpolation</summary><ul className="mt-3 max-h-64 space-y-2 overflow-auto text-xs">{result.dataGaps.map(g => <li key={g.from}>{mt5FrenchUTC(g.from)} → {mt5FrenchUTC(g.to)} · {g.minutes.toLocaleString("fr-FR")} minute(s), fin exclue</li>)}</ul></details> : <p className="text-xs text-muted-foreground">Aucun intervalle sans bougie dans la plage demandée.</p>}
  </Section>;
}
