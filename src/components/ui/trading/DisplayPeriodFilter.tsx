import { Button } from "@/components/ui/button";
import type { DisplayPeriod } from "@/lib/ui-presentation";
export function DisplayPeriodFilter({ value, onChange }: { value: DisplayPeriod; onChange: (value: DisplayPeriod) => void }) {
  return <div aria-label="Période affichée" className="flex flex-wrap gap-1.5">{([['today', 'Aujourd’hui'], ['7', '7 jours'], ['30', '30 jours'], ['all', 'Tout']] as const).map(([key, label]) => <Button key={key} type="button" variant="outline" aria-pressed={value === key} onClick={() => onChange(key)} className={`h-10 rounded-xl px-3 text-xs ${value === key ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15' : 'border-border bg-transparent text-muted-foreground'}`}>{label}</Button>)}</div>;
}
