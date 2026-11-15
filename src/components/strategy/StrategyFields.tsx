import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block space-y-2 text-sm"><span className="font-medium">{label}</span>{children}{hint && <span className="block text-xs leading-relaxed text-muted-foreground">{hint}</span>}</label>;
}
export function NumberField({ label, value, onChange, min, max, step = 1, hint }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; hint?: string }) {
  return <Field label={label} hint={hint}><Input type="number" value={Number.isFinite(value) ? value : ""} onChange={e => onChange(e.target.valueAsNumber)} min={min} max={max} step={step} className="h-11 rounded-xl bg-background/60 font-mono" /></Field>;
}
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-background/40 px-4 py-3 text-sm"><span>{label}</span><Switch checked={checked} onCheckedChange={onChange} aria-label={label} className="data-[state=checked]:bg-primary" /></label>;
}
export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-6"><div><h2 className="font-semibold">{title}</h2>{description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}</div>{children}</section>;
}
export const selectClass = "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary";
export const actionClass = "h-11 rounded-xl px-4 text-sm font-medium";
