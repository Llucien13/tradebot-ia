import type { Candle } from "@/types";
import type { ScalpingSetup } from "./model";
import { classifyM5Gap } from "./m5-sessions";
import { NY_CALENDAR, type M5Calendar } from "./m5-calendar";

function smooth(values: (number | null)[], period: number, alpha: number) {
  let value: number | null = null, count = 0, total = 0;
  return values.map(v => {
    if (v === null) return null;
    if (value === null) { total += v; count++; if (count < period) return null; value = total / period; }
    else value += alpha * (v - value);
    return value;
  });
}
function indicatorSegment(candles: Candle[], p: ScalpingSetup) {
  const closes = candles.map(c => c.close);
  const fast = smooth(closes, p.emaFast, 2 / (p.emaFast + 1));
  const middle = smooth(closes, p.emaMiddle, 2 / (p.emaMiddle + 1));
  const slow = smooth(closes, p.emaSlow, 2 / (p.emaSlow + 1));
  const gains = smooth(closes.map((c, i) => i ? Math.max(0, c - closes[i - 1]) : null), p.rsiPeriod, 1 / p.rsiPeriod);
  const losses = smooth(closes.map((c, i) => i ? Math.max(0, closes[i - 1] - c) : null), p.rsiPeriod, 1 / p.rsiPeriod);
  const tr = candles.map((c, i) => i ? Math.max(c.high - c.low, Math.abs(c.high - closes[i - 1]), Math.abs(c.low - closes[i - 1])) : c.high - c.low);
  const atr = smooth(tr, p.atrPeriod, 1 / p.atrPeriod);
  const directional = smooth(tr.map((v, i) => i ? v : null), p.adxPeriod, 1 / p.adxPeriod);
  const plus = smooth(candles.map((c, i) => { if (!i) return null; const up = c.high - candles[i - 1].high, down = candles[i - 1].low - c.low; return up > down && up > 0 ? up : 0; }), p.adxPeriod, 1 / p.adxPeriod);
  const minus = smooth(candles.map((c, i) => { if (!i) return null; const up = c.high - candles[i - 1].high, down = candles[i - 1].low - c.low; return down > up && down > 0 ? down : 0; }), p.adxPeriod, 1 / p.adxPeriod);
  const dx = candles.map((_, i) => {
    if (directional[i] === null || plus[i] === null || minus[i] === null) return null;
    const sum = plus[i]! + minus[i]!;
    return sum ? 100 * Math.abs(plus[i]! - minus[i]!) / sum : 0;
  });
  const adx = smooth(dx, p.adxPeriod, 1 / p.adxPeriod);

  return candles.map((c, i) => ({ open: c.open, high: c.high, low: c.low, close: c.close,
    previousFast: i ? fast[i - 1] : null, previousMiddle: i ? middle[i - 1] : null,
    fast: fast[i], middle: middle[i], slow: slow[i], atr: atr[i], adx: adx[i], rsi: gains[i] === null || losses[i] === null ? null : losses[i] === 0 ? gains[i] === 0 ? 50 : 100 : 100 - 100 / (1 + gains[i]! / losses[i]!) }));
}

export function m5SessionIndicators(candles: Candle[], setup: ScalpingSetup, step = 300000, calendar: M5Calendar = NY_CALENDAR) {
  const rows: ReturnType<typeof indicatorSegment> = [];
  const segmentStarts: number[] = [];
  let start = 0;
  for (let index = 1; index <= candles.length; index++) {
    if (index === candles.length || classifyM5Gap(candles[index - 1].time, candles[index].time, step, calendar) === "anomaly") {
      for (const row of indicatorSegment(candles.slice(start, index), setup)) rows.push(row);
      for (let i = start; i < index; i++) segmentStarts.push(start);
      start = index;
    }
  }
  return { rows, segmentStarts };
}
