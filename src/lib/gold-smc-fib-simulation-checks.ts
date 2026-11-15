import {
  FIB_M15_INTERVAL_MS,
  fibonacciShadowSignal,
  type FibCandle,
} from "./fibonacci-shadow.ts";
import {
  DEFAULT_GOLD_SIMULATION_OPTIONS,
  runGoldSmcFibSimulation,
} from "./gold-smc-fib-backtest.ts";
import {
  analyzeExperimentalGoldSmcFib,
  type ExperimentalVariant,
} from "./gold-smc-fib-experimental.ts";

export function checkGoldSmcFibSimulation() {
  let assertions = 0;
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(`Simulation GOLD SMC Fibonacci : ${label}`);
    assertions++;
  };
  const candle = (index: number, open: number, high: number, low: number, close: number): FibCandle => ({
    time: index * FIB_M15_INTERVAL_MS, open, high, low, close,
  });

  const structureFixture = Array.from({ length: 24 }, (_, index) => candle(index, 100, 100.5, 99.5, 100));
  structureFixture[4] = candle(4, 99, 100, 90, 95);
  structureFixture[8] = candle(8, 105, 110, 100, 108);
  structureFixture[12] = candle(12, 100, 101, 95, 98);
  structureFixture[16] = candle(16, 105, 115, 100, 110);
  structureFixture[19] = candle(19, 99, 100, 93, 94);
  const structureAnalysis = analyzeExperimentalGoldSmcFib(structureFixture);
  check(structureAnalysis?.features[14].structure.includes("HL"), "HL é étiqueté après confirmation des deux bougies droites");
  check(structureAnalysis?.features[18].structure.includes("HH"), "HH n’est connu qu’à la clôture de la seconde bougie droite");
  check(structureAnalysis?.features[19].bias === "UP", "biais HH/HL calculé sur pivots confirmés avant la bougie courante");
  check(structureAnalysis?.features[19].breaks.some(event => event.kind === "MSS" && event.direction === "SELL"), "cassure opposée au biais classée MSS");

  const breakFixture = Array.from({ length: 24 }, (_, index) => candle(index, 10, 10.5, 9.5, 10));
  breakFixture[1] = candle(1, 10, 12, 9.5, 11);
  breakFixture[2] = candle(2, 11, 13, 10, 12);
  breakFixture[3] = candle(3, 12, 20, 11, 14);
  breakFixture[4] = candle(4, 14, 16, 12, 15);
  breakFixture[5] = candle(5, 15, 15.5, 11, 14);
  breakFixture[6] = candle(6, 15, 22, 14, 21);
  breakFixture[7] = candle(7, 20.5, 21, 14, 20.5);
  breakFixture[8] = candle(8, 20, 21.5, 16, 19);
  const breakAnalysis = analyzeExperimentalGoldSmcFib(breakFixture);
  check(breakFixture.every((bar, index) =>
    bar.high >= Math.max(bar.open, bar.close)
    && bar.low <= Math.min(bar.open, bar.close)
    && (index === 0 || bar.time - breakFixture[index - 1].time === FIB_M15_INTERVAL_MS),
  ), "fixture BOS composé de bougies OHLC M15 valides et chronologiques");
  check(breakAnalysis !== null, "historique BOS valide accepté par l’analyseur");
  check(breakAnalysis?.features[5].breaks.length === 0, "pivot de l’index 3 non disponible avant la clôture de la seconde bougie droite");
  check(breakAnalysis?.features[6].breaks.some(event =>
    event.direction === "BUY" && event.kind === "BOS" && event.index === 6 && event.level === 20,
  ), "clôture de l’index 6 casse le pivot index 3 confirmé à la clôture de l’index 5");
  check(breakAnalysis?.features[7].retests.some(event => event.retestIndices.includes(7)), "retest postérieur distinct de la cassure identifié à la clôture");
  check(breakAnalysis?.features[8].sweeps.some(event => event.direction === "SELL"), "mèche au-dessus du pivot puis clôture dessous identifiée comme balayage");
  check(breakAnalysis?.features[7].orderBlockTouches.length > 0, "zone OB du dernier chandelier opposé dans la fenêtre de cinq bougies testée");

  const fvgFixture = Array.from({ length: 28 }, (_, index) => candle(index, 100, 100.5, 99.5, 100));
  fvgFixture[19] = candle(19, 100, 103.2, 99.8, 103);
  fvgFixture[20] = candle(20, 104.5, 105, 104, 104.8);
  fvgFixture[21] = candle(21, 104, 105, 102, 104.5);
  const fvgAnalysis = analyzeExperimentalGoldSmcFib(fvgFixture);
  check(fvgAnalysis?.features[21].fvgTouches.some(zone => zone.direction === "BUY" && zone.low === 100.5 && zone.high === 104), "FVG trois bougies, corps médian déplacé et retest causal vérifiés");

  const fibFixture: FibCandle[] = [];
  for (let index = 0; index < 210; index++) {
    const close = 100 + index * 0.05;
    fibFixture.push(candle(index, close - 0.05, close + 0.2, index === 207 ? close - 2 : close - 0.2, close));
  }
  for (let index = 210; index < 231; index++) {
    const close = 110.45 + (index - 210) * 0.35;
    fibFixture.push(candle(index, close - 0.1, close + (index === 230 ? 0.5 : 0.2), index === 210 ? close - 3.5 : close - 0.25, close));
  }
  for (let index = 231; index < 239; index++) {
    const close = index === 231 ? 116 : index === 232 ? 114 : 112.5;
    fibFixture.push(candle(index, close + 0.1, close + 0.25, close - 0.25, close));
  }
  fibFixture.push(candle(239, 112.4, 113.5, 112.2, 113.2));
  const fibAnalysis = analyzeExperimentalGoldSmcFib(fibFixture);
  const originalFib = fibonacciShadowSignal(fibFixture, fibFixture[239].time + FIB_M15_INTERVAL_MS);
  const experimentalFib = fibAnalysis?.signals.fibonacci[239];
  check(!!originalFib && !!experimentalFib && originalFib.direction === experimentalFib.direction
    && originalFib.time === experimentalFib.time && Math.abs(originalFib.atr14 - experimentalFib.atr14) < 1e-10
    && Math.abs(originalFib.zoneLow - experimentalFib.zoneLow) < 1e-10
    && Math.abs(originalFib.zoneHigh - experimentalFib.zoneHigh) < 1e-10,
  "candidat Fibonacci causal identique à la fonction SHADOW existante");
  const extended = [...fibFixture, ...Array.from({ length: 4 }, (_, offset) => {
    const index = fibFixture.length + offset;
    return candle(index, 113.2, 113.4, 113, 113.2);
  })];
  check(analyzeExperimentalGoldSmcFib(extended)?.signals.fibonacci[239]?.time === experimentalFib?.time, "ajouter des bougies futures ne modifie aucun signal antérieur");
  check(fibonacciShadowSignal(fibFixture, fibFixture[239].time + FIB_M15_INTERVAL_MS - 1) === null, "bougie de décision encore ouverte non utilisée");

  const fx = Array.from({ length: 400 }, (_, index) => ({
    time: (index - 1) * FIB_M15_INTERVAL_MS,
    close: 1.1,
  }));
  const options = {
    ...DEFAULT_GOLD_SIMULATION_OPTIONS,
    startTime: fibFixture[239].time,
    endTime: (fibFixture[239].time + 41 * FIB_M15_INTERVAL_MS),
  };
  const withTp = [...fibFixture, candle(240, 113.2, 125, 113, 114), ...Array.from({ length: 40 }, (_, offset) => {
    const index = 241 + offset;
    return candle(index, 114, 114.2, 113.8, 114);
  })];
  const simulation = runGoldSmcFibSimulation(withTp, fx, "fibonacci", options);
  check(simulation.label.startsWith("SIMULATION") && simulation.trades.length === 1 && simulation.trades[0].reason === "TP", "entrée au prochain open et TP exécutés uniquement dans le moteur SIMULATION");
  check(simulation.trades[0].pnlEUR > 0 && simulation.trades[0].feesUSD > 0 && simulation.trades[0].equityEUR > options.initialCapitalEUR, "frais, conversion EUR et évolution du capital inclus");
  check(simulation.trades[0].entryTime > fibFixture[239].time, "exécution strictement postérieure à la bougie signal");
  const variants: ExperimentalVariant[] = ["fibonacci", "structure", "sweep", "retest", "fvg", "order-block", "fvg+order-block"];
  check(variants.every(variant => fibAnalysis?.signals[variant].length === fibFixture.length), "ensemble d’ablation complet pour les sept variantes");

  const invalidFx = runGoldSmcFibSimulation(
    withTp,
    [{ time: withTp[240].time + FIB_M15_INTERVAL_MS, close: 1.1 }],
    "fibonacci",
    options,
  );
  check(invalidFx.trades.length === 0 && invalidFx.rejectedFx > 0, "entrée refusée sans conversion EUR/USD disponible");
  return { passed: true, assertions, noTradesExecuted: true };
}
