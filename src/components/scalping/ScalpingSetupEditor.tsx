import { NumberField, Toggle, Section } from "@/components/strategy/StrategyFields";
import type { ScalpingSetup } from "@/lib/scalping/model";
export function ScalpingSetupEditor({ value, onChange }: { value: ScalpingSetup; onChange: (value: ScalpingSetup) => void }) {
  const patch = (update: Partial<ScalpingSetup>) => onChange({ ...value, ...update });
  return <Section title="Signaux M1 · indicateurs et filtres" description="Seuls les filtres activés doivent être satisfaits. SELL utilise la zone RSI symétrique (100 − maximum à 100 − minimum). Un signal ambigu BUY et SELL n’autorise aucune entrée.">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{([
      ["trend", "EMA rapide > médiane (BUY)"], ["slowTrend", "EMA médiane > lente (BUY)"], ["priceFilter", "Clôture au-dessus EMA médiane (BUY)"],
      ["rsiFilter", "Zone RSI"], ["adxFilter", "Force ADX minimum"], ["atrFilter", "Volatilité ATR minimum"],
    ] as const).map(([key, label]) => <Toggle key={key} label={label} checked={value[key]} onChange={v => patch({ [key]: v })} />)}</div>
    <fieldset className="space-y-3 rounded-xl border border-border p-4">
      <legend className="px-2 text-sm font-semibold">Analyse de prix optionnelle · désactivée par défaut</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{([
        ["candlePatternFilter", "Englobante, marteau, étoile filante ou mèche de rejet"],
        ["trendlineFilter", "Rejet sur ligne de tendance automatique"],
        ["supportResistanceFilter", "Rejet sur support / résistance"],
        ["structureFilter", "Structure haussière / baissière"],
        ["breakoutFilter", "Cassure à la clôture"],
        ["retestFilter", "Retest après cassure"],
      ] as const).map(([key, label]) => <Toggle key={key} label={label} checked={value[key] ?? false} onChange={v => patch({ [key]: v })} />)}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">Figures directionnelles BUY/SELL, confirmées par les filtres EMA, RSI, ADX et ATR existants. Sommets/creux stricts avec 2 bougies de chaque côté : utilisables seulement après les 2 clôtures de confirmation, sans signal rétroactif. Lignes sur les 2 derniers pivots confirmés ; niveaux sur les derniers sommets/creux. Tolérance : 0,3 ATR. Retest : dans les 10 bougies suivant la cassure, sur son niveau figé. Les filtres s’ajoutent entre eux ; Cassure + Retest accepte l’un OU l’autre. Une combinaison trop restrictive peut supprimer tous les signaux. Aucun enregistrement ou calcul sans action explicite.</p>
    </fieldset>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{([
      ["emaFast", "Période EMA rapide", 2, 100, 1], ["emaMiddle", "Période EMA médiane", 3, 150, 1], ["emaSlow", "Période EMA lente", 5, 200, 1],
      ["rsiPeriod", "Période RSI", 2, 50, 1], ["atrPeriod", "Période ATR", 2, 50, 1], ["adxPeriod", "Période ADX", 2, 50, 1],
      ["rsiMin", "RSI minimum BUY", 0, 100, 1], ["rsiMax", "RSI maximum BUY", 0, 100, 1],
      ["adxMin", "ADX minimum", 0, 100, 1], ["atrMin", "ATR minimum ($/oz)", 0, 100, 0.01],
      ["rewardRisk", "Ratio net gain / risque minimum", 0.5, 5, 0.1],
    ] as const).map(([key, label, min, max, step]) => <NumberField key={key} label={label} value={value[key]} min={min} max={max} step={step} onChange={v => patch({ [key]: v })} />)}</div>
  </Section>;
}
