import type { Candle } from "@/types";
import type { Strategy, FIELDS } from "@/lib/strategies";
export type IndicatorRow = Record<typeof FIELDS[number], number | null>;

function ema(values: (number | null)[], period: number): (number | null)[] {
  let current: number | null = null;
  let seed: number[] = [];
  const alpha = 2 / (period + 1);
  return values.map(value => {
    if (value === null) return null;
    if (current === null) {
      seed.push(value);
      if (seed.length < period) return null;
      current = seed.reduce((sum, v) => sum + v, 0) / period;
      seed = [];
    } else current = alpha * value + (1 - alpha) * current;
    return current;
  });
}
function wilder(values: (number | null)[], period: number): (number | null)[] {
  let current: number | null = null;
  let count = 0;
  let total = 0;
  return values.map(value => {
    if (value === null) return null;
    if (current === null) {
      count++; total += value;
      if (count < period) return null;
      current = total / period;
    } else current = (current * (period - 1) + value) / period;
    return current;
  });
}
export function indicatorSeries(candles: Candle[], strategy: Strategy): IndicatorRow[] {
  const p = strategy.parameters;
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20), ema50 = ema(closes, 50), ema200 = ema(closes, 200);
  const fast = ema(closes, p.macdFast), slow = ema(closes, p.macdSlow);
  const macd = closes.map((_, i) => fast[i] === null || slow[i] === null ? null : fast[i]! - slow[i]!);
  const macdSignal = ema(macd, p.macdSignal);
  const changes = closes.map((c, i) => i === 0 ? null : c - closes[i - 1]);
  const gains = wilder(changes.map(c => c === null ? null : Math.max(c, 0)), 14);
  const losses = wilder(changes.map(c => c === null ? null : Math.max(-c, 0)), 14);
  const tr = candles.map((c, i) => i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));
  const atr = wilder(tr, p.atrPeriod);
  const directionalTR = wilder(tr.map((v, i) => i === 0 ? null : v), p.adxPeriod);
  const plus = wilder(candles.map((c, i) => { if (!i) return null; const up = c.high - candles[i - 1].high, down = candles[i - 1].low - c.low; return up > down && up > 0 ? up : 0; }), p.adxPeriod);
  const minus = wilder(candles.map((c, i) => { if (!i) return null; const up = c.high - candles[i - 1].high, down = candles[i - 1].low - c.low; return down > up && down > 0 ? down : 0; }), p.adxPeriod);
  const dx = candles.map((_, i) => {
    if (directionalTR[i] === null || plus[i] === null || minus[i] === null) return null;
    if (!directionalTR[i]) return 0;
    const a = 100 * plus[i]! / directionalTR[i]!, b = 100 * minus[i]! / directionalTR[i]!;
    return a + b === 0 ? 0 : 100 * Math.abs(a - b) / (a + b);
  });
  const adx = wilder(dx, p.adxPeriod);
  return candles.map((c, i) => {
    let bbMiddle: number | null = null, bbUpper: number | null = null, bbLower: number | null = null;
    if (i + 1 >= p.bbPeriod) {
      const window = closes.slice(i + 1 - p.bbPeriod, i + 1);
      bbMiddle = window.reduce((sum, v) => sum + v, 0) / p.bbPeriod;
      const deviation = Math.sqrt(window.reduce((sum, v) => sum + (v - bbMiddle!) ** 2, 0) / p.bbPeriod);
      bbUpper = bbMiddle + p.bbDeviation * deviation; bbLower = bbMiddle - p.bbDeviation * deviation;
    }
    const rsi = gains[i] === null || losses[i] === null ? null : losses[i] === 0 ? (gains[i] === 0 ? 50 : 100) : 100 - 100 / (1 + gains[i]! / losses[i]!);
    return { price: c.close, ema20: ema20[i], ema50: ema50[i], ema200: ema200[i], rsi, macd: macd[i], macdSignal: macdSignal[i], adx: adx[i], atr: atr[i], bbMiddle, bbUpper, bbLower };
  });
}
