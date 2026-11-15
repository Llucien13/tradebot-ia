export interface FibCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface FibPivot {
  side: "HIGH" | "LOW";
  index: number;
  price: number;
  time: number;
  confirmedAt: number;
}

export interface ShadowCandidate {
  source: "GOLD" | "SMC" | "FIBONACCI";
  direction: "BUY" | "SELL";
  time: number;
}

export interface FibonacciShadowSignal extends ShadowCandidate {
  source: "FIBONACCI";
  shadowOnly: true;
  entry: number;
  sl: number;
  tp: number;
  atr14: number;
  riskPercent: 0.5;
  expiresAt: number;
  swingLow: number;
  swingHigh: number;
  zoneLow: number;
  zoneHigh: number;
}

export const FIB_M15_INTERVAL_MS = 15 * 60 * 1000;

function validCandle(candle: FibCandle) {
  return [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    && candle.open > 0 && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close);
}

function trueRange(candle: FibCandle, previous: FibCandle) {
  return Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close));
}

function atr14(candles: FibCandle[], index: number): number | null {
  if (index < 14) return null;
  let total = 0;
  for (let i = index - 13; i <= index; i++) total += trueRange(candles[i], candles[i - 1]);
  return total / 14;
}

function ema(candles: FibCandle[], index: number, period: number): number | null {
  if (index + 1 < period) return null;
  const alpha = 2 / (period + 1);
  let value = candles[0].close;
  for (let i = 1; i <= index; i++) value += alpha * (candles[i].close - value);
  return value;
}

export function confirmedM15Pivots(candles: FibCandle[], decisionAt: number): FibPivot[] {
  const closed = candles.filter(candle => candle.time + FIB_M15_INTERVAL_MS <= decisionAt);
  const pivots: FibPivot[] = [];
  for (let index = 3; index + 2 < closed.length; index++) {
    const center = closed[index];
    const left = closed.slice(index - 3, index);
    const right = closed.slice(index + 1, index + 3);
    if ([...left, ...right].every(candle => center.high > candle.high)) pivots.push({ side: "HIGH", index, price: center.high, time: center.time, confirmedAt: closed[index + 2].time + FIB_M15_INTERVAL_MS });
    if ([...left, ...right].every(candle => center.low < candle.low)) pivots.push({ side: "LOW", index, price: center.low, time: center.time, confirmedAt: closed[index + 2].time + FIB_M15_INTERVAL_MS });
  }
  return pivots;
}

function impulsePair(pivots: FibPivot[], candles: FibCandle[], direction: "BUY" | "SELL") {
  const highs = pivots.filter(pivot => pivot.side === "HIGH");
  const lows = pivots.filter(pivot => pivot.side === "LOW");
  const endpoints = direction === "BUY" ? highs : lows;
  const starts = direction === "BUY" ? lows : highs;
  for (let endpointIndex = endpoints.length - 1; endpointIndex >= 0; endpointIndex--) {
    const endpoint = endpoints[endpointIndex];
    for (let startIndex = starts.length - 1; startIndex >= 0; startIndex--) {
      const start = starts[startIndex];
      const bars = endpoint.index - start.index;
      if (bars < 8 || bars > 96) continue;
      const swingLow = direction === "BUY" ? start.price : endpoint.price;
      const swingHigh = direction === "BUY" ? endpoint.price : start.price;
      const impulse = swingHigh - swingLow;
      const atr = atr14(candles, endpoint.index - 1);
      if (atr && impulse >= 3 * atr) return { swingLow, swingHigh };
    }
  }
  return null;
}

export function fibonacciShadowSignal(input: FibCandle[], decisionAt: number): FibonacciShadowSignal | null {
  if (!Number.isFinite(decisionAt) || input.some(candle => !validCandle(candle))) return null;
  const candles = input.filter(candle => candle.time + FIB_M15_INTERVAL_MS <= decisionAt);
  if (candles.length < 200 || candles.some((candle, index) => index > 0 && candle.time <= candles[index - 1].time)) return null;
  const currentIndex = candles.length - 1;
  const current = candles[currentIndex];
  const decisionTime = current.time + FIB_M15_INTERVAL_MS;
  const currentATR = atr14(candles, currentIndex - 1);
  const ema50 = ema(candles, currentIndex, 50);
  const ema200 = ema(candles, currentIndex, 200);
  if (!currentATR || !ema50 || !ema200) return null;
  const pivots = confirmedM15Pivots(candles, decisionAt).filter(pivot => pivot.confirmedAt <= decisionTime);

  for (const direction of ["BUY", "SELL"] as const) {
    if (direction === "BUY" ? !(ema50 > ema200 && current.close > ema50 && current.close > current.open) : !(ema50 < ema200 && current.close < ema50 && current.close < current.open)) continue;
    const swing = impulsePair(pivots, candles, direction);
    if (!swing) continue;
    const range = swing.swingHigh - swing.swingLow;
    const zoneLow = direction === "BUY" ? swing.swingHigh - range * 0.618 : swing.swingLow + range * 0.5;
    const zoneHigh = direction === "BUY" ? swing.swingHigh - range * 0.5 : swing.swingLow + range * 0.618;
    const touchedAndRejected = direction === "BUY"
      ? current.low <= zoneHigh && current.high >= zoneLow && current.low >= swing.swingLow && current.close > zoneHigh
      : current.high >= zoneLow && current.low <= zoneHigh && current.high <= swing.swingHigh && current.close < zoneLow;
    if (!touchedAndRejected) continue;
    const sign = direction === "BUY" ? 1 : -1;
    const distance = 2.5 * currentATR;
    return {
      source: "FIBONACCI", direction, time: decisionTime, shadowOnly: true,
      entry: current.close, sl: current.close - sign * distance,
      tp: current.close + sign * distance * 2.5, atr14: currentATR,
      riskPercent: 0.5, expiresAt: decisionTime + 48 * FIB_M15_INTERVAL_MS,
      swingLow: swing.swingLow, swingHigh: swing.swingHigh, zoneLow, zoneHigh,
    };
  }
  return null;
}

export function selectShadowCandidate(gold: ShadowCandidate | null, smc: ShadowCandidate | null, fibonacci: ShadowCandidate | null) {
  return gold ?? smc ?? fibonacci;
}