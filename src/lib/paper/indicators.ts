import type { Strategy } from "@/lib/strategies";
import type { IndicatorRow } from "@/lib/backtest/indicators";
import type { PaperCandle } from "./model";

function smooth(values: (number | null)[], period: number, method: "ema" | "wilder") {
  let value: number | null = null, sum = 0, count = 0;
  const alpha = method === "ema" ? 2 / (period + 1) : 1 / period;
  return values.map(v => {
    if (v === null) return null;
    if (value === null) { sum += v; count++; if (count < period) return null; value = sum / period; }
    else value = alpha * v + (1 - alpha) * value;
    return value;
  });
}
export function configuredIndicators(candles: PaperCandle[], s: Strategy): IndicatorRow[] {
  const rows: IndicatorRow[] = candles.map(c => ({ price: c.close, ema20: null, ema50: null, ema200: null, rsi: null, macd: null, macdSignal: null, adx: null, atr: null, bbUpper: null, bbMiddle: null, bbLower: null }));
  const closes = candles.map(c => c.close), p = s.parameters;
  for (const [field, period] of [["ema20", 20], ["ema50", 50], ["ema200", 200]] as const) if (s.indicators[field]) smooth(closes, period, "ema").forEach((v, i) => { rows[i][field] = v; });
  if (s.indicators.rsi) {
    const changes = closes.map((c, i) => !i ? null : c - closes[i - 1]);
    const gains = smooth(changes.map(v => v === null ? null : Math.max(v, 0)), 14, "wilder"), losses = smooth(changes.map(v => v === null ? null : Math.max(-v, 0)), 14, "wilder");
    rows.forEach((r, i) => { if (gains[i] !== null && losses[i] !== null) r.rsi = losses[i] === 0 ? (gains[i] === 0 ? 50 : 100) : 100 - 100 / (1 + gains[i]! / losses[i]!); });
  }
  if (s.indicators.macd) {
    const fast = smooth(closes, p.macdFast, "ema"), slow = smooth(closes, p.macdSlow, "ema");
    const macd = closes.map((_, i) => fast[i] === null || slow[i] === null ? null : fast[i]! - slow[i]!);
    const signal = smooth(macd, p.macdSignal, "ema");
    rows.forEach((r, i) => { r.macd = macd[i]; r.macdSignal = signal[i]; });
  }
  if (s.indicators.atr || s.indicators.adx) {
    const tr = candles.map((c, i) => !i ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));
    if (s.indicators.atr) smooth(tr, p.atrPeriod, "wilder").forEach((v, i) => { rows[i].atr = v; });
    if (s.indicators.adx) {
      const range = smooth(tr.map((v, i) => !i ? null : v), p.adxPeriod, "wilder");
      const plus = smooth(candles.map((c, i) => { if (!i) return null; const up = c.high - candles[i - 1].high, down = candles[i - 1].low - c.low; return up > down && up > 0 ? up : 0; }), p.adxPeriod, "wilder");
      const minus = smooth(candles.map((c, i) => { if (!i) return null; const up = c.high - candles[i - 1].high, down = candles[i - 1].low - c.low; return down > up && down > 0 ? down : 0; }), p.adxPeriod, "wilder");
      const dx = candles.map((_, i) => { if (range[i] === null || plus[i] === null || minus[i] === null) return null; if (range[i] === 0) return 0; const a = 100 * plus[i]! / range[i]!, b = 100 * minus[i]! / range[i]!; return a + b === 0 ? 0 : 100 * Math.abs(a - b) / (a + b); });
      smooth(dx, p.adxPeriod, "wilder").forEach((v, i) => { rows[i].adx = v; });
    }
  }
  if (s.indicators.bollinger) for (let i = p.bbPeriod - 1; i < rows.length; i++) {
    const values = closes.slice(i + 1 - p.bbPeriod, i + 1), mean = values.reduce((sum, v) => sum + v, 0) / p.bbPeriod;
    const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / p.bbPeriod);
    rows[i].bbMiddle = mean; rows[i].bbUpper = mean + p.bbDeviation * sd; rows[i].bbLower = mean - p.bbDeviation * sd;
  }
  return rows;
}
