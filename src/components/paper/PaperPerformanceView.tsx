import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { DisplayPeriodFilter } from "@/components/ui/trading/DisplayPeriodFilter";
import { TermHelp } from "@/components/ui/trading/TermHelp";
import { periodStart, uiDate, uiDateTime, exportCSV, type DisplayPeriod } from "@/lib/ui-presentation";
import { usePaperTrading } from "./PaperTradingProvider";
import { paperNumber } from "./PaperLayout";

export function PaperPerformanceView({ exportable = false }: { exportable?: boolean }) {
  const { state } = usePaperTrading();
  const [period, setPeriod] = useState<DisplayPeriod>("all");
  const [chart, setChart] = useState("equity");
  const now = Date.now(), start = periodStart(period, now);
  const trades = state.trades.filter(t => t.exitTime >= start && t.exitTime <= now);
  const gains = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const losses = trades.filter(t => t.pnl < 0).reduce((sum, t) => sum - t.pnl, 0);
  const pnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = trades.length ? trades.filter(t => t.pnl > 0).length / trades.length * 100 : null;
  const observed = state.equity.filter(p => p.time >= start && p.time <= now);
  let cumulative = 0;
  const closed = [...state.trades].sort((a, b) => a.exitTime - b.exitTime).map(t => { cumulative += t.pnl; return { time: t.exitTime, value: cumulative, pnl: t.pnl }; }).filter(p => p.time >= start && p.time <= now);
  const points = chart === "equity" ? observed.map(p => ({ time: p.time, value: p.equity })) : chart === "drawdown" ? observed.map(p => ({ time: p.time, value: p.drawdown })) : chart === "recent" ? closed.map(p => ({ time: p.time, value: p.pnl })) : closed;
  const shared = <><CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" /><XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={uiDate} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} /><YAxis domain={["auto", "auto"]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} /><Tooltip labelFormatter={value => uiDateTime(Number(value))} formatter={value => [paperNumber(Number(value)), chart === "drawdown" ? "% observé" : "€"]} contentStyle={{ background: "hsl(var(--card))", color: "hsl(var(--foreground))", borderColor: "hsl(var(--border))", borderRadius: 12 }} /></>;
  return <section className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Performances observées">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Performances · PAPER</h2><DisplayPeriodFilter value={period} onChange={setPeriod} /></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Trades clôturés", String(trades.length)], ["P&L net (€)", state.account ? paperNumber(pnl) : "—"], ["Taux de réussite", winRate === null ? "—" : `${paperNumber(winRate)} %`], ["Profit Factor", !trades.length ? "—" : losses ? paperNumber(gains / losses) : gains ? "∞" : "—"]].map(([label, value]) => <div key={label} className="min-w-0 rounded-xl bg-background/50 p-3"><p className="text-xs text-muted-foreground">{label}{label.includes("P&L") && <TermHelp term="P&L" />}{label === "Profit Factor" && <TermHelp term="Profit Factor" />}</p><p className={`mt-2 break-words font-mono text-lg font-semibold ${label.includes("P&L") ? pnl > 0 ? "text-emerald-300" : pnl < 0 ? "text-rose-300" : "" : ""}`}>{value}</p></div>)}</div>
    {!trades.length && <p className="text-xs text-muted-foreground">Aucun trade clôturé sur cette période.</p>}
    <div className="flex flex-wrap gap-1.5">{[["equity", "Equity"], ["cumulative", "P&L cumulé"], ["recent", "Performance récente"], ["drawdown", "Drawdown"]].map(([key, label]) => <Button key={key} type="button" variant="outline" aria-pressed={chart === key} onClick={() => setChart(key)} className={`h-10 rounded-xl px-3 text-xs ${chart === key ? "border-primary/30 bg-primary/10 text-primary" : "text-muted-foreground"}`}>{label}</Button>)}<TermHelp term={chart === "equity" ? "Equity" : chart === "drawdown" ? "Drawdown" : "P&L"} /></div>
    {points.length ? <div className="h-64 min-w-0 sm:h-72"><ResponsiveContainer width="100%" height="100%">{chart === "recent" ? <BarChart data={points}>{shared}<Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} isAnimationActive={false} /></BarChart> : <LineChart data={points}>{shared}<Line dataKey="value" type={chart === "cumulative" ? "stepAfter" : "linear"} stroke={chart === "drawdown" ? "hsl(var(--destructive))" : "hsl(var(--primary))"} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} /></LineChart>}</ResponsiveContainer></div> : <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Aucune donnée disponible pour ce graphique et cette période.</p>}
    <p className="text-[11px] leading-relaxed text-muted-foreground">Lecture du registre existant uniquement. Equity et drawdown : relevés de session observés. P&L cumulé : gains/pertes clôturés de la session ; le filtre ne remet pas le cumul à zéro. Aucun point de marché ou jour manquant n’est créé.</p>
    {exportable && <Button type="button" variant="outline" disabled={!trades.length} className="h-11 rounded-xl border-primary/25 text-primary" onClick={() => exportCSV("tradebot-statistiques-paper.csv", ["Sortie UTC", "Unité", "Sens", "PnL EUR", "R", "Source"], trades.map(t => [uiDateTime(t.exitTime), t.timeframe, t.direction, t.pnl, t.r, t.source]))}>Exporter CSV · période affichée</Button>}
  </section>;
}
