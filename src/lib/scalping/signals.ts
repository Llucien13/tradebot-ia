import type { Candle } from "@/types";
import type { ScalpingSetup } from "./model";
import { priceActionAnalysis, type PriceAction } from "./price-action";

function smooth(values: (number | null)[], period: number, alpha: number) {
  let value: number | null = null, count = 0, total = 0;
  return values.map(v => {
    if (v === null) return null;
    if (value === null) { total += v; count++; if (count < period) return null; value = total / period; }
    else value += alpha * (v - value);
    return value;
  });
}
export function scalpingWarmup(p: ScalpingSetup) {
  return Math.max(202, p.emaSlow + 2, p.emaMiddle + 2, p.emaFast + 2, p.rsiPeriod + 2, p.atrPeriod + 2, 2 * p.adxPeriod + 2);
}
export function scalpingIndicators(candles: Candle[], p: ScalpingSetup, step = 60000) {
  const rows: ReturnType<typeof indicatorSegment> = [];
  let start = 0;
  for (let i = 1; i <= candles.length; i++) {
    if (i === candles.length || candles[i].time - candles[i - 1].time !== step) {
      for (const row of indicatorSegment(candles.slice(start, i), p)) rows.push(row);
      start = i;
    }
  }
  return rows;
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
  const analysis = p.candlePatternFilter || p.trendlineFilter || p.supportResistanceFilter || p.breakoutFilter || p.retestFilter || p.structureFilter ? priceActionAnalysis(candles, atr) : null;
  return candles.map((c, i) => ({ open: c.open, high: c.high, low: c.low, close: c.close,
    previousFast: i ? fast[i - 1] : null, previousMiddle: i ? middle[i - 1] : null,
    priceAction: analysis?.[i],
    fast: fast[i], middle: middle[i], slow: slow[i], atr: atr[i], adx: adx[i], rsi: gains[i] === null || losses[i] === null ? null : losses[i] === 0 ? gains[i] === 0 ? 50 : 100 : 100 - 100 / (1 + gains[i]! / losses[i]!) }));
}
export function scalpingSignal(row: Omit<ReturnType<typeof scalpingIndicators>[number], "priceAction"> & { priceAction?: PriceAction }, p: ScalpingSetup): { direction: "BUY" | "SELL"; conditions: string[] } | null {
  if (row.atr === null || row.atr <= 0 || row.fast === null || row.middle === null || row.previousFast === null || row.previousMiddle === null) return null;
  const atr = row.atr, fast = row.fast, middle = row.middle;
  const previousFast = row.previousFast, previousMiddle = row.previousMiddle;
  const evaluate = (sign: number) => {
    const conditions: string[] = [];
    const check = (active: boolean, ok: boolean, name: string) => { if (!active) return true; if (ok) conditions.push(name); return ok; };
    if (!check(true, sign * (fast - previousFast) > 0 && sign * (middle - previousMiddle) > 0, "Pentes EMA concordantes")
      || !check(true, sign * (row.close - row.open) > 0 && Math.abs(row.close - row.open) >= 0.1 * atr, "Bougie directionnelle clôturée")
      || !check(true, row.high - row.low <= 2 * atr && Math.abs(row.close - middle) <= 1.5 * atr, "Pas de bougie extrême ni de poursuite éloignée")) return null;
    const valid = check(p.trend, row.fast !== null && row.middle !== null && sign * (row.fast - row.middle) > 0, "EMA rapide / médiane")
      && check(p.slowTrend, row.middle !== null && row.slow !== null && sign * (row.middle - row.slow) > 0, "Filtre EMA lente")
      && check(p.priceFilter, row.middle !== null && sign * (row.close - row.middle) > 0, "Clôture / EMA médiane")
      && check(p.rsiFilter, row.rsi !== null && (sign === 1 ? row.rsi >= p.rsiMin && row.rsi <= p.rsiMax : row.rsi >= 100 - p.rsiMax && row.rsi <= 100 - p.rsiMin), "Zone RSI symétrique")
      && check(p.adxFilter, row.adx !== null && row.adx >= p.adxMin, "ADX minimum")
      && check(p.atrFilter, row.atr !== null && row.atr >= p.atrMin, "ATR minimum");
    if (!valid) return null;
    const a = row.priceAction;
    const patterns = sign === 1 ? a?.buyPatterns : a?.sellPatterns;
    const breakout = sign === 1 ? a?.buyBreakout : a?.sellBreakout;
    const retest = sign === 1 ? a?.buyRetest : a?.sellRetest;
    const priceValid = check(!!p.candlePatternFilter, !!patterns?.length, patterns?.join(" / ") || "Figure japonaise")
      && check(!!p.trendlineFilter, !!(sign === 1 ? a?.buyTrendline : a?.sellTrendline), "Rejet sur ligne de tendance confirmée")
      && check(!!p.supportResistanceFilter, !!(sign === 1 ? a?.buyLevel : a?.sellLevel), "Rejet sur support / résistance confirmé")
      && check(!!p.structureFilter, !!(sign === 1 ? a?.buyStructure : a?.sellStructure), "Structure de sommets / creux confirmés")
      && check(!!(p.breakoutFilter || p.retestFilter), !!(p.breakoutFilter && breakout || p.retestFilter && retest), retest && p.retestFilter ? "Retest de cassure confirmée" : "Cassure confirmée à la clôture");
    return priceValid && conditions.length ? conditions : null;
  };
  const buy = evaluate(1), sell = evaluate(-1);
  return buy && !sell ? { direction: "BUY", conditions: buy } : sell && !buy ? { direction: "SELL", conditions: sell } : null;
}
