import { FIB_M15_INTERVAL_MS, type FibCandle } from "./fibonacci-shadow.ts";
import type { ExperimentalAnalysis, ExperimentalSignal } from "./gold-smc-fib-experimental.ts";

export type HistoricalDirection = "BUY" | "SELL";
export type HistoricalVariantId =
  | "gold"
  | "gold-smc"
  | "gold-fibonacci"
  | "gold-smc-fibonacci"
  | "gold-fvg"
  | "gold-smc-fvg"
  | "gold-order-block"
  | "gold-smc-order-block"
  | "gold-fvg-order-block"
  | "gold-smc-fvg-order-block"
  | "gold-fibonacci-fvg"
  | "gold-fibonacci-order-block"
  | "gold-smc-fibonacci-fvg-order-block";

export type TimedOHLC = FibCandle;

export interface HistoricalSignal {
  direction: HistoricalDirection;
  signalIndex: number;
  time: number;
  atr14: number;
}

export interface HistoricalTrade {
  variant: HistoricalVariantId;
  year: number;
  signalTime: number;
  entryTime: number;
  exitTime: number;
  direction: HistoricalDirection;
  signalClose: number;
  referenceEntry: number;
  executedEntry: number;
  executedExit: number;
  stop: number;
  target: number;
  stopDistance: number;
  feesAndSlippageUSDPerLot: number;
  plannedRiskUSDPerLot: number;
  pnlUSDPerLot: number;
  netR: number;
  capitalIndex: number;
  exitReason: "SL" | "TP" | "TIME" | "DATA_END";
  conservativeAmbiguousBar: boolean;
}

export interface HistoricalSimulationOptions {
  initialCapitalIndex: number;
  riskPercent: number;
  stopATRMultiple: number;
  takeProfitR: number;
  expiryBars: number;
  contractOunces: number;
  spreadUSDPerOunce: number;
  slippageUSDPerOuncePerSide: number;
  commissionUSDPerLotPerSide: number;
}

export const GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS: HistoricalSimulationOptions = {
  initialCapitalIndex: 20_000,
  riskPercent: 0.5,
  stopATRMultiple: 2.5,
  takeProfitR: 2.5,
  expiryBars: 48,
  contractOunces: 100,
  spreadUSDPerOunce: 0.3,
  slippageUSDPerOuncePerSide: 0.05,
  commissionUSDPerLotPerSide: 3,
};

const VARIANTS: { id: HistoricalVariantId; label: string }[] = [
  { id: "gold", label: "GOLD seul — entrées archivées" },
  { id: "gold-smc", label: "GOLD + SMC — structure et événement" },
  { id: "gold-fibonacci", label: "GOLD + Fibonacci" },
  { id: "gold-smc-fibonacci", label: "GOLD + SMC + Fibonacci" },
  { id: "gold-fvg", label: "GOLD + FVG" },
  { id: "gold-smc-fvg", label: "GOLD + SMC + FVG" },
  { id: "gold-order-block", label: "GOLD + Order Block" },
  { id: "gold-smc-order-block", label: "GOLD + SMC + Order Block" },
  { id: "gold-fvg-order-block", label: "GOLD + FVG + Order Block" },
  { id: "gold-smc-fvg-order-block", label: "GOLD + SMC + FVG + Order Block" },
  { id: "gold-fibonacci-fvg", label: "GOLD + Fibonacci + FVG" },
  { id: "gold-fibonacci-order-block", label: "GOLD + Fibonacci + Order Block" },
  { id: "gold-smc-fibonacci-fvg-order-block", label: "GOLD + SMC + Fibonacci + FVG + Order Block" },
];

export interface HistoricalVariantCandidates {
  id: HistoricalVariantId;
  label: string;
  signals: (HistoricalSignal | null)[];
}

interface MomentumRelease {
  time: number;
  value: number;
}

function validHistory(candles: TimedOHLC[]): boolean {
  return candles.every((candle, index) =>
    [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    && candle.open > 0
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close)
    && (index === 0 || candle.time > candles[index - 1].time),
  );
}

function trueRange(candle: TimedOHLC, previous: TimedOHLC): number {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previous.close),
    Math.abs(candle.low - previous.close),
  );
}

function atr14Series(candles: TimedOHLC[]): (number | null)[] {
  const result = Array<number | null>(candles.length).fill(null);
  const ranges = Array<number | null>(candles.length).fill(null);
  for (let index = 1; index < candles.length; index++) ranges[index] = trueRange(candles[index], candles[index - 1]);
  for (let index = 14; index < candles.length; index++) {
    let total = 0;
    for (let cursor = index - 13; cursor <= index; cursor++) total += ranges[cursor]!;
    result[index] = total / 14;
  }
  return result;
}

function emaSeries(candles: TimedOHLC[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const result = Array<number>(candles.length);
  if (!candles.length) return result;
  result[0] = candles[0].close;
  for (let index = 1; index < candles.length; index++) {
    result[index] = result[index - 1] + alpha * (candles[index].close - result[index - 1]);
  }
  return result;
}

function momentumReleases(candles: TimedOHLC[]): MomentumRelease[] {
  const releases: MomentumRelease[] = [];
  for (let nextIndex = 4; nextIndex < candles.length; nextIndex++) {
    releases.push({
      time: candles[nextIndex].time,
      value: candles[nextIndex - 1].close - candles[nextIndex - 4].close,
    });
  }
  return releases;
}

function momentumAt(releases: MomentumRelease[], cursor: { value: number }, time: number): number | null {
  while (cursor.value + 1 < releases.length && releases[cursor.value + 1].time <= time) cursor.value++;
  return releases[cursor.value]?.time <= time ? releases[cursor.value].value : null;
}

function hasRecentSmcEvent(
  analysis: ExperimentalAnalysis,
  signalIndex: number,
  direction: HistoricalDirection,
  lookback: number,
): boolean {
  for (let index = Math.max(0, signalIndex - lookback); index <= signalIndex; index++) {
    const feature = analysis.features[index];
    if (feature.breaks.some(event => event.direction === direction)
      || feature.sweeps.some(event => event.direction === direction)
      || feature.retests.some(event => event.direction === direction)) return true;
  }
  return false;
}

export function buildArchivedGoldSignals(
  m15: TimedOHLC[],
  m30: TimedOHLC[],
  h4: TimedOHLC[],
  d1: TimedOHLC[],
): (HistoricalSignal | null)[] {
  if (!validHistory(m15) || !validHistory(m30) || !validHistory(h4) || !validHistory(d1)) {
    throw new Error("Un des historiques M15/M30/H4/D1 est invalide ou non chronologique.");
  }
  const atr = atr14Series(m15);
  const ema50 = emaSeries(m15, 50);
  const ema200 = emaSeries(m15, 200);
  const m30Releases = momentumReleases(m30);
  const h4Releases = momentumReleases(h4);
  const d1Releases = momentumReleases(d1);
  const m30Cursor = { value: -1 };
  const h4Cursor = { value: -1 };
  const d1Cursor = { value: -1 };
  const signals: (HistoricalSignal | null)[] = Array(m15.length).fill(null);

  for (let entryIndex = 1; entryIndex < m15.length; entryIndex++) {
    if (m15[entryIndex].time - m15[entryIndex - 1].time !== FIB_M15_INTERVAL_MS) continue;
    const signalIndex = entryIndex - 1;
    if (signalIndex < 199) continue;
    const firstRangeIndex = entryIndex - 9;
    if (firstRangeIndex < 0) continue;
    let priorHigh = -Infinity;
    let priorLow = Infinity;
    for (let cursor = entryIndex - 9; cursor <= entryIndex - 2; cursor++) {
      priorHigh = Math.max(priorHigh, m15[cursor].high);
      priorLow = Math.min(priorLow, m15[cursor].low);
    }

    const trigger = m15[signalIndex];
    const atr14 = atr[signalIndex];
    if (!atr14) continue;
    const stopDistance = 2.5 * atr14;
    if (stopDistance < 0.6 || stopDistance >= 100) continue;
    const m30Momentum = momentumAt(m30Releases, m30Cursor, m15[entryIndex].time);
    const h4Momentum = momentumAt(h4Releases, h4Cursor, m15[entryIndex].time);
    const d1Momentum = momentumAt(d1Releases, d1Cursor, m15[entryIndex].time);
    if (m30Momentum === null || h4Momentum === null || d1Momentum === null) continue;

    const long = trigger.close > priorHigh
      && trigger.close > trigger.open
      && h4Momentum > 0 && d1Momentum > 0 && m30Momentum > 0
      && ema50[signalIndex] > ema200[signalIndex];
    const short = trigger.close < priorLow
      && trigger.close < trigger.open
      && h4Momentum < 0 && d1Momentum < 0 && m30Momentum < 0
      && ema50[signalIndex] < ema200[signalIndex];
    if (!long && !short) continue;
    signals[signalIndex] = {
      direction: long ? "BUY" : "SELL",
      signalIndex,
      time: trigger.time + FIB_M15_INTERVAL_MS,
      atr14,
    };
  }
  return signals;
}

export function buildHistoricalVariantCandidates(
  goldSignals: (HistoricalSignal | null)[],
  analysis: ExperimentalAnalysis,
  smcLookback = 48,
): HistoricalVariantCandidates[] {
  if (goldSignals.length !== analysis.features.length) {
    throw new Error("Les signaux GOLD et l’analyse SMC doivent couvrir les mêmes bougies.");
  }
  if (!Number.isInteger(smcLookback) || smcLookback < 0) throw new Error("Fenêtre SMC invalide.");

  return VARIANTS.map(({ id, label }) => ({
    id,
    label,
    signals: goldSignals.map((gold, index) => {
      if (!gold) return null;
      const feature = analysis.features[index];
      const isSMC = feature.bias === (gold.direction === "BUY" ? "UP" : "DOWN")
        && hasRecentSmcEvent(analysis, index, gold.direction, smcLookback);
      const fib: ExperimentalSignal | null = analysis.signals.fibonacci[index];
      const isFib = fib?.direction === gold.direction;
      const isFvg = feature.fvgTouches.some(zone => zone.direction === gold.direction);
      const isOB = feature.orderBlockTouches.some(zone => zone.direction === gold.direction);
      const enabled = {
        gold: true,
        smc: isSMC,
        fibonacci: isFib,
        fvg: isFvg,
        orderBlock: isOB,
      };
      const accept =
        id === "gold"
        || (id === "gold-smc" && enabled.smc)
        || (id === "gold-fibonacci" && enabled.fibonacci)
        || (id === "gold-smc-fibonacci" && enabled.smc && enabled.fibonacci)
        || (id === "gold-fvg" && enabled.fvg)
        || (id === "gold-smc-fvg" && enabled.smc && enabled.fvg)
        || (id === "gold-order-block" && enabled.orderBlock)
        || (id === "gold-smc-order-block" && enabled.smc && enabled.orderBlock)
        || (id === "gold-fvg-order-block" && enabled.fvg && enabled.orderBlock)
        || (id === "gold-smc-fvg-order-block" && enabled.smc && enabled.fvg && enabled.orderBlock)
        || (id === "gold-fibonacci-fvg" && enabled.fibonacci && enabled.fvg)
        || (id === "gold-fibonacci-order-block" && enabled.fibonacci && enabled.orderBlock)
        || (id === "gold-smc-fibonacci-fvg-order-block" && enabled.smc && enabled.fibonacci && enabled.fvg && enabled.orderBlock);
      return accept ? gold : null;
    }),
  }));
}

export interface HistoricalPeriod {
  year: number;
  startIndex: number;
  endIndex: number;
}

export function simulateHistoricalVariant(
  candles: TimedOHLC[],
  candidates: HistoricalVariantCandidates,
  period: HistoricalPeriod,
  options: HistoricalSimulationOptions = GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS,
) {
  if (period.startIndex < 0 || period.endIndex > candles.length || period.startIndex >= period.endIndex) {
    throw new Error("Période de simulation invalide.");
  }
  let capitalIndex = options.initialCapitalIndex;
  let capitalFactor = 1;
  let peakFactor = 1;
  let maxCompoundDrawdown = 0;
  let runningUsdPerLot = 0;
  let peakUsdPerLot = 0;
  let maxUsdPerLotDrawdown = 0;
  let maxAdverseR = 0;
  let positionUntil = period.startIndex;
  const trades: HistoricalTrade[] = [];

  for (let signalIndex = period.startIndex; signalIndex < period.endIndex - 1; signalIndex++) {
    const signal = candidates.signals[signalIndex];
    if (!signal || signalIndex + 1 < positionUntil) continue;
    const entryIndex = signalIndex + 1;
    if (entryIndex >= period.endIndex
      || candles[entryIndex].time - candles[signalIndex].time !== FIB_M15_INTERVAL_MS) continue;
    const direction = signal.direction === "BUY" ? 1 : -1;
    const referenceEntry = candles[entryIndex].open;
    const stopDistance = options.stopATRMultiple * signal.atr14;
    if (!Number.isFinite(stopDistance) || stopDistance <= 0) continue;
    const stop = referenceEntry - direction * stopDistance;
    const target = referenceEntry + direction * stopDistance * options.takeProfitR;
    const spread = options.spreadUSDPerOunce;
    const slippage = options.slippageUSDPerOuncePerSide;
    const executionCostPerSide = spread / 2 + slippage;
    const executedEntry = referenceEntry + direction * executionCostPerSide;
    const roundTurnCommission = 2 * options.commissionUSDPerLotPerSide;
    const feesAndSlippageUSDPerLot =
      spread * options.contractOunces
      + 2 * slippage * options.contractOunces
      + roundTurnCommission;
    const plannedRiskUSDPerLot = stopDistance * options.contractOunces + feesAndSlippageUSDPerLot;
    const expiryIndex = Math.min(period.endIndex - 1, entryIndex + options.expiryBars - 1);
    let exitIndex = -1;
    let exitReference = referenceEntry;
    let exitReason: HistoricalTrade["exitReason"] = "TIME";
    let ambiguous = false;
    let adversePnlPerLot = 0;

    for (let cursor = entryIndex; cursor <= expiryIndex; cursor++) {
      const candle = candles[cursor];
      const adverseReference = direction === 1 ? candle.low : candle.high;
      const favorableReference = direction === 1 ? candle.high : candle.low;
      const adverseExit = adverseReference - direction * executionCostPerSide;
      const adversePnl = (adverseExit - executedEntry) * direction * options.contractOunces - roundTurnCommission;
      adversePnlPerLot = Math.min(adversePnlPerLot, adversePnl);
      const favorableExit = favorableReference - direction * executionCostPerSide;
      const favorablePnl = (favorableExit - executedEntry) * direction * options.contractOunces - roundTurnCommission;
      const adverseR = adversePnl / plannedRiskUSDPerLot;
      const favorableR = favorablePnl / plannedRiskUSDPerLot;
      maxAdverseR = Math.max(maxAdverseR, -adverseR);
      peakFactor = Math.max(peakFactor, capitalFactor * (1 + options.riskPercent / 100 * favorableR));
      maxCompoundDrawdown = Math.max(
        maxCompoundDrawdown,
        (peakFactor - capitalFactor * (1 + options.riskPercent / 100 * adverseR)) / peakFactor,
      );

      const stopTouched = direction === 1 ? candle.low <= stop : candle.high >= stop;
      const targetTouched = direction === 1 ? candle.high >= target : candle.low <= target;
      if (stopTouched && targetTouched) ambiguous = true;

      if (cursor > entryIndex && (direction === 1 ? candle.open <= stop : candle.open >= stop)) {
        exitReference = candle.open;
        exitReason = "SL";
      } else if (cursor > entryIndex && (direction === 1 ? candle.open >= target : candle.open <= target)) {
        exitReference = target;
        exitReason = "TP";
      } else if (stopTouched) {
        exitReference = stop;
        exitReason = "SL";
      } else if (targetTouched) {
        exitReference = target;
        exitReason = "TP";
      } else if (cursor === expiryIndex) {
        exitReference = candle.close;
        exitReason = cursor === period.endIndex - 1 ? "DATA_END" : "TIME";
      } else {
        continue;
      }
      exitIndex = cursor;
      break;
    }
    if (exitIndex < 0) continue;

    const executedExit = exitReference - direction * executionCostPerSide;
    const pnlUSDPerLot = (executedExit - executedEntry) * direction * options.contractOunces - roundTurnCommission;
    const netR = pnlUSDPerLot / plannedRiskUSDPerLot;
    capitalFactor *= 1 + options.riskPercent / 100 * netR;
    capitalIndex = options.initialCapitalIndex * capitalFactor;
    runningUsdPerLot += pnlUSDPerLot;
    peakUsdPerLot = Math.max(peakUsdPerLot, runningUsdPerLot);
    maxUsdPerLotDrawdown = Math.max(maxUsdPerLotDrawdown, peakUsdPerLot - runningUsdPerLot);
    trades.push({
      variant: candidates.id,
      year: period.year,
      signalTime: signal.time,
      entryTime: candles[entryIndex].time,
      exitTime: candles[exitIndex].time + (exitReason === "TIME" || exitReason === "DATA_END" ? FIB_M15_INTERVAL_MS : 0),
      direction: signal.direction,
      signalClose: candles[signalIndex].close,
      referenceEntry,
      executedEntry,
      executedExit,
      stop,
      target,
      stopDistance,
      feesAndSlippageUSDPerLot,
      plannedRiskUSDPerLot,
      pnlUSDPerLot,
      netR,
      capitalIndex,
      exitReason,
      conservativeAmbiguousBar: ambiguous,
    });
    positionUntil = exitIndex + 1;
  }

  const winners = trades.filter(trade => trade.pnlUSDPerLot > 0);
  const losers = trades.filter(trade => trade.pnlUSDPerLot < 0);
  const winningNetUSD = winners.reduce((sum, trade) => sum + trade.pnlUSDPerLot, 0);
  const losingNetUSD = -losers.reduce((sum, trade) => sum + trade.pnlUSDPerLot, 0);
  const netR = trades.reduce((sum, trade) => sum + trade.netR, 0);
  return {
    id: candidates.id,
    label: candidates.label,
    year: period.year,
    initialCapitalIndex: options.initialCapitalIndex,
    finalCapitalIndex: capitalIndex,
    capitalIndexChangePercent: (capitalFactor - 1) * 100,
    trades: trades.length,
    wins: winners.length,
    losses: losers.length,
    winRatePercent: trades.length ? 100 * winners.length / trades.length : null,
    grossWinsUSDPerLot: winningNetUSD,
    grossLossesUSDPerLot: losingNetUSD,
    netUSDPerLot: runningUsdPerLot,
    profitFactorUSDPerLot: losingNetUSD ? winningNetUSD / losingNetUSD : null,
    netR,
    maxDrawdownUSDPerLot: maxUsdPerLotDrawdown,
    maxCompoundDrawdownPercent: maxCompoundDrawdown * 100,
    maxAdverseExcursionR: maxAdverseR,
    conservativeAmbiguousBars: trades.filter(trade => trade.conservativeAmbiguousBar).length,
    timeExits: trades.filter(trade => trade.exitReason === "TIME").length,
    dataEndExits: trades.filter(trade => trade.exitReason === "DATA_END").length,
    tradesDetail: trades,
  };
}

export function historicalVariantDefinitions() {
  return VARIANTS.map(variant => ({ ...variant }));
}
