import { confirmedM15Pivots, FIB_M15_INTERVAL_MS, fibonacciShadowSignal, selectShadowCandidate, type FibCandle, type ShadowCandidate } from "./fibonacci-shadow.ts";

export function checkFibonacciShadow() {
  let assertions = 0;
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(`Fibonacci shadow : ${label}`);
    assertions++;
  };
  const candle = (index: number, open: number, high: number, low: number, close: number): FibCandle => ({ time: index * FIB_M15_INTERVAL_MS, open, high, low, close });
  const pivotsFixture = [
    candle(0, 10, 11, 9, 10), candle(1, 10, 12, 9, 11), candle(2, 11, 13, 10, 12),
    candle(3, 12, 20, 11, 13), candle(4, 13, 15, 11, 14), candle(5, 14, 14, 10, 12),
    candle(6, 12, 13, 9, 11),
  ];
  check(!confirmedM15Pivots(pivotsFixture, 5 * FIB_M15_INTERVAL_MS + FIB_M15_INTERVAL_MS - 1).some(pivot => pivot.index === 3), "pivot 3L/2R non connu avant fermeture des deux bougies droites");
  check(confirmedM15Pivots(pivotsFixture, 7 * FIB_M15_INTERVAL_MS).some(pivot => pivot.side === "HIGH" && pivot.index === 3 && pivot.confirmedAt === 6 * FIB_M15_INTERVAL_MS), "pivot confirmé après les deux bougies droites clôturées");

  const candles: FibCandle[] = [];
  for (let index = 0; index < 210; index++) {
    const close = 100 + index * 0.05;
    candles.push(candle(index, close - 0.05, close + 0.2, index === 207 ? close - 2 : close - 0.2, close));
  }
  for (let index = 210; index < 231; index++) {
    const close = 110.45 + (index - 210) * 0.35;
    const low = index === 210 ? close - 3.5 : close - 0.25;
    candles.push(candle(index, close - 0.1, close + (index === 230 ? 0.5 : 0.2), low, close));
  }
  for (let index = 231; index < 239; index++) {
    const close = index === 231 ? 116 : index === 232 ? 114 : 112.5;
    candles.push(candle(index, close + 0.1, close + 0.25, close - 0.25, close));
  }
  candles.push(candle(239, 112.4, 113.5, 112.2, 113.2));
  const signal = fibonacciShadowSignal(candles, candles[239].time + FIB_M15_INTERVAL_MS);
  check(signal?.direction === "BUY" && signal.shadowOnly, "réaction haussière clôturée en zone après impulsion et tendance alignées");
  if (signal) {
    check(signal.zoneLow <= signal.zoneHigh && signal.entry > signal.zoneHigh, "zone de retracement 50–61,8 % et clôture de réaction");
    check(Math.abs(signal.entry - signal.sl - 2.5 * signal.atr14) < 1e-8, "SL de 2,5 ATR14 sans ordre envoyé");
    check(Math.abs(signal.tp - signal.entry - 2.5 * (signal.entry - signal.sl)) < 1e-8, "TP à 2,5R");
    check(signal.expiresAt - signal.time === 48 * FIB_M15_INTERVAL_MS && signal.riskPercent === 0.5, "expiration 48 bougies M15 et risque nominal déclaré");
  }
  check(fibonacciShadowSignal(candles, candles[239].time + FIB_M15_INTERVAL_MS - 1) === null, "dernière bougie encore ouverte ignorée");
  const candidate = (source: ShadowCandidate["source"]): ShadowCandidate => ({ source, direction: "BUY", time: 1 });
  check(selectShadowCandidate(candidate("GOLD"), candidate("SMC"), candidate("FIBONACCI"))?.source === "GOLD", "priorité GOLD");
  check(selectShadowCandidate(null, candidate("SMC"), candidate("FIBONACCI"))?.source === "SMC", "priorité SMC avant Fibonacci");
  check(selectShadowCandidate(null, null, candidate("FIBONACCI"))?.source === "FIBONACCI", "Fibonacci utilisé seulement sans signaux prioritaires");
  return { passed: true, assertions, noTradesExecuted: true };
}