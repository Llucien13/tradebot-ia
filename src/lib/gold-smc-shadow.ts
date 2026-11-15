import {
  confirmedM15Pivots,
  FIB_M15_INTERVAL_MS,
  fibonacciShadowSignal,
  type FibCandle,
  type FibPivot,
  type FibonacciShadowSignal,
} from "./fibonacci-shadow.ts";

export type GoldSmcBias = "UP" | "DOWN" | "MIXED" | "UNKNOWN";
export type GoldSmcDirection = "UP" | "DOWN";
export type GoldSmcStructureLabel = "HH" | "HL" | "LH" | "LL";

export const GOLD_SMC_SHADOW_PARAMETERS = {
  referenceCapitalEUR: 20_000,
  riskPercent: 0.5,
  stopATRMultiple: 2.5,
  takeProfitR: 2.5,
  expiryBars: 48,
  maxConcurrentPositions: 1,
} as const;

export interface GoldSmcStructurePoint extends FibPivot {
  label: GoldSmcStructureLabel | null;
}

export interface GoldSmcBreak {
  direction: GoldSmcDirection;
  kind: "BOS" | "MSS";
  level: number;
  pivotTime: number;
  time: number;
  retests: number[];
}

export interface GoldSmcLiquiditySweep {
  side: "HIGH" | "LOW";
  level: number;
  pivotTime: number;
  time: number;
  close: number;
}

export interface GoldSmcShadowAnalysis {
  shadowOnly: true;
  tradableSignal: null;
  parameters: typeof GOLD_SMC_SHADOW_PARAMETERS;
  decisionAt: number;
  lastClosedCandle: {
    time: number;
    closeTime: number;
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  } | null;
  bias: GoldSmcBias;
  structure: GoldSmcStructurePoint[];
  breaks: GoldSmcBreak[];
  liquiditySweeps: GoldSmcLiquiditySweep[];
  fairValueGaps: { evaluated: false; reason: string };
  orderBlocks: { evaluated: false; reason: string };
  fibonacciSignal: FibonacciShadowSignal | null;
  historicalEntryRulesAvailable: false;
}

function validCandles(candles: FibCandle[]) {
  return candles.every((candle, index) =>
    [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    && candle.open > 0
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close)
    && (index === 0 || candle.time > candles[index - 1].time),
  );
}

function labelStructure(pivots: FibPivot[]): GoldSmcStructurePoint[] {
  let previousHigh: FibPivot | null = null;
  let previousLow: FibPivot | null = null;
  return [...pivots].sort((a, b) => a.index - b.index || a.side.localeCompare(b.side)).map(pivot => {
    const previous = pivot.side === "HIGH" ? previousHigh : previousLow;
    const label: GoldSmcStructureLabel | null = previous
      ? pivot.side === "HIGH"
        ? pivot.price > previous.price ? "HH" : "LH"
        : pivot.price > previous.price ? "HL" : "LL"
      : null;
    if (pivot.side === "HIGH") previousHigh = pivot;
    else previousLow = pivot;
    return { ...pivot, label };
  });
}

function biasFromStructure(structure: GoldSmcStructurePoint[]): GoldSmcBias {
  const highs = structure.filter(point => point.side === "HIGH" && point.label);
  const lows = structure.filter(point => point.side === "LOW" && point.label);
  const lastHigh = highs[highs.length - 1]?.label;
  const lastLow = lows[lows.length - 1]?.label;
  if (!lastHigh || !lastLow) return "UNKNOWN";
  if (lastHigh === "HH" && lastLow === "HL") return "UP";
  if (lastHigh === "LH" && lastLow === "LL") return "DOWN";
  return "MIXED";
}

function closedBarStructure(pivots: FibPivot[], bar: FibCandle): GoldSmcStructurePoint[] {
  return labelStructure(pivots.filter(pivot => pivot.confirmedAt <= bar.time));
}

export function goldSmcShadowAnalysis(
  input: FibCandle[],
  decisionAt: number,
): GoldSmcShadowAnalysis | null {
  if (!Number.isFinite(decisionAt)) return null;
  const candles = input.filter(candle =>
    Number.isFinite(candle.time) && candle.time + FIB_M15_INTERVAL_MS <= decisionAt,
  );
  if (!validCandles(candles)) return null;
  if (!candles.length) return null;

  const pivots = confirmedM15Pivots(candles, decisionAt);
  const structure = labelStructure(pivots);
  const breaks: GoldSmcBreak[] = [];
  const liquiditySweeps: GoldSmcLiquiditySweep[] = [];

  for (let index = 1; index < candles.length; index++) {
    const bar = candles[index];
    const previousClose = candles[index - 1].close;
    const knownPivots = pivots.filter(pivot => pivot.confirmedAt <= bar.time);
    const knownStructure = closedBarStructure(knownPivots, bar);
    const priorBias = biasFromStructure(knownStructure);
    const highs = knownPivots.filter(pivot => pivot.side === "HIGH");
    const lows = knownPivots.filter(pivot => pivot.side === "LOW");
    const high = highs[highs.length - 1];
    const low = lows[lows.length - 1];

    if (high && previousClose <= high.price && bar.close > high.price) {
      breaks.push({
        direction: "UP",
        kind: priorBias === "DOWN" ? "MSS" : "BOS",
        level: high.price,
        pivotTime: high.time,
        time: bar.time + FIB_M15_INTERVAL_MS,
        retests: [],
      });
    } else if (low && previousClose >= low.price && bar.close < low.price) {
      breaks.push({
        direction: "DOWN",
        kind: priorBias === "UP" ? "MSS" : "BOS",
        level: low.price,
        pivotTime: low.time,
        time: bar.time + FIB_M15_INTERVAL_MS,
        retests: [],
      });
    }

    if (high && bar.high > high.price && bar.close < high.price) {
      liquiditySweeps.push({
        side: "HIGH", level: high.price, pivotTime: high.time,
        time: bar.time + FIB_M15_INTERVAL_MS, close: bar.close,
      });
    }
    if (low && bar.low < low.price && bar.close > low.price) {
      liquiditySweeps.push({
        side: "LOW", level: low.price, pivotTime: low.time,
        time: bar.time + FIB_M15_INTERVAL_MS, close: bar.close,
      });
    }
  }

  for (const event of breaks) {
    const breakIndex = candles.findIndex(candle => candle.time + FIB_M15_INTERVAL_MS === event.time);
    for (let index = breakIndex + 1; index < candles.length; index++) {
      const bar = candles[index];
      const touched = bar.low <= event.level && bar.high >= event.level;
      const heldBeyond = event.direction === "UP" ? bar.close > event.level : bar.close < event.level;
      if (touched && heldBeyond) event.retests.push(bar.time + FIB_M15_INTERVAL_MS);
    }
  }

  const last = candles[candles.length - 1];
  return {
    shadowOnly: true,
    tradableSignal: null,
    parameters: GOLD_SMC_SHADOW_PARAMETERS,
    decisionAt,
    lastClosedCandle: {
      time: last.time,
      closeTime: last.time + FIB_M15_INTERVAL_MS,
      direction: last.close > last.open ? "BULLISH" : last.close < last.open ? "BEARISH" : "NEUTRAL",
    },
    bias: biasFromStructure(structure),
    structure,
    breaks,
    liquiditySweeps,
    fairValueGaps: {
      evaluated: false,
      reason: "Règles FVG historiques non retrouvées ; aucun critère de stratégie n’est supposé.",
    },
    orderBlocks: {
      evaluated: false,
      reason: "Règles Order Block historiques non retrouvées ; aucun critère de stratégie n’est supposé.",
    },
    fibonacciSignal: fibonacciShadowSignal(candles, decisionAt),
    historicalEntryRulesAvailable: false,
  };
}
