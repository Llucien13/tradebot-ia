import {
  buildArchivedGoldSignals,
  buildHistoricalVariantCandidates,
  type HistoricalSignal,
} from "./gold-smc-fib-historical.ts";
import {
  analyzeExperimentalGoldSmcFib,
  GOLD_SMC_FIB_EXPERIMENTAL_RULES,
} from "./gold-smc-fib-experimental.ts";
import { FIB_M15_INTERVAL_MS, type FibCandle } from "./fibonacci-shadow.ts";
import { GOLD_PAPER_SHADOW_SYMBOL } from "./gold-paper-shadow-readiness.ts";

export const GOLD_SHADOW_TIMEFRAMES = ["M15", "M30", "H4", "D1"] as const;
export type GoldShadowTimeframe = typeof GOLD_SHADOW_TIMEFRAMES[number];

export interface GoldShadowCandle extends FibCandle {
  tickVolume?: number;
  realVolume?: number;
  spreadPoints?: number;
}

export interface GoldShadowFeed {
  source: "MT5";
  readOnly: true;
  symbol: string;
  timeframe: string;
  closedBarsOnly: true;
  fetchedAt: string;
  candles: GoldShadowCandle[];
}

export interface GoldShadowFeedLimits {
  M15: number;
  M30: number;
  H4: number;
  D1: number;
}

export interface GoldShadowSignalRecord {
  direction: "BUY" | "SELL";
  decisionAt: number;
  entryAt: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  atr14: number;
  source:
    | "ARCHIVED_GOLD"
    | "GOLD_PLUS_EXPERIMENTAL_SMC"
    | "GOLD_PLUS_EXPERIMENTAL_FIBONACCI"
    | "GOLD_PLUS_EXPERIMENTAL_SMC_AND_FIBONACCI";
}

export interface GoldShadowExperimentalCandidate {
  strategy: "GOLD_FIBONACCI" | "GOLD_SMC_FIBONACCI";
  optionalFilters: readonly ("SMC" | "FIBONACCI")[];
  ruleset: typeof GOLD_SMC_FIB_EXPERIMENTAL_RULES.status;
  signal: GoldShadowSignalRecord | null;
}

export interface GoldShadowBarComparison {
  decisionAt: number;
  signalBarTime: number;
  executionBarTime: number;
  executionSpreadPoints: number | null;
  gold: GoldShadowSignalRecord | null;
  goldSmc: GoldShadowSignalRecord | null;
  experimentalCandidates: GoldShadowExperimentalCandidate[];
  agreement: "BOTH_NONE" | "GOLD_ONLY" | "GOLD_SMC_ONLY" | "SAME_DIRECTION" | "DIRECTION_CONFLICT";
  smcRuleset: typeof GOLD_SMC_FIB_EXPERIMENTAL_RULES.status;
  sizingDecision: "NOT_APPLICABLE" | "REFUSED_UNVERIFIED_SYMBOL_SPECIFICATIONS";
  sizingRefusal: string | null;
  capitalEUR: 20_000;
  riskPercent: 0.5;
  riskBudgetEUR: 100;
  hypotheticalVolumeLots: null;
  costsEUR: null;
  simulatedResult: null;
  simulatedResultUnavailableReason: string | null;
}

export function validateGoldShadowFeed(
  payload: unknown,
  timeframe: GoldShadowTimeframe,
  now: number,
  maxAgeMs: number | null,
): GoldShadowFeed {
  if (!Number.isFinite(now)
    || (maxAgeMs !== null && (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0))) {
    throw new Error("Limites de fraîcheur du flux Shadow invalides.");
  }
  if (!payload || typeof payload !== "object") throw new Error("Réponse du flux XAUUSD invalide.");
  const feed = payload as Partial<GoldShadowFeed>;
  if (feed.source !== "MT5"
    || feed.readOnly !== true
    || feed.closedBarsOnly !== true
    || feed.symbol !== GOLD_PAPER_SHADOW_SYMBOL
    || feed.timeframe !== timeframe
    || !Array.isArray(feed.candles)
    || typeof feed.fetchedAt !== "string"
    || !Number.isFinite(Date.parse(feed.fetchedAt))) {
    throw new Error(`Le flux ${timeframe} n'est pas MT5 en lecture seule avec bougies clôturées XAUUSD.`);
  }
  const fetchedAt = Date.parse(feed.fetchedAt);
  if (fetchedAt > now || now - fetchedAt > 2 * 60_000) {
    throw new Error(`La réponse du flux ${timeframe} est périmée ou horodatée dans le futur.`);
  }
  const candles = feed.candles as GoldShadowCandle[];
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    if (![candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
      || candle.time < 0
      || candle.open <= 0
      || candle.high < Math.max(candle.open, candle.close)
      || candle.low > Math.min(candle.open, candle.close)
      || (index > 0 && candle.time <= candles[index - 1].time)) {
      throw new Error(`Bougie ${timeframe} OHLC invalide, dupliquée ou hors chronologie.`);
    }
    if (candle.spreadPoints !== undefined && (!Number.isFinite(candle.spreadPoints) || candle.spreadPoints < 0)) {
      throw new Error(`Spread en points invalide dans le flux ${timeframe}.`);
    }
  }
  const last = candles[candles.length - 1];
  if (!last || last.time + timeframeMilliseconds(timeframe) > now) {
    throw new Error(`Le flux ${timeframe} ne contient pas de dernière bougie clôturée.`);
  }
  if (maxAgeMs !== null && now - (last.time + timeframeMilliseconds(timeframe)) > maxAgeMs) {
    throw new Error(`Le flux ${timeframe} est périmé; aucune donnée de remplacement n'est utilisée.`);
  }
  return feed as GoldShadowFeed;
}

export function timeframeMilliseconds(timeframe: GoldShadowTimeframe): number {
  switch (timeframe) {
    case "M15": return FIB_M15_INTERVAL_MS;
    case "M30": return 30 * 60 * 1000;
    case "H4": return 4 * 60 * 60 * 1000;
    case "D1": return 24 * 60 * 60 * 1000;
  }
}

function toSignalRecord(
  signal: HistoricalSignal | null,
  signalBar: GoldShadowCandle,
  executionBar: GoldShadowCandle,
  source: GoldShadowSignalRecord["source"],
): GoldShadowSignalRecord | null {
  if (!signal) return null;
  if (signal.time !== executionBar.time || executionBar.time !== signalBar.time + FIB_M15_INTERVAL_MS) {
    throw new Error("L'entrée SHADOW n'est pas à l'ouverture de la bougie M15 suivante.");
  }
  const stopDistance = 2.5 * signal.atr14;
  const sign = signal.direction === "BUY" ? 1 : -1;
  return {
    direction: signal.direction,
    decisionAt: signalBar.time + FIB_M15_INTERVAL_MS,
    entryAt: executionBar.time,
    entryPrice: executionBar.open,
    stopPrice: executionBar.open - sign * stopDistance,
    targetPrice: executionBar.open + sign * stopDistance * 2.5,
    atr14: signal.atr14,
    source,
  };
}

export function buildGoldShadowComparisons(
  m15: GoldShadowCandle[],
  m30: GoldShadowCandle[],
  h4: GoldShadowCandle[],
  d1: GoldShadowCandle[],
): GoldShadowBarComparison[] {
  const goldSignals = buildArchivedGoldSignals(m15, m30, h4, d1);
  const experimental = analyzeExperimentalGoldSmcFib(m15);
  if (!experimental) throw new Error("L'analyse SMC expérimentale a refusé les données M15.");
  const candidates = buildHistoricalVariantCandidates(goldSignals, experimental, 48);
  const goldSmcSignals = candidates.find(candidate => candidate.id === "gold-smc")?.signals;
  const goldFibSignals = candidates.find(candidate => candidate.id === "gold-fibonacci")?.signals;
  const goldSmcFibSignals = candidates.find(candidate => candidate.id === "gold-smc-fibonacci")?.signals;
  if (!goldSmcSignals || !goldFibSignals || !goldSmcFibSignals
    || goldSmcSignals.length !== m15.length
    || goldFibSignals.length !== m15.length
    || goldSmcFibSignals.length !== m15.length) {
    throw new Error("La variante expérimentale GOLD + SMC n'a pas produit une série comparable.");
  }

  const comparisons: GoldShadowBarComparison[] = [];
  for (let index = 199; index < m15.length - 1; index++) {
    const signalBar = m15[index];
    const executionBar = m15[index + 1];
    if (executionBar.time - signalBar.time !== FIB_M15_INTERVAL_MS) continue;

    const gold = toSignalRecord(goldSignals[index], signalBar, executionBar, "ARCHIVED_GOLD");
    const goldSmc = toSignalRecord(goldSmcSignals[index], signalBar, executionBar, "GOLD_PLUS_EXPERIMENTAL_SMC");
    const experimentalCandidates: GoldShadowExperimentalCandidate[] = [
      {
        strategy: "GOLD_FIBONACCI",
        optionalFilters: ["FIBONACCI"],
        ruleset: GOLD_SMC_FIB_EXPERIMENTAL_RULES.status,
        signal: toSignalRecord(
          goldFibSignals[index],
          signalBar,
          executionBar,
          "GOLD_PLUS_EXPERIMENTAL_FIBONACCI",
        ),
      },
      {
        strategy: "GOLD_SMC_FIBONACCI",
        optionalFilters: ["SMC", "FIBONACCI"],
        ruleset: GOLD_SMC_FIB_EXPERIMENTAL_RULES.status,
        signal: toSignalRecord(
          goldSmcFibSignals[index],
          signalBar,
          executionBar,
          "GOLD_PLUS_EXPERIMENTAL_SMC_AND_FIBONACCI",
        ),
      },
    ];
    const agreement = !gold && !goldSmc
      ? "BOTH_NONE"
      : gold && !goldSmc
        ? "GOLD_ONLY"
        : !gold && goldSmc
          ? "GOLD_SMC_ONLY"
          : gold!.direction === goldSmc!.direction ? "SAME_DIRECTION" : "DIRECTION_CONFLICT";
    const hasSignal = gold !== null || goldSmc !== null;
    comparisons.push({
      decisionAt: signalBar.time + FIB_M15_INTERVAL_MS,
      signalBarTime: signalBar.time,
      executionBarTime: executionBar.time,
      executionSpreadPoints: executionBar.spreadPoints ?? null,
      gold,
      goldSmc,
      experimentalCandidates,
      agreement,
      smcRuleset: GOLD_SMC_FIB_EXPERIMENTAL_RULES.status,
      sizingDecision: hasSignal ? "REFUSED_UNVERIFIED_SYMBOL_SPECIFICATIONS" : "NOT_APPLICABLE",
      sizingRefusal: hasSignal
        ? "Taille du contrat, valeur tick, devises, pas/min/max de volume, coûts et marge vérifiables absents du flux GET /candles."
        : null,
      capitalEUR: 20_000,
      riskPercent: 0.5,
      riskBudgetEUR: 100,
      hypotheticalVolumeLots: null,
      costsEUR: null,
      simulatedResult: null,
      simulatedResultUnavailableReason: hasSignal
        ? "Aucun volume ni coûts vérifiés : résultat financier simulé non calculable."
        : null,
    });
  }
  return comparisons;
}

export function detectCandleGaps(candles: GoldShadowCandle[], timeframe: GoldShadowTimeframe) {
  const gaps: { previousTime: number; nextTime: number; elapsedMs: number }[] = [];
  const expectedIntervalMs = timeframeMilliseconds(timeframe);
  for (let index = 1; index < candles.length; index++) {
    const elapsedMs = candles[index].time - candles[index - 1].time;
    if (elapsedMs > expectedIntervalMs) {
      gaps.push({ previousTime: candles[index - 1].time, nextTime: candles[index].time, elapsedMs });
    }
  }
  return gaps;
}

export function detectM15Gaps(candles: GoldShadowCandle[]) {
  return detectCandleGaps(candles, "M15");
}
