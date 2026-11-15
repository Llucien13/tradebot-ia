import { sliceV3Period, V3_JULY_PLAN } from "./m5-v3-period";
import { OBSERVED_ECN_CALENDAR, observedClosed } from "./m5-calendar";
import { validateV3Plan } from "./m5-v3-model";
import { v3M15 } from "./m5-v3-price-action";
import type { Candle } from "@/types";

// Data preparation checks only; no strategy, worker or backtest is executed.
export function checkV3JulyPeriods() {
  let assertions = 0;
  const check = (ok: boolean, label: string) => { if (!ok) throw new Error(`Découpage V3 : ${label}`); assertions++; };
  const calendar = OBSERVED_ECN_CALENDAR;
  if (calendar.kind !== "xauusd-ecn-observed-utc") throw new Error("Calendrier incorrect.");
  const start = V3_JULY_PLAN.developmentStart, end = V3_JULY_PLAN.validationEnd;
  const candles: Candle[] = [];
  for (let t = Date.parse("2026-06-29T01:00:00Z"); t < end; t += 300000) {
    if (!observedClosed(t, calendar)) candles.push({ time: t, open: 3000, high: 3002, low: 2998, close: 3001, volume: 100 });
  }
  const tested = candles.filter(c => c.time >= start);
  const gaps: { from: string; to: string; minutes: number }[] = [];
  let next = start;
  for (const c of tested) {
    if (c.time > next) gaps.push({ from: new Date(next).toISOString(), to: new Date(c.time).toISOString(), minutes: (c.time - next) / 60000 });
    next = c.time + 300000;
  }
  if (next < end) gaps.push({ from: new Date(next).toISOString(), to: new Date(end).toISOString(), minutes: (end - next) / 60000 });
  const history = { source: "MT5", symbol: "XAUUSD-ECN", interval: "5m", apiTimeframe: "TIMEFRAME_M5", priceBasis: "BID", volumeKind: "TICK_VOLUME", fetchedAt: "2026-08-01T00:00:00Z", cached: false, warnings: [], candles,
    coverage: { requestedStart: new Date(start).toISOString(), requestedEnd: new Date(end).toISOString(), warmupCount: candles.length - tested.length, testedCount: tested.length, expectedMinutes: (end - start) / 60000, missingMinutes: (end - start) / 60000 - tested.length * 5, first: new Date(tested[0].time).toISOString(), last: new Date(tested.at(-1)!.time).toISOString(), gaps: gaps.slice(0, 30), gapCount: gaps.length } };
  const before = JSON.stringify(history);
  const development = sliceV3Period(history, start, V3_JULY_PLAN.developmentEnd, calendar);
  const validation = sliceV3Period(history, V3_JULY_PLAN.validationStart, end, calendar);
  check(development.coverage.requestedEnd === "2026-07-21T00:00:00.000Z", "20 juillet inclus, fin 21 exclusive");
  check(validation.coverage.requestedStart === "2026-07-21T00:00:00.000Z" && validation.coverage.requestedEnd === "2026-08-01T00:00:00.000Z", "21 au 31 juillet inclus");
  check(development.candles.every(c => c.time + 300000 <= V3_JULY_PLAN.developmentEnd), "aucune validation transmise au développement");
  check(validation.candles.every(c => c.time + 300000 <= end), "aucune bougie future validation");
  check(development.coverage.warmupCount === history.coverage.warmupCount, "préchauffage initial complet conservé");
  check(validation.coverage.warmupCount === development.candles.length, "développement uniquement historique antérieur pour validation");
  check(validation.coverage.warmupCount >= 202, "202 bougies réelles avant validation");
  const d = development.candles.filter(c => c.time >= start), v = validation.candles.filter(c => c.time >= V3_JULY_PLAN.validationStart);
  check(d.at(-1)!.time < v[0].time && d.length + v.length === tested.length, "périodes non chevauchantes partitionnent juillet");
  check(JSON.stringify(history) === before, "lot original non modifié");
  check(development.coverage.gapCount > 0 && validation.coverage.gapCount > 0, "fermetures conservées dans couverture");
  check(development.coverage.missingMinutes + validation.coverage.missingMinutes === history.coverage.missingMinutes, "minutes manquantes exactes");
  check(v3M15(development.candles).every(c => c.time + 900000 <= V3_JULY_PLAN.developmentEnd), "M15 développement clôturée avant frontière");
  const settings = { initialCapital: 300, spread: 0.3, slippage: 0.05, commission: 0, timeframe: "5m" as const, start, end: V3_JULY_PLAN.developmentEnd };
  validateV3Plan(V3_JULY_PLAN, settings, "development"); assertions++;
  validateV3Plan(V3_JULY_PLAN, { ...settings, start: V3_JULY_PLAN.validationStart, end }, "validation"); assertions++;
  let rejected = false;
  try { sliceV3Period(development, V3_JULY_PLAN.validationStart, end, calendar); } catch { rejected = true; }
  check(rejected, "lot incomplet refusé plutôt qu’inventé");
  rejected = false;
  try { sliceV3Period({ ...history, candles: candles.filter(c => c.time >= start), coverage: { ...history.coverage, warmupCount: 0 } }, start, V3_JULY_PLAN.developmentEnd, calendar); } catch { rejected = true; }
  check(rejected, "préchauffage absent refusé");
  return { passed: true, assertions, noBacktestExecuted: true, syntheticOnly: true };
}
