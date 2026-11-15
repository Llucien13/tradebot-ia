import { FIB_M15_INTERVAL_MS, type FibCandle } from "./fibonacci-shadow.ts";
import {
  GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS,
  buildArchivedGoldSignals,
  buildHistoricalVariantCandidates,
  simulateHistoricalVariant,
  type HistoricalSignal,
  type HistoricalVariantCandidates,
  type TimedOHLC,
} from "./gold-smc-fib-historical.ts";
import type { ExperimentalAnalysis } from "./gold-smc-fib-experimental.ts";

export function checkGoldSmcFibHistorical() {
  let assertions = 0;
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(`Contrôles historiques GOLD SMC Fibonacci : ${label}`);
    assertions++;
  };
  const candle = (index: number, interval: number, baseTime: number, open: number, high: number, low: number, close: number): TimedOHLC => ({
    time: baseTime + index * interval, open, high, low, close,
  });
  const offset = 10 * 24 * 60 * 60 * 1000;
  const m15 = Array.from({ length: 330 }, (_, index) => {
    const close = 100 + index * 0.02;
    return candle(index, FIB_M15_INTERVAL_MS, offset, close - 0.01, close + 0.25, close - 0.25, close);
  });
  const triggerClose = 100 + 300 * 0.02 + 1;
  m15[300] = candle(300, FIB_M15_INTERVAL_MS, offset, triggerClose - 0.2, triggerClose + 0.05, triggerClose - 0.3, triggerClose);
  const makeHigher = (count: number, interval: number) => Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.1;
    return candle(index, interval, 0, close - 0.02, close + 0.05, close - 0.05, close);
  });
  const m30 = makeHigher(1200, 30 * 60 * 1000);
  const h4 = makeHigher(100, 4 * 60 * 60 * 1000);
  const d1 = makeHigher(20, 24 * 60 * 60 * 1000);
  const signals = buildArchivedGoldSignals(m15, m30, h4, d1);
  check(signals[300]?.direction === "BUY" && signals[300]?.signalIndex === 300
    && signals[300]?.time === m15[300].time + FIB_M15_INTERVAL_MS
    && signals[300]?.time === m15[301].time,
  "signal GOLD n’utilise que la clôture 300 et son horodatage correspond à l’open 301");
  const futureM15Changed = [...m15];
  futureM15Changed[301] = candle(301, FIB_M15_INTERVAL_MS, offset, 108, 109.2, 107.8, 109);
  const afterFutureM15Change = buildArchivedGoldSignals(futureM15Changed, m30, h4, d1);
  check(afterFutureM15Change[300]?.direction === signals[300]?.direction
    && afterFutureM15Change[300]?.time === signals[300]?.time,
  "OHLC de la bougie d’exécution 301 n’influence pas le signal calculé à la clôture 300");
  check(signals.slice(0, 199).every(signal => signal === null), "EMA200 historique indisponible avant 200 clôtures");

  const futureChanged = [...m30];
  futureChanged[1000] = { ...futureChanged[1000], close: futureChanged[1000].close + 10_000, high: futureChanged[1000].high + 10_000 };
  const changedSignals = buildArchivedGoldSignals(m15, futureChanged, h4, d1);
  check(changedSignals.slice(0, 300).every((signal, index) =>
    signal?.direction === signals[index]?.direction && signal?.time === signals[index]?.time,
  ), "données M30 publiées après le signal ne modifient pas les décisions passées");
  let invalidHigherTimeframeRejected = false;
  try {
    buildArchivedGoldSignals(m15, m30, h4, d1.map((bar, index) =>
      index === 4 ? { ...bar, time: d1[3].time } : bar,
    ));
  } catch {
    invalidHigherTimeframeRejected = true;
  }
  check(invalidHigherTimeframeRejected, "historique de timeframe désordonné refusé explicitement");

  const features: ExperimentalAnalysis["features"] = Array.from({ length: m15.length }, () => ({
    bias: "UP",
    structure: [],
    breaks: [],
    sweeps: [],
    retests: [],
    fvgTouches: [],
    orderBlockTouches: [],
  }));
  features[300] = {
    ...features[300],
    breaks: [{ direction: "BUY", kind: "BOS", index: 299, level: 100, retestIndices: [300] }],
    fvgTouches: [{ direction: "BUY", index: 298, low: 100, high: 101 }],
    orderBlockTouches: [{ direction: "BUY", breakIndex: 299, sourceIndex: 297, low: 100, high: 101 }],
  };
  const analysis: ExperimentalAnalysis = {
    features,
    diagnostics: { pivots: 0, breaks: 1, sweeps: 0, fvgs: 1, orderBlocks: 1 },
    signals: {
      fibonacci: Array(m15.length).fill(null),
      structure: Array(m15.length).fill(null),
      sweep: Array(m15.length).fill(null),
      retest: Array(m15.length).fill(null),
      fvg: Array(m15.length).fill(null),
      "order-block": Array(m15.length).fill(null),
      "fvg+order-block": Array(m15.length).fill(null),
    },
  };
  analysis.signals.fibonacci[300] = {
    direction: "BUY", time: m15[301].time, signalIndex: 300, close: m15[300].close,
    atr14: 0.3, swingLow: 100, swingHigh: 110, zoneLow: 103, zoneHigh: 105,
  };
  const variants = buildHistoricalVariantCandidates(signals, analysis);
  const at300 = (id: string) => variants.find(variant => variant.id === id)?.signals[300] ?? null;
  check(at300("gold") !== null && at300("gold-smc") !== null, "ablation GOLD seul et filtre SMC composés sur données vérifiées");
  check(at300("gold-fibonacci") !== null && at300("gold-smc-fibonacci") !== null, "variantes Fibonacci et confluence composées");
  check(at300("gold-fvg") !== null && at300("gold-smc-fvg") !== null, "FVG comparé sans et avec filtre complémentaire");
  check(at300("gold-order-block") !== null && at300("gold-smc-order-block") !== null, "Order Block comparé sans et avec filtre complémentaire");

  const candles: FibCandle[] = Array.from({ length: 55 }, (_, index) =>
    candle(index, FIB_M15_INTERVAL_MS, offset, 100, 100.5, 99.5, 100),
  );
  candles[6] = { ...candles[6], high: 107, low: 96 };
  const simCandidate: HistoricalSignal = { direction: "BUY", signalIndex: 5, time: candles[6].time, atr14: 1 };
  const simVariant: HistoricalVariantCandidates = {
    id: "gold", label: "fixture", signals: Array(candles.length).fill(null),
  };
  simVariant.signals[5] = simCandidate;
  const simulation = simulateHistoricalVariant(candles, simVariant, {
    year: 2025, startIndex: 0, endIndex: candles.length,
  });
  const trade = simulation.tradesDetail[0];
  check(trade.exitReason === "SL" && trade.conservativeAmbiguousBar, "SL prioritaire lorsque SL et TP sont touchés dans la même M15");
  check(Math.abs(trade.netR + 1) < 1e-10 && trade.plannedRiskUSDPerLot === 296, "R net inclut spread, slippage et commissions round-trip");
  check(trade.entryTime === candles[6].time && trade.exitTime === candles[6].time, "signal clôturé exécuté à l’open suivant, sortie horodatée à la barre");
  check(simulation.trades === 1 && simulation.finalCapitalIndex === 19_900, "risque fractionnel de 0,5 % et une seule position traduits dans l’indice");
  check(GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.expiryBars === 48, "expiration configurée à 48 bougies M15");
  return { passed: true, assertions, noTradesExecuted: true };
}
