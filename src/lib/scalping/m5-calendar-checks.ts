import type { Candle } from "@/types";
import { OBSERVED_ECN_CALENDAR, validateM5Calendar, observedClosed } from "./m5-calendar";
import { classifyM5Gap } from "./m5-sessions";
import { m5SessionIndicators } from "./m5-session-indicators";
import { m5Setup, m5Schema } from "./m5-model";
import { m5EligibilityDiagnostics } from "./m5-diagnostics";
import { auditM5Gaps } from "./m5-gap-audit";
import { executeM5 } from "./m5-execution";

// Synthetic indicator/calendar fixtures only. Never executes a backtest.
export function checkM5ObservedCalendar() {
  const calendar = validateM5Calendar(OBSERVED_ECN_CALENDAR, "XAUUSD-ECN");
  if (calendar.kind !== "xauusd-ecn-observed-utc") throw new Error("Calendrier inattendu");
  let assertions = 0;
  const check = (condition: boolean, label: string) => { if (!condition) throw new Error(`Calendrier M5 : ${label}`); assertions++; };
  const keys = ["fast", "middle", "slow", "atr", "rsi", "adx"] as const;
  const candle = (time: number, i: number): Candle => ({ time, open: 2600 + i * 0.1, high: 2602 + i * 0.1, low: 2598 + i * 0.1, close: 2601 + i * 0.1, volume: 100 });
  for (const month of [6, 7, 8, 9, 10]) {
    const start = Date.UTC(2026, month - 1, 1), end = Date.UTC(2026, month, 1);
    const candles: Candle[] = [];
    for (let t = start; t < end; t += 300000) if (!observedClosed(t, calendar)) candles.push(candle(t, candles.length));
    const before = JSON.stringify(candles);
    const gaps = auditM5Gaps(candles, start, end, calendar);
    check(gaps.length > 15 && gaps.every(g => g.classification === "scheduled-close"), `mois ${month} pauses et week-ends reconnus`);
    check(gaps.some(g => g.missingDuration === 3600000), `mois ${month} pause quotidienne exacte 1 h`);
    check(gaps.some(g => g.missingDuration === 49 * 3600000), `mois ${month} week-end exact 49 h`);
    const rows = m5SessionIndicators(candles, m5Setup, 300000, calendar);
    const compressed = candles.map((c, i) => ({ ...c, time: candles[0].time + i * 300000 }));
    const expected = m5SessionIndicators(compressed, m5Setup, 300000, calendar);
    for (const key of keys) check(rows.rows.every((row, i) => row[key] === expected.rows[i][key]), `mois ${month} continuité exacte ${key}`);
    check(rows.segmentStarts.every(s => s === 0), `mois ${month} aucun nouveau préchauffage normal`);
    const prefix = m5SessionIndicators(candles.slice(0, 301), m5Setup, 300000, calendar);
    check(JSON.stringify(prefix.rows) === JSON.stringify(rows.rows.slice(0, 301)), `mois ${month} pas de look-ahead`);
    check(before === JSON.stringify(candles) && rows.rows.length === candles.length, `mois ${month} bougies non modifiées ni ajoutées`);
    const higher = candles.filter(c => c.time % 900000 === 0);
    const higherRows = m5SessionIndicators(higher, m5Setup, 900000, calendar);
    check(higherRows.segmentStarts.every(s => s === 0), `mois ${month} continuité M15`);
    const diagnostic = m5EligibilityDiagnostics(candles, candles[300].time, m5Schema.parse({ enabled: true, trendM15: true }), "m5-session-continuity-2", calendar);
    check(diagnostic.ignoredWarmup === 0 && diagnostic.normalClosures > 0 && diagnostic.anomalies === 0 && diagnostic.eligible > 0, `mois ${month} compteurs cohérents`);
    if (month === 8) {
      const broken = candles.filter(c => c.time !== Date.parse("2026-08-28T17:30:00Z") && c.time !== Date.parse("2026-08-28T17:35:00Z"));
      const audit = auditM5Gaps(broken, start, end, calendar);
      check(audit.filter(g => g.classification === "anomaly").length === 1, "28 août seule anomalie dans le jeu observé");
      check(audit.find(g => g.classification === "anomaly")?.missingSlots === 2, "28 août deux créneaux manquants");
      const restart = broken.findIndex(c => c.time === Date.parse("2026-08-28T17:40:00Z"));
      const indicators = m5SessionIndicators(broken, m5Setup, 300000, calendar);
      check(indicators.segmentStarts[restart] === restart && indicators.rows[restart].atr === null, "28 août reset ATR et préchauffage");
      const d = m5EligibilityDiagnostics(broken, candles[300].time, m5Schema.parse({ enabled: true }), "m5-session-continuity-2", calendar);
      check(d.anomalies === 1 && d.ignoredWarmup === 202, "28 août 202 bougies de préchauffage après anomalie uniquement");
    }
  }
  for (const [before, after] of [["2026-10-23T23:55:00Z", "2026-10-26T01:00:00Z"], ["2026-10-30T23:55:00Z", "2026-11-02T01:00:00Z"], ["2026-03-27T23:55:00Z", "2026-03-30T01:00:00Z"]]) {
    check(classifyM5Gap(Date.parse(before), Date.parse(after), 300000, calendar) === "scheduled-close", "UTC fixe malgré transitions DST Europe/US");
  }
  check(classifyM5Gap(Date.parse("2026-08-28T17:25:00Z"), Date.parse("2026-08-28T17:40:00Z"), 300000, calendar) === "anomaly", "17:30 non couvert par pause UTC");
  check(classifyM5Gap(Date.parse("2026-08-03T23:50:00Z"), Date.parse("2026-08-04T01:00:00Z"), 300000, calendar) === "anomaly", "créneau manquant avant fermeture reste anomalie");
  check(classifyM5Gap(Date.parse("2026-08-03T23:30:00Z"), Date.parse("2026-08-04T01:00:00Z"), 900000, calendar) === "anomaly", "M15 incomplet en séance reste anomalie");
  check(classifyM5Gap(Date.parse("2026-08-03T23:55:00Z"), Date.parse("2026-08-04T01:05:00Z"), 300000, calendar) === "anomaly", "reprise retardée non acceptée");
  let rejected = false;
  try { validateM5Calendar(calendar, "XAUUSD"); } catch { rejected = true; }
  check(rejected, "calendrier limité au symbole ECN");
  rejected = false;
  try { validateM5Calendar({ ...calendar, dailyResumeMinute: 61 }); } catch { rejected = true; }
  check(rejected, "configuration non alignée rejetée");
  rejected = false;
  try { executeM5({ engineVersion: "m5-session-continuity-2", runId: "guard-test", history: { symbol: "XAUUSD-ECN" }, calendar, mode: "LIVE" } as never, () => {}); } catch (e) { rejected = e instanceof Error && e.message.includes("PAPER"); }
  check(rejected, "mode non PAPER rejeté avant calcul");
  rejected = false;
  try { executeM5({ engineVersion: "m5-independent-1", runId: "guard-test", history: { symbol: "XAUUSD-ECN" }, calendar } as never, () => {}); } catch (e) { rejected = e instanceof Error && e.message.includes("V1"); }
  check(rejected, "calendrier V1 refusé avant calcul");
  return { passed: true, assertions, months: ["juin", "juillet", "août", "septembre", "octobre"], syntheticOnly: true, noBacktestExecuted: true };
}
