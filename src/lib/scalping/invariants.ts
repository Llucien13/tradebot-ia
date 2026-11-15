import { defaultScalping } from "./model";
import { burstSizing, executionLevels, executionExitQuote, safeScalpingConfig } from "./safety";
import { scalpingIndicators, scalpingSignal } from "./signals";

// Deterministic arithmetic/signal checks, not a historical backtest or an optimization.
export function checkScalpingInvariants(): string[] {
  const errors: string[] = [];
  const check = (condition: boolean, label: string) => { if (!condition) errors.push(label); };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-8;
  const config = safeScalpingConfig({ ...defaultScalping(), maxPositionsPerBurst: 10, burstRiskPercent: 100, individualLoss: 0.5, dailyLoss: 500 });
  const size = burstSizing(300, 9, config, 0.05, 0.02);
  check(near(size.budget, 3) && size.count === 3 && near(size.unitRisk, 0.5) && size.unitRisk * size.count <= size.budget, "Budget agrégé 300 $");
  const limited = burstSizing(300, 0.4, config, 0.05, 0.02);
  check(near(limited.unitRisk * limited.count, 0.4), "Reste de perte quotidienne");
  check(burstSizing(0, 9, config, 0.05, 0.02).count === 0, "Aucune entrée sans capital");
  for (const bidPrices of [true, false]) for (const sign of [1, -1]) {
    const levels = executionLevels(2000, sign, bidPrices, 0.3, 0.05, 0.02, 1, size.quantity, 1.5);
    const pnl = (exit: number) => sign * (exit - levels.entry) * size.quantity - 2 * size.quantity * 0.02;
    check(near(pnl(levels.sl - sign * 0.05), -size.unitRisk), `SL net ${sign}/${bidPrices}`);
    check(near(pnl(levels.tp - sign * 0.05), 1.5), `TP net ${sign}/${bidPrices}`);
    check(near(pnl(executionExitQuote(2000, sign, 0.3, bidPrices) - sign * 0.05), -size.quantity * (0.3 + 0.1 + 0.04)), `Spread et frais ${sign}/${bidPrices}`);
  }
  const row = { open: 2001, close: 2001.5, high: 2001.7, low: 2000.9, fast: 2001.3, middle: 2001, slow: 2000.5, previousFast: 2001.2, previousMiddle: 2000.9, atr: 1, adx: 25, rsi: 60 };
  check(scalpingSignal(row, config.setup)?.direction === "BUY", "Signal BUY directionnel");
  const mirror = { ...row, open: 4000 - row.open, close: 4000 - row.close, high: 4000 - row.low, low: 4000 - row.high, fast: 4000 - row.fast, middle: 4000 - row.middle, slow: 4000 - row.slow, previousFast: 4000 - row.previousFast, previousMiddle: 4000 - row.previousMiddle, rsi: 40 };
  check(scalpingSignal(mirror, config.setup)?.direction === "SELL", "Symétrie SELL");
  check(scalpingSignal({ ...row, open: row.close }, config.setup) === null, "Doji refusé");
  check(scalpingSignal({ ...row, adx: 5 }, config.setup) === null, "Marché sans tendance refusé");
  check(scalpingSignal({ ...row, close: 2005 }, config.setup) === null, "Poursuite éloignée refusée");
  const candle = { time: 60000, open: 2000, high: 2001, low: 1999, close: 2000, volume: 1 };
  const rows = scalpingIndicators([candle, { ...candle, time: 240000 }], config.setup);
  check(rows.length === 2 && rows[1].previousFast === null && rows[1].fast === null, "Indicateurs réinitialisés après lacune");
  return errors;
}
