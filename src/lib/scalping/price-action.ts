import type { Candle } from "@/types";

interface Pivot { index: number; price: number }
export interface PriceAction {
  buyPatterns: string[]; sellPatterns: string[];
  buyTrendline: boolean; sellTrendline: boolean;
  buyLevel: boolean; sellLevel: boolean;
  buyBreakout: boolean; sellBreakout: boolean;
  buyRetest: boolean; sellRetest: boolean;
  buyStructure: boolean; sellStructure: boolean;
}

// Each row is frozen at its candle's close. A pivot needs two CLOSED bars on each side.
export function priceActionAnalysis(candles: Candle[], atr: (number | null)[]): PriceAction[] {
  const highs: Pivot[] = [], lows: Pivot[] = [];
  let breakUp: Pivot | null = null, breakDown: Pivot | null = null;
  return candles.map((c, i) => {
    const previous = candles[i - 1];
    const body = Math.abs(c.close - c.open), range = c.high - c.low;
    const lower = Math.min(c.open, c.close) - c.low, upper = c.high - Math.max(c.open, c.close);
    const buyPatterns: string[] = [], sellPatterns: string[] = [];
    if (previous && c.close > c.open && previous.close < previous.open && c.open <= previous.close && c.close >= previous.open && body > Math.abs(previous.close - previous.open)) buyPatterns.push("Englobante haussière");
    if (previous && c.close < c.open && previous.close > previous.open && c.open >= previous.close && c.close <= previous.open && body > Math.abs(previous.close - previous.open)) sellPatterns.push("Englobante baissière");
    if (body > 0 && lower >= 2 * body && upper <= body && c.close > c.open) buyPatterns.push("Marteau");
    if (body > 0 && upper >= 2 * body && lower <= body && c.close < c.open) sellPatterns.push("Étoile filante");
    if (range > 0 && lower >= 0.6 * range && c.close >= c.low + 0.7 * range && c.close > c.open) buyPatterns.push("Mèche de rejet basse");
    if (range > 0 && upper >= 0.6 * range && c.close <= c.low + 0.3 * range && c.close < c.open) sellPatterns.push("Mèche de rejet haute");

    // Breakouts use the levels known BEFORE this close, not a retrospectively fitted level.
    const resistance = highs.at(-1)?.price, support = lows.at(-1)?.price;
    const tolerance = atr[i] !== null ? atr[i]! * 0.3 : 0;
    const ready = tolerance > 0;
    const buyBreakout = ready && !!previous && resistance !== undefined && previous.close <= resistance && c.close > resistance + tolerance;
    const sellBreakout = ready && !!previous && support !== undefined && previous.close >= support && c.close < support - tolerance;
    if (breakUp && (i - breakUp.index > 10 || c.close < breakUp.price - tolerance)) breakUp = null;
    if (breakDown && (i - breakDown.index > 10 || c.close > breakDown.price + tolerance)) breakDown = null;
    const buyRetest = ready && !!breakUp && i > breakUp.index && Math.abs(c.low - breakUp.price) <= tolerance && c.close > breakUp.price && c.close > c.open;
    const sellRetest = ready && !!breakDown && i > breakDown.index && Math.abs(c.high - breakDown.price) <= tolerance && c.close < breakDown.price && c.close < c.open;
    if (buyBreakout) { breakUp = { index: i, price: resistance! }; breakDown = null; }
    if (sellBreakout) { breakDown = { index: i, price: support! }; breakUp = null; }

    const k = i - 2;
    if (k >= 2) {
      const pivot = candles[k];
      const neighbors = [candles[k - 2], candles[k - 1], candles[k + 1], c];
      if (neighbors.every(n => pivot.high > n.high)) { highs.push({ index: k, price: pivot.high }); if (highs.length > 2) highs.shift(); }
      if (neighbors.every(n => pivot.low < n.low)) { lows.push({ index: k, price: pivot.low }); if (lows.length > 2) lows.shift(); }
    }
    const buyStructure = highs.length === 2 && lows.length === 2 && highs[1].price > highs[0].price && lows[1].price > lows[0].price;
    const sellStructure = highs.length === 2 && lows.length === 2 && highs[1].price < highs[0].price && lows[1].price < lows[0].price;
    const line = (pivots: Pivot[]) => pivots.length === 2 ? pivots[1].price + (pivots[1].price - pivots[0].price) * (i - pivots[1].index) / (pivots[1].index - pivots[0].index) : null;
    const risingLine = line(lows), fallingLine = line(highs);
    const buyTrendline = ready && risingLine !== null && lows[1].price > lows[0].price && Math.abs(c.low - risingLine) <= tolerance && c.close > risingLine;
    const sellTrendline = ready && fallingLine !== null && highs[1].price < highs[0].price && Math.abs(c.high - fallingLine) <= tolerance && c.close < fallingLine;
    const confirmedSupport = lows.at(-1)?.price, confirmedResistance = highs.at(-1)?.price;
    const buyLevel = ready && confirmedSupport !== undefined && Math.abs(c.low - confirmedSupport) <= tolerance && c.close > confirmedSupport && (confirmedResistance === undefined || confirmedResistance <= c.close || confirmedResistance - c.close > tolerance);
    const sellLevel = ready && confirmedResistance !== undefined && Math.abs(c.high - confirmedResistance) <= tolerance && c.close < confirmedResistance && (confirmedSupport === undefined || confirmedSupport >= c.close || c.close - confirmedSupport > tolerance);
    return { buyPatterns, sellPatterns, buyTrendline, sellTrendline, buyLevel, sellLevel, buyBreakout, sellBreakout, buyRetest, sellRetest, buyStructure, sellStructure };
  });
}
