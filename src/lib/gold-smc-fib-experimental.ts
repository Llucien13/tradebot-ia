import {
  FIB_M15_INTERVAL_MS,
  type FibCandle,
  type FibPivot,
} from "./fibonacci-shadow.ts";

export const GOLD_SMC_FIB_EXPERIMENTAL_RULES = {
  status: "EXPERIMENTAL_NOT_HISTORICAL",
  leftPivotBars: 3,
  rightPivotBars: 2,
  fvgMiddleBodyATR: 0.5,
  orderBlockLookbackBars: 5,
  eventLookbackBars: 48,
  variants: ["fibonacci", "structure", "sweep", "retest", "fvg", "order-block", "fvg+order-block"],
} as const;

export type ExperimentalVariant = typeof GOLD_SMC_FIB_EXPERIMENTAL_RULES.variants[number];
export type ExperimentalDirection = "BUY" | "SELL";
export type ExperimentalStructure = "HH" | "HL" | "LH" | "LL";

export interface ExperimentalSignal {
  direction: ExperimentalDirection;
  time: number;
  signalIndex: number;
  close: number;
  atr14: number;
  swingLow: number;
  swingHigh: number;
  zoneLow: number;
  zoneHigh: number;
}

export interface ExperimentalBreak {
  direction: ExperimentalDirection;
  kind: "BOS" | "MSS";
  index: number;
  level: number;
  retestIndices: number[];
}

export interface ExperimentalFvg {
  direction: ExperimentalDirection;
  index: number;
  low: number;
  high: number;
}

export interface ExperimentalOrderBlock {
  direction: ExperimentalDirection;
  breakIndex: number;
  sourceIndex: number;
  low: number;
  high: number;
}

export interface ExperimentalBarFeatures {
  bias: "UP" | "DOWN" | "MIXED" | "UNKNOWN";
  structure: ExperimentalStructure[];
  breaks: ExperimentalBreak[];
  sweeps: { direction: ExperimentalDirection; index: number; level: number }[];
  retests: ExperimentalBreak[];
  fvgTouches: ExperimentalFvg[];
  orderBlockTouches: ExperimentalOrderBlock[];
}

export interface ExperimentalAnalysis {
  signals: Record<ExperimentalVariant, (ExperimentalSignal | null)[]>;
  features: ExperimentalBarFeatures[];
  diagnostics: {
    pivots: number;
    breaks: number;
    sweeps: number;
    fvgs: number;
    orderBlocks: number;
  };
}

function isValidCandle(candle: FibCandle): boolean {
  return [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    && candle.open > 0
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close);
}

function trueRange(candle: FibCandle, previous: FibCandle): number {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previous.close),
    Math.abs(candle.low - previous.close),
  );
}

function atrAt(candles: FibCandle[], index: number): number | null {
  if (index < 14) return null;
  let total = 0;
  for (let cursor = index - 13; cursor <= index; cursor++) {
    total += trueRange(candles[cursor], candles[cursor - 1]);
  }
  return total / 14;
}

function exponentialAverage(values: number[], period: number): number[] {
  const result = Array<number>(values.length);
  if (!values.length) return result;
  const alpha = 2 / (period + 1);
  result[0] = values[0];
  for (let index = 1; index < values.length; index++) {
    result[index] = result[index - 1] + alpha * (values[index] - result[index - 1]);
  }
  return result;
}

function structureLabel(pivot: FibPivot, previous: FibPivot | undefined): ExperimentalStructure | null {
  if (!previous) return null;
  if (pivot.side === "HIGH") return pivot.price > previous.price ? "HH" : "LH";
  return pivot.price > previous.price ? "HL" : "LL";
}

function biasFromLabels(high: ExperimentalStructure | null, low: ExperimentalStructure | null) {
  if (!high || !low) return "UNKNOWN" as const;
  if (high === "HH" && low === "HL") return "UP" as const;
  if (high === "LH" && low === "LL") return "DOWN" as const;
  return "MIXED" as const;
}

function overlap(candle: FibCandle, low: number, high: number): boolean {
  return candle.low <= high && candle.high >= low;
}

function experimentalFibonacciCandidate(
  candles: FibCandle[],
  index: number,
  highPivots: FibPivot[],
  lowPivots: FibPivot[],
  ema50: number[],
  ema200: number[],
): ExperimentalSignal | null {
  if (index < 199) return null;
  const current = candles[index];
  const atr = atrAt(candles, index - 1);
  if (!atr || !ema50[index] || !ema200[index]) return null;

  for (const direction of ["BUY", "SELL"] as const) {
    if (direction === "BUY"
      ? !(ema50[index] > ema200[index] && current.close > ema50[index] && current.close > current.open)
      : !(ema50[index] < ema200[index] && current.close < ema50[index] && current.close < current.open)) continue;

    const endpoints = direction === "BUY" ? highPivots : lowPivots;
    const starts = direction === "BUY" ? lowPivots : highPivots;
    let swing: { low: number; high: number } | null = null;
    for (let endpointIndex = endpoints.length - 1; endpointIndex >= 0 && !swing; endpointIndex--) {
      const endpoint = endpoints[endpointIndex];
      if (endpoint.index >= index || endpoint.index < 14) continue;
      let firstEligible = 0;
      let lastEligible = starts.length;
      const maxStartIndex = endpoint.index - 8;
      while (firstEligible < lastEligible) {
        const middle = (firstEligible + lastEligible) >>> 1;
        if (starts[middle].index <= maxStartIndex) firstEligible = middle + 1;
        else lastEligible = middle;
      }
      for (let startIndex = firstEligible - 1; startIndex >= 0; startIndex--) {
        const start = starts[startIndex];
        const bars = endpoint.index - start.index;
        if (bars < 8) break;
        if (bars > 96) break;
        const low = direction === "BUY" ? start.price : endpoint.price;
        const high = direction === "BUY" ? endpoint.price : start.price;
        const impulseAtr = atrAt(candles, endpoint.index - 1);
        if (impulseAtr && high - low >= 3 * impulseAtr) {
          swing = { low, high };
          break;
        }
      }
    }
    if (!swing) continue;

    const range = swing.high - swing.low;
    const zoneLow = direction === "BUY" ? swing.high - range * 0.618 : swing.low + range * 0.5;
    const zoneHigh = direction === "BUY" ? swing.high - range * 0.5 : swing.low + range * 0.618;
    const rejected = direction === "BUY"
      ? current.low <= zoneHigh && current.high >= zoneLow && current.low >= swing.low && current.close > zoneHigh
      : current.high >= zoneLow && current.low <= zoneHigh && current.high <= swing.high && current.close < zoneLow;
    if (!rejected) continue;
    return {
      direction,
      time: current.time + FIB_M15_INTERVAL_MS,
      signalIndex: index,
      close: current.close,
      atr14: atr,
      swingLow: swing.low,
      swingHigh: swing.high,
      zoneLow,
      zoneHigh,
    };
  }
  return null;
}

function expired(index: number, eventIndex: number): boolean {
  return index - eventIndex > GOLD_SMC_FIB_EXPERIMENTAL_RULES.eventLookbackBars;
}

function directionalFvgTouch(candle: FibCandle, direction: ExperimentalDirection, zones: ExperimentalFvg[]) {
  return zones.some(zone =>
    zone.direction === direction
    && overlap(candle, zone.low, zone.high)
    && (direction === "BUY" ? candle.close > (zone.low + zone.high) / 2 : candle.close < (zone.low + zone.high) / 2),
  );
}

function directionalOrderBlockTouch(
  candle: FibCandle,
  direction: ExperimentalDirection,
  zones: ExperimentalOrderBlock[],
) {
  return zones.some(zone =>
    zone.direction === direction
    && overlap(candle, zone.low, zone.high)
    && (direction === "BUY" ? candle.close > (zone.low + zone.high) / 2 : candle.close < (zone.low + zone.high) / 2),
  );
}

export function analyzeExperimentalGoldSmcFib(candles: FibCandle[]): ExperimentalAnalysis | null {
  if (!candles.every((candle, index) =>
    isValidCandle(candle) && (index === 0 || candle.time > candles[index - 1].time),
  )) return null;

  const closes = candles.map(candle => candle.close);
  const ema50 = exponentialAverage(closes, 50);
  const ema200 = exponentialAverage(closes, 200);
  const confirmedHighPivots: FibPivot[] = [];
  const confirmedLowPivots: FibPivot[] = [];
  const breaks: ExperimentalBreak[] = [];
  const sweeps: { direction: ExperimentalDirection; index: number; level: number }[] = [];
  const activeFvgs: ExperimentalFvg[] = [];
  const activeOrderBlocks: ExperimentalOrderBlock[] = [];
  const features: ExperimentalBarFeatures[] = [];
  const signals = Object.fromEntries(
    GOLD_SMC_FIB_EXPERIMENTAL_RULES.variants.map(variant => [variant, Array<ExperimentalSignal | null>(candles.length).fill(null)]),
  ) as Record<ExperimentalVariant, (ExperimentalSignal | null)[]>;

  let lastHighLabel: ExperimentalStructure | null = null;
  let lastLowLabel: ExperimentalStructure | null = null;
  let previousHigh: FibPivot | undefined;
  let previousLow: FibPivot | undefined;

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const featuresAtBar: ExperimentalBarFeatures = {
      bias: biasFromLabels(lastHighLabel, lastLowLabel),
      structure: [],
      breaks: [],
      sweeps: [],
      retests: [],
      fvgTouches: [],
      orderBlockTouches: [],
    };

    for (let cursor = breaks.length - 1; cursor >= 0; cursor--) {
      const event = breaks[cursor];
      if (expired(index, event.index)) {
        breaks.splice(cursor, 1);
        continue;
      }
      if (index > event.index
        && overlap(candle, event.level, event.level)
        && (event.direction === "BUY" ? candle.close > event.level : candle.close < event.level)) {
        event.retestIndices.push(index);
        featuresAtBar.retests.push(event);
      }
    }

    for (let cursor = activeFvgs.length - 1; cursor >= 0; cursor--) {
      const zone = activeFvgs[cursor];
      const invalidated = zone.direction === "BUY" ? candle.close < zone.low : candle.close > zone.high;
      if (invalidated) activeFvgs.splice(cursor, 1);
      else if (index > zone.index && overlap(candle, zone.low, zone.high)) featuresAtBar.fvgTouches.push(zone);
    }
    for (let cursor = activeOrderBlocks.length - 1; cursor >= 0; cursor--) {
      const zone = activeOrderBlocks[cursor];
      const invalidated = zone.direction === "BUY" ? candle.close < zone.low : candle.close > zone.high;
      if (invalidated) activeOrderBlocks.splice(cursor, 1);
      else if (index > zone.breakIndex && overlap(candle, zone.low, zone.high)) featuresAtBar.orderBlockTouches.push(zone);
    }

    const priorHigh = confirmedHighPivots[confirmedHighPivots.length - 1];
    const priorLow = confirmedLowPivots[confirmedLowPivots.length - 1];
    if (index > 0 && priorHigh && candles[index - 1].close <= priorHigh.price && candle.close > priorHigh.price) {
      const event: ExperimentalBreak = {
        direction: "BUY",
        kind: featuresAtBar.bias === "DOWN" ? "MSS" : "BOS",
        index,
        level: priorHigh.price,
        retestIndices: [],
      };
      breaks.push(event);
      featuresAtBar.breaks.push(event);
      let sourceIndex = -1;
      for (let cursor = index - 1; cursor >= Math.max(0, index - GOLD_SMC_FIB_EXPERIMENTAL_RULES.orderBlockLookbackBars); cursor--) {
        if (candles[cursor].close < candles[cursor].open) {
          sourceIndex = cursor;
          break;
        }
      }
      if (sourceIndex >= 0) {
        activeOrderBlocks.push({
          direction: "BUY",
          breakIndex: index,
          sourceIndex,
          low: candles[sourceIndex].low,
          high: candles[sourceIndex].high,
        });
      }
    } else if (index > 0 && priorLow && candles[index - 1].close >= priorLow.price && candle.close < priorLow.price) {
      const event: ExperimentalBreak = {
        direction: "SELL",
        kind: featuresAtBar.bias === "UP" ? "MSS" : "BOS",
        index,
        level: priorLow.price,
        retestIndices: [],
      };
      breaks.push(event);
      featuresAtBar.breaks.push(event);
      let sourceIndex = -1;
      for (let cursor = index - 1; cursor >= Math.max(0, index - GOLD_SMC_FIB_EXPERIMENTAL_RULES.orderBlockLookbackBars); cursor--) {
        if (candles[cursor].close > candles[cursor].open) {
          sourceIndex = cursor;
          break;
        }
      }
      if (sourceIndex >= 0) {
        activeOrderBlocks.push({
          direction: "SELL",
          breakIndex: index,
          sourceIndex,
          low: candles[sourceIndex].low,
          high: candles[sourceIndex].high,
        });
      }
    }

    if (priorHigh && candle.high > priorHigh.price && candle.close < priorHigh.price) {
      const event = { direction: "SELL" as const, index, level: priorHigh.price };
      sweeps.push(event);
      featuresAtBar.sweeps.push(event);
    }
    if (priorLow && candle.low < priorLow.price && candle.close > priorLow.price) {
      const event = { direction: "BUY" as const, index, level: priorLow.price };
      sweeps.push(event);
      featuresAtBar.sweeps.push(event);
    }

    if (index >= 2) {
      const middleAtr = atrAt(candles, index - 1);
      const middle = candles[index - 1];
      if (middleAtr && Math.abs(middle.close - middle.open) >= middleAtr * GOLD_SMC_FIB_EXPERIMENTAL_RULES.fvgMiddleBodyATR) {
        if (candle.low > candles[index - 2].high) {
          activeFvgs.push({
            direction: "BUY",
            index,
            low: candles[index - 2].high,
            high: candle.low,
          });
        } else if (candle.high < candles[index - 2].low) {
          activeFvgs.push({
            direction: "SELL",
            index,
            low: candle.high,
            high: candles[index - 2].low,
          });
        }
      }
    }
    while (activeFvgs.length > 256) activeFvgs.shift();
    while (activeOrderBlocks.length > 256) activeOrderBlocks.shift();

    const newlyConfirmed: FibPivot[] = [];
    const centerIndex = index - GOLD_SMC_FIB_EXPERIMENTAL_RULES.rightPivotBars;
    if (centerIndex >= GOLD_SMC_FIB_EXPERIMENTAL_RULES.leftPivotBars) {
      const center = candles[centerIndex];
      const left = candles.slice(centerIndex - GOLD_SMC_FIB_EXPERIMENTAL_RULES.leftPivotBars, centerIndex);
      const right = candles.slice(centerIndex + 1, index + 1);
      if (left.length === GOLD_SMC_FIB_EXPERIMENTAL_RULES.leftPivotBars
        && right.length === GOLD_SMC_FIB_EXPERIMENTAL_RULES.rightPivotBars) {
        if ([...left, ...right].every(bar => center.high > bar.high)) {
          newlyConfirmed.push({
            side: "HIGH", index: centerIndex, price: center.high, time: center.time,
            confirmedAt: candle.time + FIB_M15_INTERVAL_MS,
          });
        }
        if ([...left, ...right].every(bar => center.low < bar.low)) {
          newlyConfirmed.push({
            side: "LOW", index: centerIndex, price: center.low, time: center.time,
            confirmedAt: candle.time + FIB_M15_INTERVAL_MS,
          });
        }
      }
    }
    for (const pivot of newlyConfirmed) {
      if (pivot.side === "HIGH") {
        const label = structureLabel(pivot, previousHigh);
        previousHigh = pivot;
        confirmedHighPivots.push(pivot);
        lastHighLabel = label;
        if (label) featuresAtBar.structure.push(label);
      } else {
        const label = structureLabel(pivot, previousLow);
        previousLow = pivot;
        confirmedLowPivots.push(pivot);
        lastLowLabel = label;
        if (label) featuresAtBar.structure.push(label);
      }
    }
    featuresAtBar.bias = biasFromLabels(lastHighLabel, lastLowLabel);

    const fib = experimentalFibonacciCandidate(candles, index, confirmedHighPivots, confirmedLowPivots, ema50, ema200);
    if (fib) {
      signals.fibonacci[index] = fib;
      const structureMatches = featuresAtBar.bias === (fib.direction === "BUY" ? "UP" : "DOWN");
      if (structureMatches) signals.structure[index] = fib;

      const recentSweep = sweeps.some(event =>
        event.direction === fib.direction && !expired(index, event.index),
      );
      if (structureMatches && recentSweep) signals.sweep[index] = fib;

      const recentRetest = breaks.some(event =>
        event.direction === fib.direction
        && !expired(index, event.index)
        && event.retestIndices.some(retestIndex => !expired(index, retestIndex)),
      );
      if (structureMatches && recentRetest) signals.retest[index] = fib;

      const hasFvg = directionalFvgTouch(candle, fib.direction, featuresAtBar.fvgTouches);
      if (structureMatches && hasFvg) signals.fvg[index] = fib;

      const hasOrderBlock = directionalOrderBlockTouch(candle, fib.direction, featuresAtBar.orderBlockTouches);
      if (structureMatches && hasOrderBlock) signals["order-block"][index] = fib;
      if (structureMatches && hasFvg && hasOrderBlock) signals["fvg+order-block"][index] = fib;
    }
    features.push(featuresAtBar);
  }

  return {
    signals,
    features,
    diagnostics: {
      pivots: confirmedHighPivots.length + confirmedLowPivots.length,
      breaks: features.reduce((sum, item) => sum + item.breaks.length, 0),
      sweeps: features.reduce((sum, item) => sum + item.sweeps.length, 0),
      fvgs: features.reduce((sum, item) => sum + item.fvgTouches.length, 0),
      orderBlocks: features.reduce((sum, item) => sum + item.orderBlockTouches.length, 0),
    },
  };
}
