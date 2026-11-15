import type { Candle } from "@/types";
import { m5Setup, type M5Config } from "./m5-model";
import type { M5EngineVersion } from "./m5-sessions";
import { classifyM5Gap } from "./m5-sessions";
import { NY_CALENDAR, calendarPolicy, type M5Calendar } from "./m5-calendar";
import { m5SessionIndicators } from "./m5-session-indicators";
import { scalpingIndicators } from "./signals";

// Observational counters only: no signals, positions or trading decisions are changed.
export function m5EligibilityDiagnostics(candles: Candle[], start: number, config: M5Config, version: M5EngineVersion, calendar: M5Calendar = NY_CALENDAR) {
  const starts: number[] = [];
  let segment = 0, normalClosures = 0, anomalies = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i && candles[i].time !== candles[i - 1].time + 300000) {
      const kind = classifyM5Gap(candles[i - 1].time, candles[i].time, 300000, version === "m5-session-continuity-2" ? calendar : NY_CALENDAR);
      if (candles[i].time >= start) {
        if (kind === "scheduled-close") normalClosures++; else anomalies++;
      }
      if (version === "m5-independent-1" || kind === "anomaly") segment = i;
    }
    starts.push(segment);
  }
  const rows = version === "m5-session-continuity-2" ? m5SessionIndicators(candles, m5Setup, 300000, calendar).rows : scalpingIndicators(candles, m5Setup, 300000);
  const higher: Candle[] = [];
  if (config.trendM15) for (let i = 0; i + 2 < candles.length; i++) {
    const a = candles[i], b = candles[i + 1], c = candles[i + 2];
    if (a.time % 900000 || b.time !== a.time + 300000 || c.time !== b.time + 300000) continue;
    higher.push({ time: a.time, open: a.open, high: Math.max(a.high, b.high, c.high), low: Math.min(a.low, b.low, c.low), close: c.close, volume: a.volume + b.volume + c.volume });
  }
  const higherRows = version === "m5-session-continuity-2" ? m5SessionIndicators(higher, m5Setup, 900000, calendar).rows : scalpingIndicators(higher, m5Setup, 900000);
  let higherIndex = -1, tested = 0, eligible = 0, ignoredWarmup = 0, unavailableIndicators = 0, unavailableM15 = 0, noNextBar = 0;
  for (let i = 0; i < candles.length; i++) {
    const time = candles[i].time + 300000;
    while (higherIndex + 1 < higher.length && higher[higherIndex + 1].time + 900000 <= time) higherIndex++;
    if (candles[i].time < start) continue;
    tested++;
    if (i - starts[i] < 202) { ignoredWarmup++; continue; }
    const row = rows[i];
    if (row.middle === null || row.slow === null || row.atr === null || row.atr <= 0) { unavailableIndicators++; continue; }
    const h = higherRows[higherIndex];
    if (config.trendM15 && (!h || higher[higherIndex].time + 900000 !== time - time % 900000 || h.middle === null || h.slow === null)) { unavailableM15++; continue; }
    if (i === candles.length - 1) { noNextBar++; continue; }
    eligible++;
  }
  return { tested, eligible, ignoredWarmup, unavailableIndicators, unavailableM15, noNextBar, initialHistory: candles.filter(c => c.time < start).length, normalClosures, anomalies, policy: calendarPolicy(version === "m5-session-continuity-2" ? calendar : NY_CALENDAR) };
}
export type M5EligibilityDiagnostics = ReturnType<typeof m5EligibilityDiagnostics>;
