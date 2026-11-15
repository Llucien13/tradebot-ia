import type { ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Target } from "lucide-react";
import { useMonitor } from "./MonitorLayout";

export const money = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
export const number = (v: number | null | undefined, suffix = "") => v == null ? "—" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}${suffix}`;
export const date = (v: number | null | undefined, zone = "Europe/Paris") => v == null ? "—" : new Intl.DateTimeFormat("fr-FR", { timeZone: zone, dateStyle: "short", timeStyle: "medium" }).format(new Date(v*1000));
export const tone = (v: number | null | undefined) => v == null || v === 0 ? "text-slate-100" : v > 0 ? "text-emerald-300" : "text-rose-300";
export function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold tracking-tight">{title}</h2>{aside}</div>{children}</section>;
}
export function Metric({ label, value, hint, color = "" }: { label: string; value: ReactNode; hint?: string; color?: string }) {
  return <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-xs text-slate-400">{label}</p><p className={`mt-3 break-words text-2xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</p>{hint && <p className="mt-2 text-xs leading-relaxed text-slate-400">{hint}</p>}</div>;
}
export function PositionCard() {
  const { data, fresh, now, connected } = useMonitor();
  const p = data?.position;
  if (!data) return <Panel title="Position en cours"><p className="text-sm text-slate-400">Registre indisponible. L’absence de données ne signifie pas qu’aucune position n’est ouverte.</p></Panel>;
  if (!p) return <Panel title="Position en cours"><div className="flex flex-col items-center rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center"><Target className="mb-4 text-slate-500" size={32} /><p className="font-medium">{connected ? "Aucune position PAPER ouverte" : "Aucune position au dernier relevé"}</p><p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">Le moteur attend ses conditions GOLD M15. Le monitoring ne force aucune entrée.</p></div></Panel>;
  const price = data.quote?.bid;
  const net = fresh ? p.netPositionEUR : null;
  const seconds = Math.max(0, Math.floor(now-p.entryTime));
  const duration = `${Math.floor(seconds/3600)} h ${Math.floor(seconds%3600/60)} min ${seconds%60} s`;
  const fields = [
    ["Entrée", number(p.entry, " USD")], ["Dernier BID connu", number(price, " USD")],
    ["Stop-loss", number(p.sl, " USD")], ["Take-profit", number(p.tp, " USD")],
    ["Distance signée au SL (BID)", price == null ? "—" : number((price-p.sl)*p.side, " USD")],
    ["Distance signée au TP (BID)", price == null ? "—" : number((p.tp-price)*p.side, " USD")],
    ["Volume", number(p.lots, " lots")], ["Risque initial prévu", `${money(p.riskEUR)} · ${number(p.riskPercentInitial, " % du capital initial")}`],
    ["Exposition latente hors frais d’entrée", fresh ? money(p.floatingEUR) : "Indisponible"],
    ["P&L position / capital initial", fresh ? number(p.percentInitial, " %") : "—"],
    ["Multiple R net observé", fresh ? number(p.r, " R") : "—"], ["Durée depuis l’entrée", duration],
  ];
  return <Panel title="Position en cours" aside={<span className={`rounded-full px-3 py-1.5 text-xs ${fresh && !p.needsReview ? "bg-cyan-400/10 text-cyan-300" : "bg-amber-400/10 text-amber-200"}`}>{!connected ? "État non confirmé" : p.needsReview ? "À vérifier · conservée" : fresh ? "Suivie · PAPER" : "Valorisation obsolète"}</span>}>
    <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xl font-semibold">XAUUSD <span className={`ml-2 text-sm ${p.side === 1 ? "text-emerald-300" : "text-rose-300"}`}>{p.side === 1 ? "ACHAT" : "VENTE"}</span></p><p className="mt-2 break-all font-mono text-xs text-slate-400">{p.id}</p><p className="mt-2 text-xs text-slate-400">Entrée {date(p.entryTime)} · Europe/Paris</p><p className="mt-1 text-xs text-slate-400">{date(p.entryTime, "UTC")} UTC</p></div><div className="text-left sm:text-right"><p className="text-xs text-slate-400">P&L net de la position · frais d’entrée inclus</p><p className={`mt-2 text-3xl font-semibold tabular-nums ${tone(net)}`}>{money(net)}</p>{!fresh && <p className="mt-2 text-xs text-amber-200">Aucun P&L présenté comme actuel</p>}</div></div>
    <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-5 border-t border-slate-800 pt-5 min-[390px]:grid-cols-2 lg:grid-cols-3">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs leading-relaxed text-slate-400">{label}</dt><dd className="mt-1 break-words text-sm font-medium tabular-nums">{value}</dd></div>)}</dl>
    <div className="mt-5 space-y-2 rounded-xl bg-slate-800/50 p-4 text-xs leading-relaxed text-slate-300"><p>Motif d’entrée : {p.entryReason || "non enregistré par le moteur V85 — aucune justification reconstituée."}</p><p>Dernière cotation : {date(data.quote?.time)} Europe/Paris · {fresh ? "deux ticks frais (0–15 s)" : "données anciennes ou non certifiables"}.</p><p>Distances en USD par once sur le dernier BID, pas une estimation d’exécution. Pour une vente, la valorisation du moteur utilise l’ASK et ses coûts. Un R = risque initial enregistré.</p></div>
  </Panel>;
}
export function EquityChart() {
  const { data } = useMonitor();
  const points = data?.metrics.curve ?? [];
  return <Panel title="Capital virtuel observé" aside={<span className="text-xs text-slate-400">Equity · EUR · Europe/Paris</span>}>
    {points.length > 1 ? <div className="h-64 w-full min-w-0" role="img" aria-label={`Courbe de ${data?.metrics.curveSamples} observations réelles d’equity. Dernière valeur ${money(points[points.length-1].equity)}.`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{ left: -16, right: 8, top: 10, bottom: 0 }}><CartesianGrid stroke="#253248" vertical={false} /><XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={t => new Date(t*1000).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" })} tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={50} /><YAxis domain={["auto", "auto"]} tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} /><Tooltip labelFormatter={v => date(Number(v))} formatter={v => [money(Number(v)), "Equity observée"]} contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12, color: "#f1f5f9" }} /><Area type="linear" dataKey="equity" stroke="#67e8f9" strokeWidth={2} fill="#22d3ee" fillOpacity={0.06} isAnimationActive={false} connectNulls={false} /></AreaChart></ResponsiveContainer></div> : <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">Pas encore assez d’observations réelles pour tracer une courbe.</div>}
    <p className="mt-4 text-xs leading-relaxed text-slate-400">Aucune interpolation des excursions manquées. {data?.metrics.curveSamples ?? 0} observations disponibles ; affichage condensé avec conservation des extrêmes. {data && !data.health.continuous && "Suivi interrompu : cette courbe ne prouve pas la continuité de surveillance."}</p>
  </Panel>;
}
