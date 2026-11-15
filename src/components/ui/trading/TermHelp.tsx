import { useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const terms: Record<string, string> = {
  "P&L": "Gain ou perte. Net signifie que les frais simulés sont déduits.",
  Equity: "Capital valorisé, incluant le gain ou la perte des positions encore ouvertes.",
  Drawdown: "Baisse du capital par rapport à son plus haut observé.",
  "Profit Factor": "Total des gains divisé par la valeur absolue des pertes.",
  Expectancy: "Gain ou perte net moyen par trade clôturé.",
  R: "Gain ou perte net rapporté au risque monétaire initial du trade.",
  Spread: "Écart entre le prix d’achat Ask et le prix de vente Bid.",
  Slippage: "Écart défavorable simulé entre le prix prévu et le prix exécuté.",
  Paper: "Trading simulé sur données de marché, sans ordre réel.",
  Backtest: "Simulation des règles sur un historique passé, sans ordre réel.",
  "Stop Loss": "Niveau de sortie prévu pour limiter la perte. Un gap peut le dépasser.",
  "Take Profit": "Niveau de sortie prévu pour prendre un gain.",
};
export function TermHelp({ term, explanation }: { term: string; explanation?: string }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" aria-label={`Comprendre ${term}`} onPointerEnter={event => { if (event.pointerType === "mouse") setOpen(true); }} onPointerLeave={event => { if (event.pointerType === "mouse") setOpen(false); }} className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg align-middle text-muted-foreground hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Info className="h-3.5 w-3.5" /></button></PopoverTrigger><PopoverContent onMouseLeave={() => setOpen(false)} className="max-w-[calc(100vw-2rem)] rounded-xl border-primary/25 bg-popover p-3 text-xs leading-relaxed shadow-xl">{explanation ?? terms[term] ?? term}</PopoverContent></Popover>;
}
