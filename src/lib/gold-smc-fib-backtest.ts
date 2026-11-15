import type { FibCandle } from "./fibonacci-shadow.ts";
import {
  GOLD_SMC_FIB_EXPERIMENTAL_RULES,
  analyzeExperimentalGoldSmcFib,
  type ExperimentalSignal,
  type ExperimentalVariant,
} from "./gold-smc-fib-experimental.ts";

export interface FxBar {
  time: number;
  close: number;
}

export interface GoldSimulationTrade {
  variant: ExperimentalVariant;
  entryTime: number;
  exitTime: number;
  direction: "BUY" | "SELL";
  entry: number;
  exit: number;
  stop: number;
  target: number;
  lots: number;
  feesUSD: number;
  fxEntry: number;
  fxExit: number;
  pnlEUR: number;
  equityEUR: number;
  reason: "SL" | "TP" | "TIME";
}

export interface GoldSimulationOptions {
  startTime: number;
  endTime: number;
  initialCapitalEUR: number;
  riskPercent: number;
  stopATRMultiple: number;
  takeProfitR: number;
  expiryBars: number;
  contractOunces: number;
  leverage: number;
  minLots: number;
  lotStep: number;
  spreadUSD: number;
  slippagePerSideUSD: number;
  commissionPerSidePerLotUSD: number;
}

export const DEFAULT_GOLD_SIMULATION_OPTIONS: GoldSimulationOptions = {
  startTime: Date.UTC(2026, 0, 1),
  endTime: Date.UTC(2026, 9, 10),
  initialCapitalEUR: 20_000,
  riskPercent: 0.5,
  stopATRMultiple: 2.5,
  takeProfitR: 2.5,
  expiryBars: 48,
  contractOunces: 100,
  leverage: 20,
  minLots: 0.01,
  lotStep: 0.01,
  spreadUSD: 0.3,
  slippagePerSideUSD: 0.05,
  commissionPerSidePerLotUSD: 3,
};

function floorStep(value: number, step: number): number {
  return Math.floor((value + 1e-9) / step) * step;
}

function fxAtOrBefore(fxBars: FxBar[], completedFxBars: number[], time: number): number | null {
  let low = 0;
  let high = completedFxBars.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (completedFxBars[middle] <= time) low = middle + 1;
    else high = middle;
  }
  return low ? fxBars[low - 1].close : null;
}

function maxDrawdown(equity: number, peak: number): number {
  return peak > 0 ? (peak - equity) / peak : 0;
}

export function runGoldSmcFibSimulation(
  candles: FibCandle[],
  fxBars: FxBar[],
  variant: ExperimentalVariant,
  options: GoldSimulationOptions = DEFAULT_GOLD_SIMULATION_OPTIONS,
) {
  if (!candles.length || !fxBars.length) throw new Error("Historique GOLD et conversion FX requis.");
  if (!candles.every((candle, index) =>
    [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    && candle.open > 0
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close)
    && (index === 0 || candle.time > candles[index - 1].time),
  )) throw new Error("Bougies M15 invalides ou non triées.");
  if (!fxBars.every((bar, index) =>
    Number.isFinite(bar.time) && Number.isFinite(bar.close) && bar.close > 0
    && (index === 0 || bar.time > fxBars[index - 1].time),
  )) throw new Error("Historique EUR/USD invalide ou non trié.");
  if (Object.values(options).some(value => !Number.isFinite(value))
    || options.initialCapitalEUR <= 0 || options.riskPercent <= 0
    || options.stopATRMultiple <= 0 || options.takeProfitR <= 0
    || options.expiryBars <= 0 || options.contractOunces <= 0
    || options.leverage <= 0 || options.minLots <= 0 || options.lotStep <= 0) {
    throw new Error("Paramètres de simulation invalides.");
  }

  const analysis = analyzeExperimentalGoldSmcFib(candles);
  if (!analysis) throw new Error("Analyse SMC + Fibonacci expérimentale invalide.");
  const completedFxBars = fxBars.map(bar => bar.time);
  let equity = options.initialCapitalEUR;
  let peakClosed = equity;
  let peakIntrabar = equity;
  let maxClosedDrawdown = 0;
  let maxIntrabarDrawdown = 0;
  let rejectedRisk = 0;
  let rejectedFx = 0;
  const trades: GoldSimulationTrade[] = [];
  const pendingSignals: { index: number; signal: ExperimentalSignal }[] = [];
  let index = 0;

  while (index < candles.length - 1) {
    if (candles[index].time < options.startTime || candles[index].time >= options.endTime) {
      index++;
      continue;
    }
    const signal = analysis.signals[variant][index];
    if (!signal) {
      index++;
      continue;
    }

    const entryIndex = index + 1;
    if (candles[entryIndex].time >= options.endTime) {
      pendingSignals.push({ index, signal });
      break;
    }
    const entryBar = candles[entryIndex];
    const fxEntry = fxAtOrBefore(fxBars, completedFxBars, entryBar.time);
    if (!fxEntry) {
      rejectedFx++;
      index++;
      continue;
    }
    const direction = signal.direction === "BUY" ? 1 : -1;
    const entry = entryBar.open;
    const stopDistance = options.stopATRMultiple * signal.atr14;
    const stop = entry - direction * stopDistance;
    const target = entry + direction * stopDistance * options.takeProfitR;
    const feePerLot = (options.spreadUSD + 2 * options.slippagePerSideUSD) * options.contractOunces
      + 2 * options.commissionPerSidePerLotUSD;
    const riskBudgetUSD = equity * options.riskPercent / 100 * fxEntry;
    const riskLots = riskBudgetUSD / (stopDistance * options.contractOunces + feePerLot);
    const marginLots = equity * options.leverage * fxEntry / (entry * options.contractOunces);
    const lots = floorStep(Math.min(riskLots, marginLots), options.lotStep);
    if (lots + 1e-9 < options.minLots) {
      rejectedRisk++;
      index++;
      continue;
    }

    let exitIndex = -1;
    let exitPrice = entry;
    let reason: GoldSimulationTrade["reason"] = "TIME";
    let worstOpenEquity = equity;
    const expiryIndex = entryIndex + options.expiryBars - 1;
    const finalHoldingIndex = Math.min(candles.length - 1, expiryIndex);
    for (let cursor = entryIndex; cursor <= finalHoldingIndex; cursor++) {
      const bar = candles[cursor];
      if (bar.time + 15 * 60 * 1000 > options.endTime) break;
      const fxMark = fxAtOrBefore(fxBars, completedFxBars, bar.time);
      if (!fxMark) {
        rejectedFx++;
        break;
      }
      const adversePrice = direction === 1 ? bar.low : bar.high;
      const favorablePrice = direction === 1 ? bar.high : bar.low;
      const adversePnl = (adversePrice - entry) * direction * options.contractOunces * lots - feePerLot * lots;
      const favorablePnl = (favorablePrice - entry) * direction * options.contractOunces * lots - feePerLot * lots;
      const adverseEquity = equity + adversePnl / fxMark;
      const favorableEquity = equity + favorablePnl / fxMark;
      if (adverseEquity < worstOpenEquity) worstOpenEquity = adverseEquity;
      peakIntrabar = Math.max(peakIntrabar, favorableEquity);
      maxIntrabarDrawdown = Math.max(maxIntrabarDrawdown, maxDrawdown(worstOpenEquity, peakIntrabar));

      if (direction === 1) {
        if (bar.open <= stop) {
          exitPrice = bar.open;
          reason = "SL";
        } else if (bar.open >= target) {
          exitPrice = target;
          reason = "TP";
        } else if (bar.low <= stop) {
          exitPrice = stop;
          reason = "SL";
        } else if (bar.high >= target) {
          exitPrice = target;
          reason = "TP";
        }
      } else if (bar.open >= stop) {
        exitPrice = bar.open;
        reason = "SL";
      } else if (bar.open <= target) {
        exitPrice = target;
        reason = "TP";
      } else if (bar.high >= stop) {
        exitPrice = stop;
        reason = "SL";
      } else if (bar.low <= target) {
        exitPrice = target;
        reason = "TP";
      }

      if (reason !== "TIME" || cursor === expiryIndex) {
        exitIndex = cursor;
        if (reason === "TIME") exitPrice = bar.close;
        break;
      }
    }
    if (exitIndex < 0) {
      pendingSignals.push({ index, signal });
      break;
    }

    const exitBar = candles[exitIndex];
    const exitTime = reason === "TIME" ? exitBar.time + 15 * 60 * 1000 : exitBar.time;
    const fxExit = fxAtOrBefore(fxBars, completedFxBars, exitTime);
    if (!fxExit) {
      rejectedFx++;
      pendingSignals.push({ index, signal });
      break;
    }
    const pnlUSD = (exitPrice - entry) * direction * options.contractOunces * lots - feePerLot * lots;
    const pnlEUR = pnlUSD / fxExit;
    equity += pnlEUR;
    peakClosed = Math.max(peakClosed, equity);
    maxClosedDrawdown = Math.max(maxClosedDrawdown, maxDrawdown(equity, peakClosed));
    trades.push({
      variant, entryTime: entryBar.time, exitTime, direction: signal.direction,
      entry, exit: exitPrice, stop, target, lots, feesUSD: feePerLot * lots,
      fxEntry, fxExit, pnlEUR, equityEUR: equity, reason,
    });
    index = exitIndex + 1;
  }

  return {
    label: "SIMULATION — offline, non-PAPER, non-LIVE",
    variant,
    experimentalRules: GOLD_SMC_FIB_EXPERIMENTAL_RULES.status,
    options,
    startTime: options.startTime,
    endTime: options.endTime,
    initialCapitalEUR: options.initialCapitalEUR,
    endingCapitalEUR: equity,
    netPnlEUR: equity - options.initialCapitalEUR,
    closedTrades: trades.length,
    wins: trades.filter(trade => trade.pnlEUR > 0).length,
    losses: trades.filter(trade => trade.pnlEUR < 0).length,
    winRatePercent: trades.length ? 100 * trades.filter(trade => trade.pnlEUR > 0).length / trades.length : null,
    maxClosedDrawdownPercent: 100 * maxClosedDrawdown,
    estimatedIntrabarDrawdownPercent: 100 * maxIntrabarDrawdown,
    rejectedRisk,
    rejectedFx,
    incompleteAtDataEnd: pendingSignals.length,
    diagnosticEvents: analysis.diagnostics,
    trades,
  };
}
