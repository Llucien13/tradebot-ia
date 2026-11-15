import type { Candle } from "@/types";
import { classifyM5Gap } from "./m5-sessions";
import { m5SessionIndicators } from "./m5-session-indicators";
import { m5Setup, m5Schema } from "./m5-model";
import { scalpingIndicators } from "./signals";
import { validateM5History, runM5Backtest } from "./m5-engine";
import { runM5SessionBacktest } from "./m5-session-engine";
import { selectM5Runner } from "./m5-execution";
import { m5EligibilityDiagnostics } from "./m5-diagnostics";

// Deterministic indicator/session checks only: never runs a backtest or creates a trade.
export function checkM5SessionContinuity() {
  let assertions = 0;
  const check = (value: boolean, label: string) => { if (!value) throw new Error(`Vérification M5 : ${label}`); assertions++; };
  const time = (value: string) => Date.parse(value);
  check(classifyM5Gap(time("2026-01-05T21:55:00Z"), time("2026-01-05T23:00:00Z")) === "scheduled-close", "pause hiver New York");
  check(classifyM5Gap(time("2026-07-06T20:55:00Z"), time("2026-07-06T22:00:00Z")) === "scheduled-close", "pause été New York");
  check(classifyM5Gap(time("2026-01-09T21:55:00Z"), time("2026-01-11T23:00:00Z")) === "scheduled-close", "week-end hiver");
  check(classifyM5Gap(time("2026-03-06T21:55:00Z"), time("2026-03-08T22:00:00Z")) === "scheduled-close", "week-end changement heure été");
  check(classifyM5Gap(time("2026-10-30T20:55:00Z"), time("2026-11-01T23:00:00Z")) === "scheduled-close", "week-end changement heure hiver");
  check(classifyM5Gap(time("2026-07-06T12:00:00Z"), time("2026-07-06T12:10:00Z")) === "anomaly", "bougie absente en séance");
  check(classifyM5Gap(time("2026-07-06T20:45:00Z"), time("2026-07-06T22:00:00Z")) === "anomaly", "trou avant fermeture");
  check(classifyM5Gap(time("2026-07-06T12:00:00Z"), time("2026-07-06T12:00:00Z")) === "anomaly", "doublon");
  const first = time("2026-07-06T00:10:00Z");
  const base: Candle[] = Array.from({ length: 250 }, (_, index) => ({ time: first + index * 300000, open: 2600 + index * 0.1, high: 2601 + index * 0.1, low: 2599 + index * 0.1, close: 2600.5 + index * 0.1, volume: 100 }));
  // Last initial candle is 20:55 UTC; the next valid candle is 22:00 UTC.
  const tail: Candle[] = Array.from({ length: 10 }, (_, index) => ({ ...base[249], time: time("2026-07-06T22:00:00Z") + index * 300000, close: 2630 + index * 0.1, open: 2630, high: 2632, low: 2628 }));
  const candles = [...base, ...tail];
  const before = JSON.stringify(candles);
  const continuous = m5SessionIndicators(candles, m5Setup);
  const historical = scalpingIndicators(candles, m5Setup, 300000);
  check(continuous.rows.length === candles.length, "pas de bougie ajoutée");
  check(continuous.segmentStarts[250] === 0, "préchauffage conservé après pause");
  for (const key of ["fast", "middle", "slow", "atr", "rsi", "adx"] as const) {
    check(continuous.rows[250][key] !== null && Number.isFinite(continuous.rows[250][key]), `${key} conservé`);
    check(historical[250][key] === null, `${key} référence toujours réinitialisée`);
  }
  const prefix = m5SessionIndicators(candles.slice(0, 251), m5Setup);
  check(JSON.stringify(prefix.rows) === JSON.stringify(continuous.rows.slice(0, 251)), "aucun look-ahead");
  check(JSON.stringify(candles) === before, "données non modifiées");
  const broken = [...base, { ...tail[0], time: time("2026-07-06T22:10:00Z") }];
  const anomaly = m5SessionIndicators(broken, m5Setup);
  check(anomaly.segmentStarts[250] === 250 && anomaly.rows[250].slow === null, "anomalie réinitialise les indicateurs");
  check(m5SessionIndicators(base.slice(0, 13), m5Setup).rows[12].atr === null, "ATR initial insuffisant");
  check(m5SessionIndicators(base.slice(0, 49), m5Setup).rows[48].slow === null, "EMA50 initiale insuffisante");
  const m15: Candle[] = Array.from({length: 90}, (_, index) => ({ ...base[0], time: time("2026-07-06T00:30:00Z") + index * 900000 }));
  // Separate fixture with an actual scheduled M15 closure.
  const higherBase = m15.filter(c => c.time <= time("2026-07-06T20:45:00Z"));
  const higher = [...higherBase, { ...base[0], time: time("2026-07-06T22:00:00Z") }];
  const higherRows = m5SessionIndicators(higher, m5Setup, 900000);
  check(higherRows.segmentStarts[higher.length - 1] === 0 && higherRows.rows[higher.length - 1].slow !== null, "continuité EMA M15");
  check(classifyM5Gap(time("2026-07-06T20:30:00Z"), time("2026-07-06T22:00:00Z"), 900000) === "anomaly", "triple M15 manquant en séance");
  let rejected = false;
  try { validateM5History({ candles: [{ ...base[0], high: -1 }] }); } catch { rejected = true; }
  check(rejected, "lot invalide rejeté");
  check(selectM5Runner("m5-independent-1") === runM5Backtest, "dispatch V1 vers fonction historique");
  check(selectM5Runner("m5-session-continuity-2") === runM5SessionBacktest, "dispatch V2 vers fonction corrigée");
  rejected = false;
  try { selectM5Runner(undefined as never); } catch { rejected = true; }
  check(rejected, "absence de version ne retombe pas sur V1");
  const compressed = candles.map((c, i) => ({ ...c, time: candles[0].time + i * 300000 }));
  const expected = m5SessionIndicators(compressed, m5Setup);
  for (const key of ["fast", "middle", "slow", "atr", "rsi", "adx"] as const) {
    check(continuous.rows.slice(250).every((row, i) => row[key] === expected.rows[250 + i][key]), `${key} continuité numérique exacte à la réouverture`);
  }
  const weekendBase = base.map((c, i) => ({ ...c, time: time("2026-08-07T20:55:00Z") - (249 - i) * 300000 }));
  const weekend = [...weekendBase, ...tail.map((c, i) => ({ ...c, time: time("2026-08-09T22:00:00Z") + i * 300000 }))];
  const weekendRows = m5SessionIndicators(weekend, m5Setup);
  for (const key of ["fast", "middle", "slow", "atr", "rsi", "adx"] as const) {
    check(weekendRows.rows.slice(250).every((row, i) => row[key] === expected.rows[250 + i][key]), `${key} continuité numérique exacte après week-end août`);
  }
  const higherExpected = m5SessionIndicators(higher.map((c, i) => ({ ...c, time: higher[0].time + i * 900000 })), m5Setup, 900000);
  for (const key of ["fast", "middle", "slow", "atr", "rsi", "adx"] as const) {
    check(higherRows.rows.at(-1)![key] === higherExpected.rows.at(-1)![key], `${key} continuité numérique M15`);
  }
  const config = m5Schema.parse({ enabled: true });
  const v1 = m5EligibilityDiagnostics(candles, tail[0].time, config, "m5-independent-1");
  const v2 = m5EligibilityDiagnostics(candles, tail[0].time, config, "m5-session-continuity-2");
  check(v1.ignoredWarmup === 10 && v1.eligible === 0, "V1 bloque les 10 bougies après pause");
  check(v2.ignoredWarmup === 0 && v2.eligible === 9 && v2.noNextBar === 1, "V2 conserve éligibilité après pause");
  check(v2.normalClosures === 1 && v2.anomalies === 0 && v2.initialHistory === 250, "compteurs période et historique distincts");
  check(v2.tested === v2.eligible + v2.ignoredWarmup + v2.unavailableIndicators + v2.unavailableM15 + v2.noNextBar, "partition complète des bougies testées");
  const invalidGap = m5EligibilityDiagnostics(broken, broken[250].time, config, "m5-session-continuity-2");
  check(invalidGap.eligible === 0 && invalidGap.ignoredWarmup === 1 && invalidGap.anomalies === 1, "aucune éligibilité sur anomalie sans préchauffage");
  return { passed: true, assertions, noBacktestExecuted: true };
}
