import { FIB_M15_INTERVAL_MS, type FibCandle } from "./fibonacci-shadow.ts";
import { GOLD_SMC_SHADOW_PARAMETERS, goldSmcShadowAnalysis } from "./gold-smc-shadow.ts";
import { compareGoldStrategyShadowAt } from "./gold-strategy-shadow-comparison.ts";

export function checkGoldSmcShadow() {
  let assertions = 0;
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(`GOLD SMC shadow : ${label}`);
    assertions++;
  };
  const candle = (index: number, open: number, high: number, low: number, close: number): FibCandle => ({
    time: index * FIB_M15_INTERVAL_MS, open, high, low, close,
  });
  const candles = [
    candle(0, 10, 11, 9, 10), candle(1, 10, 12, 9.5, 11), candle(2, 11, 12.5, 10, 12),
    candle(3, 12, 15, 11, 13), candle(4, 13, 13.5, 11.5, 12), candle(5, 12, 13, 11.8, 12.5),
    candle(6, 14, 16, 13.5, 15.5), candle(7, 15.4, 15.8, 14.8, 15.2),
  ];
  const beforeBreakClose = goldSmcShadowAnalysis(candles, 6 * FIB_M15_INTERVAL_MS);
  check(beforeBreakClose?.breaks.length === 0, "barre de cassure encore ouverte ignorée");

  const analysis = goldSmcShadowAnalysis(candles, 8 * FIB_M15_INTERVAL_MS);
  check(analysis?.breaks.length === 1 && analysis.breaks[0].direction === "UP", "BOS détectée sur clôture au-dessus d’un pivot confirmé");
  check(analysis?.breaks[0].retests.includes(8 * FIB_M15_INTERVAL_MS), "retest observé sur une bougie ultérieure clôturée");
  check(analysis?.lastClosedCandle?.direction === "BEARISH", "direction de la dernière bougie clôturée exposée");
  check(analysis?.tradableSignal === null && analysis.historicalEntryRulesAvailable === false, "analyse SMC jamais promue en signal exécutable");
  check(GOLD_SMC_SHADOW_PARAMETERS.referenceCapitalEUR === 20_000 && GOLD_SMC_SHADOW_PARAMETERS.riskPercent === 0.5
    && GOLD_SMC_SHADOW_PARAMETERS.stopATRMultiple === 2.5 && GOLD_SMC_SHADOW_PARAMETERS.takeProfitR === 2.5
    && GOLD_SMC_SHADOW_PARAMETERS.expiryBars === 48 && GOLD_SMC_SHADOW_PARAMETERS.maxConcurrentPositions === 1,
  "profil SHADOW conforme aux paramètres demandés, sans calcul de lots ni position");
  check(analysis?.fairValueGaps.evaluated === false && analysis.orderBlocks.evaluated === false, "FVG et Order Blocks laissés non évalués sans règles historiques");

  const sweepCandles = [
    candle(0, 10, 11, 9, 10), candle(1, 10, 12, 9.5, 11), candle(2, 11, 12.5, 10, 12),
    candle(3, 12, 15, 11, 13), candle(4, 13, 13.5, 11.5, 12), candle(5, 12, 13, 11.8, 12.5),
    candle(6, 14, 15.5, 13.5, 14.8),
  ];
  const sweep = goldSmcShadowAnalysis(sweepCandles, 7 * FIB_M15_INTERVAL_MS);
  check(sweep?.liquiditySweeps.some(event => event.side === "HIGH"), "balayage de liquidité rapporté après réintégration à la clôture");
  check(goldSmcShadowAnalysis(candles, candles[7].time + FIB_M15_INTERVAL_MS - 1)?.lastClosedCandle?.time === candles[6].time, "bougie non clôturée absente de l’analyse");
  check(goldSmcShadowAnalysis([...candles, candle(8, 15, 16, 14, 15.5)], 8 * FIB_M15_INTERVAL_MS)?.lastClosedCandle?.time === candles[7].time, "bougies postérieures à decisionAt ignorées");
  const malformedFuture = { ...candle(8, 15, 16, 14, 15.5), high: Number.NaN };
  check(goldSmcShadowAnalysis([...candles, malformedFuture], 8 * FIB_M15_INTERVAL_MS)?.lastClosedCandle?.time === candles[7].time, "bougie future invalide sans effet sur la décision présente");
  check(goldSmcShadowAnalysis([candles[1], candles[0]], 8 * FIB_M15_INTERVAL_MS) === null, "historique désordonné refusé");

  const comparison = compareGoldStrategyShadowAt(candles, 8 * FIB_M15_INTERVAL_MS, {
    source: "GOLD", direction: "BUY", time: 8 * FIB_M15_INTERVAL_MS,
  });
  check(comparison?.shadowOnly && !comparison.ordersSent && !comparison.paperMotorNotified, "comparaison isolée du moteur PAPER");
  check(comparison?.directionAgreement === (comparison.proposedSignal ? true : null), "comparaison de direction sans réémettre le signal");
  const smcCandidate = { source: "SMC" as const, direction: "SELL" as const, time: 8 * FIB_M15_INTERVAL_MS };
  const goldCandidate = { source: "GOLD" as const, direction: "BUY" as const, time: 8 * FIB_M15_INTERVAL_MS };
  check(compareGoldStrategyShadowAt(candles, 8 * FIB_M15_INTERVAL_MS, null, { verified: true, gold: goldCandidate, smc: smcCandidate })?.proposedSignal?.source === "GOLD", "priorité GOLD sur SMC injectés sans exécution");
  check(compareGoldStrategyShadowAt(candles, 8 * FIB_M15_INTERVAL_MS, null, { verified: true, smc: smcCandidate })?.proposedSignal?.source === "SMC", "priorité SMC avant Fibonacci quand vérifié");
  return { passed: true, assertions, noTradesExecuted: true };
}
