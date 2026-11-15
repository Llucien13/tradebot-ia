import y25a from "@/ftmo/reference/resultats/ftmo_20k_2025_tp2p5.json?raw";
import y25b from "@/ftmo/reference/resultats/ftmo_20k_2025_tp5.json?raw";
import y26a from "@/ftmo/reference/resultats/ftmo_20k_2026_tp2p5.json?raw";
import y26b from "@/ftmo/reference/resultats/ftmo_20k_2026_tp5.json?raw";
import stressA from "@/ftmo/reference/resultats/ftmo_20k_2026_tp2p5_spread06.json?raw";
import stressB from "@/ftmo/reference/resultats/ftmo_20k_2026_tp5_spread06.json?raw";
import trades25a from "@/data/ftmo-recorded/2025-2p5.csv.txt?raw";
import trades25b from "@/data/ftmo-recorded/2025-5.csv.txt?raw";
import trades26a from "@/data/ftmo-recorded/2026-2p5.csv.txt?raw";
import trades26b from "@/data/ftmo-recorded/2026-5.csv.txt?raw";

interface Summary {
  year: number; tpR: number; spread: number; net: number; end_balance: number; trades: number;
  max_dd_closed_pct: number; max_dd_ohlc_pct: number; phase2_status: string;
}
interface Phase { phase: number; start: string; end: string; equity: number; trades: number }
export interface RecordedTrade { phase: number; entry: string; exit: string; pnl: number; equity: number }
export interface RecordedScenario { id: string; source: string; summary: Summary; phases: Phase[]; trades: RecordedTrade[] | null }

function parseTrades(text: string): RecordedTrade[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = header.split(",");
  return lines.map(line => {
    const values = line.split(",");
    const get = (key: string) => values[columns.indexOf(key)];
    const trade = { phase: Number(get("phase")), entry: get("entry"), exit: get("exit"), pnl: Number(get("pnl")), equity: Number(get("equity_after")) };
    if (![trade.phase, trade.pnl, trade.equity].every(Number.isFinite) || !/^\d{4}-\d{2}-\d{2} /.test(trade.exit)) throw new Error("Journal FTMO illisible : aucune donnée remplacée.");
    return trade;
  });
}
const inputs = [
  ["2025-2p5", "ftmo_20k_2025_tp2p5", y25a, trades25a],
  ["2025-5", "ftmo_20k_2025_tp5", y25b, trades25b],
  ["2026-2p5", "ftmo_20k_2026_tp2p5", y26a, trades26a],
  ["2026-5", "ftmo_20k_2026_tp5", y26b, trades26b],
  ["2026-2p5-stress", "ftmo_20k_2026_tp2p5_spread06", stressA, null],
  ["2026-5-stress", "ftmo_20k_2026_tp5_spread06", stressB, null],
] as const;
export const recordedScenarios: RecordedScenario[] = inputs.map(([id, source, json, csv]) => {
  const value = JSON.parse(json) as { summary: Summary; phases: Phase[] };
  return { id, source, ...value, trades: csv === null ? null : parseTrades(csv) };
});

export function tradeMetrics(trades: RecordedTrade[]) {
  const winners = trades.filter(t => t.pnl > 0), losers = trades.filter(t => t.pnl < 0);
  const gains = winners.reduce((sum, t) => sum+t.pnl, 0), losses = -losers.reduce((sum, t) => sum+t.pnl, 0);
  return { winners: winners.length, losers: losers.length, flat: trades.length-winners.length-losers.length,
    winRate: trades.length ? winners.length/trades.length*100 : null,
    profitFactor: losses ? gains/losses : gains ? Infinity : null, net: gains-losses };
}

export function dailyRecorded(scenario: RecordedScenario, start: string, months: number) {
  if (!scenario.trades || !/^\d{4}-\d{2}$/.test(start)) return [];
  const from = Date.parse(start+"-01T00:00:00Z");
  if (!Number.isFinite(from)) return [];
  const end = new Date(from); end.setUTCMonth(end.getUTCMonth()+months);
  const first = scenario.phases[0].start.slice(0, 10), last = scenario.phases[scenario.phases.length-1].end.slice(0, 10);
  const rows = [];
  for (let stamp = from; stamp < end.getTime(); stamp += 86400000) {
    const day = new Date(stamp).toISOString().slice(0, 10);
    const trades = scenario.trades.filter(t => t.exit.slice(0, 10) === day);
    const covered = day >= first && day <= last;
    const metrics = tradeMetrics(trades);
    rows.push({ day, covered, ...metrics, trades: trades.length,
      gains: trades.reduce((s, t) => s+Math.max(t.pnl, 0), 0), losses: trades.reduce((s, t) => s+Math.min(t.pnl, 0), 0) });
  }
  return rows;
}

export function recordedWarnings(scenario: RecordedScenario) {
  if (!scenario.trades) return ["Journal détaillé absent : gains/pertes quotidiens, gagnants/perdants, taux de réussite et profit factor indisponibles pour ce scénario."];
  const warnings = [];
  if (scenario.trades.length !== scenario.summary.trades) warnings.push("Nombre de transactions différent de la synthèse archivée.");
  if (Math.abs(tradeMetrics(scenario.trades).net-scenario.summary.net) > .02) warnings.push("Écart de plus de 0,02 € entre somme des transactions et synthèse archivée ; valeurs originales conservées.");
  return warnings;
}
