import { INDICATORS, INDICATOR_LABELS, type Strategy } from "@/lib/strategies";
import { ConditionEditor } from "@/components/strategy/ConditionEditor";
import { NumberField, Section, Toggle } from "@/components/strategy/StrategyFields";

export function ScalpingSignalEditor({ signal, onChange }: { signal: Strategy; onChange: (signal: Strategy) => void }) {
  const patch = (update: Partial<Strategy>) => onChange({ ...signal, ...update });
  const parameter = (key: keyof Strategy["parameters"], value: number) => patch({ parameters: { ...signal.parameters, [key]: value } });
  return <div className="space-y-4">
    <Section title="Indicateurs propres au scalping" description="Aucun lien avec les indicateurs de la stratégie H1. EMA 20/50/200 et RSI 14 ont des périodes fixes.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{INDICATORS.map(id => <Toggle key={id} label={INDICATOR_LABELS[id]} checked={signal.indicators[id]} onChange={checked => patch({ indicators: { ...signal.indicators, [id]: checked } })} />)}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {signal.indicators.macd && <>{([ ["macdFast", "MACD rapide"], ["macdSlow", "MACD lent"], ["macdSignal", "MACD signal"] ] as const).map(([key, label]) => <NumberField key={key} label={label} value={signal.parameters[key]} min={2} max={500} onChange={v => parameter(key, v)} />)}</>}
        {signal.indicators.adx && <NumberField label="ADX · période" value={signal.parameters.adxPeriod} min={2} max={500} onChange={v => parameter("adxPeriod", v)} />}
        {signal.indicators.atr && <NumberField label="ATR · période" value={signal.parameters.atrPeriod} min={2} max={500} onChange={v => parameter("atrPeriod", v)} />}
        {signal.indicators.bollinger && <><NumberField label="Bollinger · période" value={signal.parameters.bbPeriod} min={2} max={500} onChange={v => parameter("bbPeriod", v)} /><NumberField label="Bollinger · écarts-types" value={signal.parameters.bbDeviation} min={0.1} max={10} step={0.1} onChange={v => parameter("bbDeviation", v)} /></>}
      </div>
    </Section>
    <ConditionEditor side="BUY" rules={signal.buy} onChange={buy => patch({ buy })} />
    <ConditionEditor side="SELL" rules={signal.sell} onChange={sell => patch({ sell })} />
    <Section title="Validation du signal de scalping" description="Signal sur bougie clôturée uniquement. Confirmations ET confiance requises. BUY et SELL valides simultanément : WAIT. Les conditions de seuil peuvent produire un signal à chaque nouvelle bougie ; les croisements uniquement lors du croisement.">
      <div className="grid gap-3 sm:grid-cols-2"><NumberField label="Confirmations minimales" value={signal.minConfirmations} min={1} max={Math.min(signal.buy.length, signal.sell.length)} onChange={minConfirmations => patch({ minConfirmations })} /><NumberField label="Confiance minimale (%)" value={signal.minConfidence} min={0} max={100} onChange={minConfidence => patch({ minConfidence })} /></div>
    </Section>
  </div>;
}
