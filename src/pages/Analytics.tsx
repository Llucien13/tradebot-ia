import { PaperPerformanceView } from "@/components/paper/PaperPerformanceView";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Section } from "@/components/strategy/StrategyFields";
import { usePaperTrading } from "@/components/paper/PaperTradingProvider";
import { PaperLayout, PaperEmpty, paperUtc, paperNumber } from "@/components/paper/PaperLayout";
import { PaperMetrics } from "@/components/paper/PaperAccountPanel";
import { PaperMonthlyGoal } from "@/components/paper/PaperMonthlyGoal";

export default function Analytics() {
  const { state, statistics } = usePaperTrading();
  const s = statistics;
  return <PaperLayout title="Statistiques · PAPER" description="Statistiques calculées uniquement à partir des trades simulés du registre partagé. Aucun résultat de backtest, mock ou graphique aléatoire n’est importé.">
    <PaperPerformanceView exportable />
    <details className="min-w-0 rounded-2xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold text-primary">Détails · statistiques de session et objectif</summary><div className="mt-5 min-w-0 space-y-5">
    <PaperMonthlyGoal />
    <PaperMetrics />
    {!state.trades.length || !s ? <PaperEmpty title="Aucune performance de trading à analyser" description="Aucun trade virtuel n’a encore été clôturé par le moteur. Les statistiques de performance et graphiques restent vides ; le capital saisi du compte n’est pas un gain." /> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Trades clôturés", String(s.trades)], ["Gagnants / perdants / neutres", `${s.winners} / ${s.losers} / ${s.flat}`], ["Win rate calculé", `${paperNumber(s.winRate)}%`], ["Profit factor", paperNumber(s.profitFactor)], ["Expectancy (€/trade)", paperNumber(s.expectancy)], ["Gain moyen (€)", paperNumber(s.averageWin)], ["Perte moyenne (€)", paperNumber(s.averageLoss)], ["R moyen net", paperNumber(s.averageR)], ["Meilleur trade (€)", paperNumber(s.best)], ["Pire trade (€)", paperNumber(s.worst)], ["Série max gains / pertes", `${s.longestWinStreak} / ${s.longestLossStreak}`], ["PnL clôturé net (€)", paperNumber(state.trades.reduce((sum, t) => sum + t.pnl, 0))]].map(([label, value]) => <div key={label} className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-words font-mono text-xl font-semibold">{value}</p></div>)}</div>
      <div className="grid gap-5 xl:grid-cols-2">{(["equity", "drawdown"] as const).map(field => <Section key={field} title={field === "equity" ? "Equity réellement calculée (€)" : "Drawdown observé (%)"} description="Valorisations observées sur les bougies réelles, coûts simulés de liquidation inclus. Aucun point intermédiaire n’est inventé."><div className="h-72 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={state.equity}><CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" /><XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={t => paperUtc(Number(t)).slice(0, 10)} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} /><YAxis domain={["auto", "auto"]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} /><Tooltip labelFormatter={t => paperUtc(Number(t))} formatter={v => [paperNumber(Number(v)), field === "equity" ? "Equity (€)" : "Drawdown (%)"]} contentStyle={{ background: "hsl(var(--card))", color: "hsl(var(--foreground))", borderColor: "hsl(var(--border))", borderRadius: 12 }} /><Line dataKey={field} type="linear" stroke={field === "equity" ? "hsl(var(--primary))" : "hsl(var(--destructive))"} dot={false} strokeWidth={2} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></Section>)}</div>
      <p className="text-xs text-muted-foreground">Résultats paper trading calculés sur les données Twelve Data — ne garantissent pas les performances futures. Le drawdown mesure les valorisations observées, pas les ticks non disponibles.</p>
    </>}
    </div></details>
  </PaperLayout>;
}
