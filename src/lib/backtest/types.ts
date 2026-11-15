import type { Candle } from "@/types";
import type { Strategy, TIMEFRAMES } from "@/lib/strategies";

export type BacktestTimeframe = typeof TIMEFRAMES[number];
export const INTERVAL_MS: Record<BacktestTimeframe, number> = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000 };
export interface BacktestSettings {
  timeframe: BacktestTimeframe;
  start: number;
  end: number;
  initialCapital: number;
  spread: number;
  slippage: number;
  commission: number;
}
export interface HistoricalData {
  source: "TWELVE_DATA";
  candles: Candle[];
  fetchedAt: string;
  cached: boolean;
  warnings: string[];
}
export interface StopChange { time: number; oldSL: number; newSL: number; reason: "Break-even" | "Trailing ATR" }
export interface BacktestTrade {
  id: number;
  entryTime: number;
  exitTime: number;
  direction: "BUY" | "SELL";
  entry: number;
  exit: number;
  initialSL: number;
  initialTP: number;
  stopChanges: StopChange[];
  exitReason: "Stop Loss" | "Break-even" | "Trailing ATR" | "Take Profit" | "Fin de période";
  quantity: number;
  riskMoney: number;
  spread: number;
  slippage: number;
  commission: number;
  pnl: number;
  r: number;
  durationMinutes: number;
  confidence: number;
  conditions: string[];
  signalTime: number;
}
export interface EquityPoint { time: number; equity: number; drawdown: number }
export interface BacktestStats {
  initialCapital: number; finalCapital: number; netPnl: number; trades: number; winners: number; losers: number; flat: number;
  winRate: number | null; profitFactor: number | null; expectancy: number | null; averageWin: number | null; averageLoss: number | null;
  averageR: number | null; best: number | null; worst: number | null; maxDrawdown: number; maxDrawdownMoney: number;
  longestWinStreak: number; longestLossStreak: number;
}
export interface BacktestResult {
  strategy: Strategy;
  settings: BacktestSettings;
  trades: BacktestTrade[];
  equity: EquityPoint[];
  stats: BacktestStats;
  controls: { candles: number; warmup: number; first: number; last: number; buySignals: number; sellSignals: number; waits: number; executed: number; ambiguousBars: number; skippedEntries: number };
  history: Omit<HistoricalData, "candles">;
}
export function warmupBars(strategy: Strategy) {
  return Math.max(200, 15, strategy.parameters.macdSlow + strategy.parameters.macdSignal, 2 * strategy.parameters.adxPeriod, strategy.parameters.atrPeriod + 1, strategy.parameters.bbPeriod, strategy.stopLoss.structureLookback) + 2;
}
