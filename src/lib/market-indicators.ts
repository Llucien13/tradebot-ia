import type { Candle, IndicatorValues } from "@/types";

export const INDICATOR_MIN_CANDLES = {
  ema20: 20, ema50: 50, ema200: 200, rsi: 15, macd: 34, atr: 14, adx: 28,
} as const;

function emaSeries(values: number[], period: number): (number | null)[] {
  let value: number | null = null;
  const alpha = 2 / (period + 1);
  return values.map((price, index) => {
    if (index === period - 1) value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
    else if (index >= period) value = price * alpha + value! * (1 - alpha);
    return value;
  });
}

export function calculateMarketIndicators(candles: Candle[]): IndicatorValues {
  const closes = candles.map((candle) => candle.close);
  const lastEma = (period: number) => {
    const values = emaSeries(closes, period);
    return values[values.length - 1] ?? null;
  };
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const macdValues = closes.flatMap((_, index) => fast[index] !== null && slow[index] !== null ? [fast[index]! - slow[index]!] : []);
  const signals = emaSeries(macdValues, 9);
  const macdSignal = signals[signals.length - 1] ?? null;
  const macd = macdSignal === null ? null : macdValues[macdValues.length - 1];

  // ATR: first TR uses the first candle's range, then Wilder's smoothing.
  let atr = 0;
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const previousClose = index === 0 ? candle.open : candles[index - 1].close;
    const tr = Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
    if (index < 14) atr += tr / 14;
    else atr = (atr * 13 + tr) / 14;
  }

  // RSI and directional movement require 14 changes, not 14 partial candles.
  let gain = 0;
  let loss = 0;
  let directionalTr = 0;
  let plusDm = 0;
  let minusDm = 0;
  const dx: number[] = [];
  for (let index = 1; index < candles.length; index++) {
    const candle = candles[index];
    const previous = candles[index - 1];
    const change = candle.close - previous.close;
    const tr = Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close));
    const up = candle.high - previous.high;
    const down = previous.low - candle.low;
    const positiveDm = up > down && up > 0 ? up : 0;
    const negativeDm = down > up && down > 0 ? down : 0;
    if (index <= 14) {
      gain += Math.max(change, 0) / 14;
      loss += Math.max(-change, 0) / 14;
      directionalTr += tr / 14;
      plusDm += positiveDm / 14;
      minusDm += negativeDm / 14;
    } else {
      gain = (gain * 13 + Math.max(change, 0)) / 14;
      loss = (loss * 13 + Math.max(-change, 0)) / 14;
      directionalTr = (directionalTr * 13 + tr) / 14;
      plusDm = (plusDm * 13 + positiveDm) / 14;
      minusDm = (minusDm * 13 + negativeDm) / 14;
    }
    if (index >= 14) {
      const plusDi = directionalTr === 0 ? 0 : 100 * plusDm / directionalTr;
      const minusDi = directionalTr === 0 ? 0 : 100 * minusDm / directionalTr;
      dx.push(plusDi + minusDi === 0 ? 0 : 100 * Math.abs(plusDi - minusDi) / (plusDi + minusDi));
    }
  }
  let adx: number | null = null;
  if (candles.length >= INDICATOR_MIN_CANDLES.adx) {
    adx = dx.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14;
    for (const value of dx.slice(14)) adx = (adx * 13 + value) / 14;
  }
  const window = closes.slice(-20);
  const middle = window.length < 20 ? null : window.reduce((sum, value) => sum + value, 0) / 20;
  const deviation = middle === null ? null : Math.sqrt(window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / 20);
  return {
    ema20: lastEma(20), ema50: lastEma(50), ema200: lastEma(200),
    rsi: candles.length < INDICATOR_MIN_CANDLES.rsi ? null : loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss),
    macd, macdSignal, macdHistogram: macd !== null && macdSignal !== null ? macd - macdSignal : null,
    atr: candles.length < INDICATOR_MIN_CANDLES.atr ? null : atr,
    adx, bbMiddle: middle,
    bbUpper: middle === null ? null : middle + 2 * deviation!,
    bbLower: middle === null ? null : middle - 2 * deviation!,
  };
}
