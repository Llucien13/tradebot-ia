import type { Candle } from "@/types";
import type { V3Config } from "./m5-v3-model";

export interface V3Zone { id: number; side: "support" | "resistance"; low: number; high: number; reactions: number; lastReaction: number; sources: string[] }
export interface V3Pivot { side: "support" | "resistance"; price: number; time: number; confirmedAt: number }
export function v3Patterns(c: Candle, previous: Candle | null, p: V3Config) {
  const range = c.high - c.low, body = Math.abs(c.close - c.open);
  if (range <= 0 || body <= 0) return [];
  const lower = Math.min(c.open, c.close) - c.low, upper = c.high - Math.max(c.open, c.close);
  const result: { sign: number; name: string }[] = [];
  if (c.close > c.open && lower >= p.wickBody * body && lower / range >= p.wickShare && upper / range <= p.oppositeWick) result.push({ sign: 1, name: "Marteau" });
  if (c.close < c.open && upper >= p.wickBody * body && upper / range >= p.wickShare && lower / range <= p.oppositeWick) result.push({ sign: -1, name: "Étoile filante" });
  if (previous && previous.time + 300000 === c.time) {
    if (previous.close < previous.open && c.close > c.open && c.open <= previous.close && c.close >= previous.open && body > Math.abs(previous.close - previous.open)) result.push({ sign: 1, name: "Englobante haussière" });
    if (previous.close > previous.open && c.close < c.open && c.open >= previous.close && c.close <= previous.open && body > Math.abs(previous.close - previous.open)) result.push({ sign: -1, name: "Englobante baissière" });
  }
  return result;
}
export function v3ConfirmedPivots(candles: Candle[], index: number, segment: number, bars: number, step: number): V3Pivot[] {
  if (index - segment < bars * 2) return [];
  const center = candles[index - bars];
  const neighbors = candles.slice(index - 2 * bars, index + 1).filter(c => c !== center);
  const confirmedAt = candles[index].time + step;
  return [
    ...(neighbors.every(c => c.high < center.high) ? [{ side: "resistance" as const, price: center.high, time: center.time, confirmedAt }] : []),
    ...(neighbors.every(c => c.low > center.low) ? [{ side: "support" as const, price: center.low, time: center.time, confirmedAt }] : []),
  ];
}
export function v3AddReaction(zones: V3Zone[], pivot: V3Pivot, atr: number, config: V3Config, source: string) {
  const tolerance = atr * config.zoneAtr;
  const matching = zones.filter(z => z.side === pivot.side && pivot.price >= z.low - tolerance && pivot.price <= z.high + tolerance)
    .sort((a, b) => Math.abs((a.low + a.high) / 2 - pivot.price) - Math.abs((b.low + b.high) / 2 - pivot.price))[0];
  if (matching) {
    if (pivot.time - matching.lastReaction < config.reactionBars * 300000) return;
    matching.low = Math.min(matching.low, pivot.price); matching.high = Math.max(matching.high, pivot.price);
    matching.reactions++; matching.lastReaction = pivot.time;
    if (!matching.sources.includes(source)) matching.sources.push(source);
  } else zones.push({ id: zones.reduce((n, z) => Math.max(n, z.id), 0) + 1, side: pivot.side, low: pivot.price, high: pivot.price, reactions: 1, lastReaction: pivot.time, sources: [source] });
}
export function v3InvalidateZones(zones: V3Zone[], close: number, atr: number, config: V3Config) {
  return zones.filter(z => z.side === "support" ? close >= z.low - config.breakAtr * atr : close <= z.high + config.breakAtr * atr);
}
export function v3Structure(highs: V3Pivot[], lows: V3Pivot[]) {
  if (highs.length < 2 || lows.length < 2) return "indisponible";
  const h = highs.at(-1)!.price - highs.at(-2)!.price, l = lows.at(-1)!.price - lows.at(-2)!.price;
  return h > 0 && l > 0 ? "haussière" : h < 0 && l < 0 ? "baissière" : "neutre";
}
export function v3Rebound(c: Candle, previous: Candle | null, zones: V3Zone[], trend: string, atr: number, config: V3Config) {
  for (const pattern of v3Patterns(c, previous, config)) {
    if (trend === "indisponible" || (trend === "neutre" && !config.allowNeutral) || (pattern.sign === 1 && trend === "baissière") || (pattern.sign === -1 && trend === "haussière")) continue;
    const candidates = zones.filter(z => z.reactions >= 2 && z.side === (pattern.sign === 1 ? "support" : "resistance")
      && c.low <= z.high + config.zoneAtr * atr && c.high >= z.low - config.zoneAtr * atr
      && (pattern.sign === 1 ? c.close > z.high : c.close < z.low));
    for (const zone of candidates) {
      const opposite = zones.filter(z => z.reactions >= 2 && z.side !== zone.side && (pattern.sign === 1 ? z.low > c.close : z.high < c.close))
        .sort((a, b) => pattern.sign === 1 ? a.low - b.low : b.high - a.high)[0];
      if (!opposite) continue;
      const sl = pattern.sign === 1 ? Math.min(zone.low, c.low) - config.stopAtr * atr : Math.max(zone.high, c.high) + config.stopAtr * atr;
      const tp = pattern.sign === 1 ? opposite.low - config.targetAtr * atr : opposite.high + config.targetAtr * atr;
      const rr = pattern.sign * (tp - c.close) / (pattern.sign * (c.close - sl));
      if (rr >= config.minRR) return { sign: pattern.sign, formation: pattern.name, zone: { ...zone, sources: [...zone.sources] }, opposite: { ...opposite, sources: [...opposite.sources] }, sl, tp, atr, trend, time: c.time + 300000 };
    }
  }
  return null;
}
export function v3M15(candles: Candle[]) {
  const result: Candle[] = [];
  for (let i = 0; i + 2 < candles.length; i++) {
    const a = candles[i], b = candles[i + 1], c = candles[i + 2];
    if (a.time % 900000 || b.time !== a.time + 300000 || c.time !== b.time + 300000) continue;
    result.push({ time: a.time, open: a.open, close: c.close, high: Math.max(a.high, b.high, c.high), low: Math.min(a.low, b.low, c.low), volume: a.volume + b.volume + c.volume });
  }
  return result;
}
