import { validateM5History } from "./m5-engine";
import { validateM5V2Coverage } from "./m5-v2-validation";
import { m5SessionIndicators } from "./m5-session-indicators";
import { m5Setup } from "./m5-model";
import type { M5Calendar } from "./m5-calendar";
import type { V3Plan } from "./m5-v3-model";

export const V3_JULY_PLAN: V3Plan = {
  developmentStart: Date.parse("2026-07-01T00:00:00Z"), developmentEnd: Date.parse("2026-07-21T00:00:00Z"),
  validationStart: Date.parse("2026-07-21T00:00:00Z"), validationEnd: Date.parse("2026-08-01T00:00:00Z"),
};
export function sliceV3Period(data: unknown, start: number, end: number, calendar: M5Calendar) {
  const history = validateM5History(data);
  if (history.symbol !== "XAUUSD-ECN") throw new Error("Chargez l’historique MT5 XAUUSD-ECN M5 de juillet 2026.");
  validateM5V2Coverage(history, calendar);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start % 300000 || end % 300000) throw new Error("Bornes de période M5 UTC invalides.");
  if (Date.parse(history.coverage.requestedStart) > start || Date.parse(history.coverage.requestedEnd) < end) throw new Error("Le lot chargé ne couvre pas entièrement la période choisie. Rechargez le lot de juillet complet, avec son préchauffage.");
  // Preserve all real earlier bars, including development history for validation indicators.
  // Future bars and bars not yet closed at the exclusive end are never sent to the engine.
  const candles = history.candles.filter(c => c.time + 300000 <= end);
  const first = candles.findIndex(c => c.time >= start), tested = candles.slice(first);
  if (first < 202 || tested.length < 2) throw new Error("Préchauffage réel insuffisant : 202 bougies avant la période et au moins deux bougies testées requises.");
  const gaps: { from: string; to: string; minutes: number }[] = [];
  let next = start;
  for (const c of tested) {
    if (c.time > next) gaps.push({ from: new Date(next).toISOString(), to: new Date(c.time).toISOString(), minutes: (c.time - next) / 60000 });
    next = c.time + 300000;
  }
  if (next < end) gaps.push({ from: new Date(next).toISOString(), to: new Date(end).toISOString(), minutes: (end - next) / 60000 });
  const expectedMinutes = (end - start) / 60000;
  const lot = { ...history, candles, coverage: { requestedStart: new Date(start).toISOString(), requestedEnd: new Date(end).toISOString(), warmupCount: first, testedCount: tested.length,
    expectedMinutes, missingMinutes: expectedMinutes - tested.length * 5, first: new Date(tested[0].time).toISOString(), last: new Date(tested.at(-1)!.time).toISOString(), gaps: gaps.slice(0, 30), gapCount: gaps.length } };
  validateM5V2Coverage(lot, calendar);
  const validated = validateM5History(lot);
  const { segmentStarts } = m5SessionIndicators(candles, m5Setup, 300000, calendar);
  if (first - segmentStarts[first] < 202) throw new Error("Une anomalie avant la première bougie testée impose 202 bougies de préchauffage dans son segment. Aucune bougie ne sera inventée.");
  return validated;
}
