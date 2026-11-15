import { useState } from "react";
import { NumberField } from "@/components/strategy/StrategyFields";
import { M5CalendarFields } from "./M5CalendarFields";
import type { M5Calendar } from "@/lib/scalping/m5-calendar";
import { V3_RECOVERY_KEY, parseV3Source, type V3MissingField } from "@/lib/scalping/m5-v3-profile";

export function M5V3MissingInputs({ fields, disabled, onError }: { fields: V3MissingField[]; disabled: boolean; onError: (message: string) => void }) {
  const [values, setValues] = useState({ spread: 0, slippage: 0, maxLot: 0 });
  const [calendar, setCalendar] = useState<M5Calendar | null>(null);
  const update = (field: V3MissingField, value: number | M5Calendar | null) => {
    try {
      const source = parseV3Source(localStorage.getItem(V3_RECOVERY_KEY)) ?? {};
      if (field === "calendar") source.calendar = value;
      else if (field === "maxLot") source.broker = { ...source.broker, maxLot: value };
      else source.costs = { ...source.costs, [field]: value };
      localStorage.setItem(V3_RECOVERY_KEY, JSON.stringify(source));
    } catch { onError("Stockage local bloqué : autorisez-le pour conserver uniquement la donnée manquante."); }
  };
  return <fieldset disabled={disabled} className="space-y-4 rounded-2xl border border-primary/30 p-4"><p className="text-sm font-semibold">Compléter uniquement les informations manquantes</p>{fields.filter(f => f !== "calendar").map(field => <NumberField key={field} label={field === "maxLot" ? "Volume maximal XAUUSD-ECN (lots), selon MT5" : field === "spread" ? "Hypothèse spread (USD/oz)" : "Hypothèse slippage (USD/oz/sens)"} value={values[field as "spread" | "slippage" | "maxLot"]} min={field === "maxLot" ? 0.01 : 0} step={0.01} onChange={value => { setValues(v => ({ ...v, [field]: value })); update(field, value); }} />)}{fields.includes("calendar") && <M5CalendarFields value={calendar} disabled={disabled} onChange={value => { setCalendar(value); update("calendar", value); }} />}<p className="text-xs text-muted-foreground">Vos autres paramètres sont conservés. Après saisie, cliquez simplement sur LANCER MON BACKTEST ; compatibilité et enregistrement du profil seront automatiques. Aucun bouton d’enregistrement supplémentaire.</p></fieldset>;
}
