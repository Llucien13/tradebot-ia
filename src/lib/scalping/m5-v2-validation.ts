import type { MT5History } from "@/lib/mt5-data";
import { observedClosed, type M5Calendar } from "./m5-calendar";

// V2-only input guards. No shared M1/H1/V1 validator or stored result is changed.
export function validateM5V2Coverage(history: MT5History, calendar: M5Calendar) {
  const step = 300000, coverage = history.coverage;
  const start = Date.parse(coverage.requestedStart), end = Date.parse(coverage.requestedEnd);
  const tested = history.candles.filter(c => c.time >= start);
  const expectedMinutes = (end - start) / 60000;
  const missingMinutes = expectedMinutes - tested.length * 5;
  const gaps: { from: string; to: string; minutes: number }[] = [];
  let next = start;
  for (const candle of tested) {
    if (candle.time > next) gaps.push({ from: new Date(next).toISOString(), to: new Date(candle.time).toISOString(), minutes: (candle.time - next) / 60000 });
    next = candle.time + step;
  }
  if (next < end) gaps.push({ from: new Date(next).toISOString(), to: new Date(end).toISOString(), minutes: (end - next) / 60000 });
  const listed = gaps.slice(0, 30);
  if (!tested.length || coverage.expectedMinutes !== expectedMinutes || coverage.missingMinutes !== missingMinutes
    || Date.parse(coverage.first) !== tested[0].time || Date.parse(coverage.last) !== tested.at(-1)!.time
    || coverage.gapCount !== gaps.length || coverage.gaps.length !== listed.length
    || listed.some((gap, i) => Date.parse(coverage.gaps[i].from) !== Date.parse(gap.from)
      || Date.parse(coverage.gaps[i].to) !== Date.parse(gap.to) || coverage.gaps[i].minutes !== gap.minutes)) {
    throw new Error("Couverture M5 V2 incohérente avec les bougies : rechargez le lot complet avec ses métadonnées. Aucune correction ou interpolation automatique.");
  }
  if (calendar.kind === "xauusd-ecn-observed-utc" && history.candles.some(c => observedClosed(c.time, calendar))) {
    throw new Error("Calendrier M5 V2 incompatible : des bougies existent dans ses créneaux déclarés fermés. Vérifiez les horaires UTC du broker.");
  }
}
