import type { BacktestStats, BacktestTrade, EquityPoint } from "./types";

export function calculateStatistics(initialCapital: number, finalCapital: number, trades: BacktestTrade[], equity: EquityPoint[]): BacktestStats {
  const winners = trades.filter(t => t.pnl > 0), losers = trades.filter(t => t.pnl < 0);
  const sum = (values: BacktestTrade[]) => values.reduce((n, t) => n + t.pnl, 0);
  const gains = sum(winners), losses = -sum(losers);
  let win = 0, loss = 0, longestWinStreak = 0, longestLossStreak = 0;
  for (const trade of trades) {
    win = trade.pnl > 0 ? win + 1 : 0; loss = trade.pnl < 0 ? loss + 1 : 0;
    longestWinStreak = Math.max(longestWinStreak, win); longestLossStreak = Math.max(longestLossStreak, loss);
  }
  let peak = initialCapital, maxDrawdownMoney = 0;
  for (const point of equity) { peak = Math.max(peak, point.equity); maxDrawdownMoney = Math.max(maxDrawdownMoney, peak - point.equity); }
  return {
    initialCapital, finalCapital, netPnl: finalCapital - initialCapital, trades: trades.length, winners: winners.length, losers: losers.length, flat: trades.length - winners.length - losers.length,
    winRate: trades.length ? 100 * winners.length / trades.length : null,
    profitFactor: losses > 0 ? gains / losses : gains > 0 ? Infinity : null,
    expectancy: trades.length ? sum(trades) / trades.length : null,
    averageWin: winners.length ? gains / winners.length : null, averageLoss: losers.length ? -losses / losers.length : null,
    averageR: trades.length ? trades.reduce((n, t) => n + t.r, 0) / trades.length : null,
    best: trades.length ? Math.max(...trades.map(t => t.pnl)) : null, worst: trades.length ? Math.min(...trades.map(t => t.pnl)) : null,
    maxDrawdown: Math.max(0, ...equity.map(p => p.drawdown)), maxDrawdownMoney, longestWinStreak, longestLossStreak,
  };
}
