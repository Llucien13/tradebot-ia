import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELDS, FIELD_LABELS, OPERATORS, OPERATOR_LABELS, newCondition, type Condition } from "@/lib/strategies";
import { Field, Section, selectClass, actionClass } from "./StrategyFields";

export function ConditionEditor({ side, rules, onChange }: { side: "BUY" | "SELL"; rules: Condition[]; onChange: (rules: Condition[]) => void }) {
  const update = (id: string, patch: Partial<Condition>) => onChange(rules.map(rule => rule.id === id ? { ...rule, ...patch } : rule));
  return <Section title={`Conditions ${side}`} description="Chaque condition satisfaite vaut une confirmation. Les croisements comparent la bougie précédente à la bougie courante.">
    <div className="space-y-3">
      {rules.map((rule, index) => <div key={rule.id} className="grid items-end gap-3 rounded-xl border border-border bg-secondary/20 p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <Field label={`Condition ${index + 1} · valeur`}><select aria-label={`${side} ${index + 1} valeur`} className={selectClass} value={rule.left} onChange={e => update(rule.id, { left: e.target.value as Condition["left"] })}>{FIELDS.map(field => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}</select></Field>
        <Field label="Comparaison"><select aria-label={`${side} ${index + 1} comparaison`} className={selectClass} value={rule.operator} onChange={e => update(rule.id, { operator: e.target.value as Condition["operator"] })}>{OPERATORS.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}</select></Field>
        <Field label="Comparer à"><select aria-label={`${side} ${index + 1} type de référence`} className={selectClass} value={rule.rightType} onChange={e => update(rule.id, { rightType: e.target.value as Condition["rightType"] })}><option value="field">Indicateur / clôture</option><option value="value">Seuil numérique</option></select></Field>
        <Field label="Référence">{rule.rightType === "field" ? <select aria-label={`${side} ${index + 1} référence`} className={selectClass} value={rule.rightField} onChange={e => update(rule.id, { rightField: e.target.value as Condition["rightField"] })}>{FIELDS.map(field => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}</select> : <Input aria-label={`${side} ${index + 1} seuil`} type="number" step="any" value={Number.isFinite(rule.value) ? rule.value : ""} onChange={e => update(rule.id, { value: e.target.valueAsNumber })} className="h-11 rounded-xl bg-background font-mono" />}</Field>
        <Button type="button" variant="outline" className={`${actionClass} text-destructive hover:bg-destructive/10`} aria-label={`Supprimer la condition ${side} ${index + 1}`} onClick={() => onChange(rules.filter(item => item.id !== rule.id))}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
      {!rules.length && <p className="text-sm text-muted-foreground">Ajoutez au moins une condition pour ce sens.</p>}
    </div>
    <Button type="button" variant="outline" disabled={rules.length >= 30} className={`${actionClass} border-primary/30 text-primary hover:bg-primary/10`} onClick={() => onChange([...rules, newCondition("price", "ema20", side === "BUY" ? "gt" : "lt")])}><Plus className="mr-2 h-4 w-4" />Ajouter une condition {side}</Button>
  </Section>;
}
