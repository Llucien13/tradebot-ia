export type ShadowAssetClass = "METAL" | "FOREX" | "INDEX";
export type ShadowInstrumentAvailability = "READ_ONLY_ROUTE_PRESENT" | "NOT_VERIFIED";

export interface ShadowInstrumentCandidate {
  canonicalSymbol: string;
  assetClass: ShadowAssetClass;
  availability: ShadowInstrumentAvailability;
  brokerSymbol: string | null;
}

export const SHADOW_INSTRUMENT_CANDIDATES: readonly ShadowInstrumentCandidate[] = [
  { canonicalSymbol: "XAUUSD", assetClass: "METAL", availability: "READ_ONLY_ROUTE_PRESENT", brokerSymbol: "XAUUSD" },
  { canonicalSymbol: "XAGUSD", assetClass: "METAL", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "EURUSD", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "GBPUSD", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "USDJPY", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "AUDUSD", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "USDCAD", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "USDCHF", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "NZDUSD", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "EURJPY", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "GBPJPY", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "EURGBP", assetClass: "FOREX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "US100", assetClass: "INDEX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "US500", assetClass: "INDEX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "GER40", assetClass: "INDEX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "UK100", assetClass: "INDEX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "JP225", assetClass: "INDEX", availability: "NOT_VERIFIED", brokerSymbol: null },
  { canonicalSymbol: "HK50", assetClass: "INDEX", availability: "NOT_VERIFIED", brokerSymbol: null },
] as const;

export interface RankedShadowSignal {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  decisionAt: number;
  qualityScore: number;
}

export function rankShadowSignals(signals: readonly RankedShadowSignal[]): RankedShadowSignal[] {
  const instrumentSymbols = new Set(SHADOW_INSTRUMENT_CANDIDATES.map(candidate => candidate.canonicalSymbol));
  const ids = new Set<string>();
  const bestBySymbol = new Map<string, RankedShadowSignal>();

  for (const signal of signals) {
    if (!signal.id
      || ids.has(signal.id)
      || !instrumentSymbols.has(signal.symbol)
      || (signal.direction !== "BUY" && signal.direction !== "SELL")
      || !Number.isFinite(signal.decisionAt)
      || !Number.isFinite(signal.qualityScore)
      || signal.qualityScore < 0
      || signal.qualityScore > 100) {
      throw new Error("Signal Shadow invalide, dupliqué ou hors univers multi-actifs.");
    }
    ids.add(signal.id);
    const previous = bestBySymbol.get(signal.symbol);
    if (!previous
      || signal.decisionAt > previous.decisionAt
      || (signal.decisionAt === previous.decisionAt && signal.qualityScore > previous.qualityScore)) {
      bestBySymbol.set(signal.symbol, signal);
    }
  }

  return [...bestBySymbol.values()].sort((left, right) =>
    right.qualityScore - left.qualityScore
    || right.decisionAt - left.decisionAt
    || left.symbol.localeCompare(right.symbol));
}

export interface ShadowMarketQuote {
  bid: number;
  ask: number;
  observedAt: number;
  maxAgeMs: number;
}

export interface ShadowVerifiedInstrumentSpec {
  verified: boolean;
  source: string;
  symbol: string;
  accountCurrency: string;
  verifiedAt: number;
  maxAgeMs: number;
  contractUnitsPerLot: number;
  tickSize: number;
  tickValueEURPerLot: number;
  volumeMinimum: number;
  volumeMaximum: number;
  volumeStep: number;
  roundTurnCostsEURPerLot: number;
  marginEURPerLot: number;
}

export interface ShadowOpenPosition {
  symbol: string;
  riskEUR: number;
}

export interface ShadowCorrelationEvidence {
  symbolA: string;
  symbolB: string;
  coefficient: number;
  observations: number;
  timeframe: string;
  observedAt: number;
}

export interface ShadowVerifiedRiskLimits {
  verified: boolean;
  source: string;
  verifiedAt: number;
  maxAgeMs: number;
  maxConcurrentPositions: number;
  maximumPortfolioRiskEUR: number;
  remainingDailyLossAfterOpenRiskEUR: number;
  remainingOverallLossAfterOpenRiskEUR: number;
  maximumAbsoluteCorrelation: number;
  minimumCorrelationObservations: number;
  correlationMaxAgeMs: number;
}

export interface ShadowRiskPlanInput {
  now: number;
  symbol: string;
  accountCurrency: "EUR";
  equityEUR: number;
  riskPercent: number;
  freeMarginEUR: number;
  quote: ShadowMarketQuote;
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  specification: ShadowVerifiedInstrumentSpec;
  limits: ShadowVerifiedRiskLimits;
  openPositions: readonly ShadowOpenPosition[];
  correlations: readonly ShadowCorrelationEvidence[];
}

export type ShadowRiskRefusal =
  | "INVALID_INPUT"
  | "UNVERIFIED_INSTRUMENT"
  | "STALE_MARKET_QUOTE"
  | "STALE_INSTRUMENT_SPECIFICATION"
  | "UNVERIFIED_COSTS_OR_MARGIN"
  | "UNVERIFIED_RISK_LIMITS"
  | "POSITION_LIMIT"
  | "PORTFOLIO_RISK_LIMIT"
  | "DAILY_LOSS_LIMIT"
  | "OVERALL_LOSS_LIMIT"
  | "CORRELATION_UNAVAILABLE"
  | "CORRELATION_LIMIT"
  | "VOLUME_BELOW_MINIMUM"
  | "INSUFFICIENT_FREE_MARGIN";

export interface ShadowRiskPlan {
  accepted: boolean;
  refusal: ShadowRiskRefusal | null;
  symbol: string;
  riskBudgetEUR: number;
  volumeLots: number;
  plannedRiskEUR: number | null;
  marginRequiredEUR: number | null;
}

function refused(symbol: string, riskBudgetEUR: number, refusal: ShadowRiskRefusal): ShadowRiskPlan {
  return {
    accepted: false,
    refusal,
    symbol,
    riskBudgetEUR,
    volumeLots: 0,
    plannedRiskEUR: null,
    marginRequiredEUR: null,
  };
}

function isFresh(now: number, observedAt: number, maxAgeMs: number): boolean {
  return Number.isFinite(observedAt)
    && Number.isFinite(maxAgeMs)
    && maxAgeMs > 0
    && observedAt <= now
    && now - observedAt <= maxAgeMs;
}

function pairMatches(evidence: ShadowCorrelationEvidence, symbolA: string, symbolB: string): boolean {
  return (evidence.symbolA === symbolA && evidence.symbolB === symbolB)
    || (evidence.symbolA === symbolB && evidence.symbolB === symbolA);
}

export function planShadowRisk(input: ShadowRiskPlanInput): ShadowRiskPlan {
  const { specification: spec, limits } = input;
  const riskBudgetEUR = input.equityEUR * input.riskPercent / 100;
  const prices = [input.quote?.bid, input.quote?.ask, input.entryPrice, input.stopPrice, input.targetPrice];
  if (!Number.isFinite(input.now)
    || !Number.isFinite(input.equityEUR)
    || input.equityEUR <= 0
    || !Number.isFinite(input.riskPercent)
    || input.riskPercent <= 0
    || input.riskPercent > 0.5
    || !Number.isFinite(input.freeMarginEUR)
    || input.freeMarginEUR < 0
    || !prices.every(price => Number.isFinite(price) && price > 0)
    || input.quote.ask < input.quote.bid
    || (input.direction === "BUY"
      ? input.stopPrice >= input.entryPrice || input.targetPrice <= input.entryPrice
      : input.direction === "SELL"
        ? input.stopPrice <= input.entryPrice || input.targetPrice >= input.entryPrice
        : true)) {
    return refused(input.symbol, riskBudgetEUR, "INVALID_INPUT");
  }

  if (!spec.verified
    || !spec.source
    || spec.symbol !== input.symbol
    || spec.accountCurrency !== input.accountCurrency
    || ![
      spec.contractUnitsPerLot,
      spec.tickSize,
      spec.tickValueEURPerLot,
      spec.volumeMinimum,
      spec.volumeMaximum,
      spec.volumeStep,
    ].every(value => Number.isFinite(value) && value > 0)) {
    return refused(input.symbol, riskBudgetEUR, "UNVERIFIED_INSTRUMENT");
  }
  if (!isFresh(input.now, input.quote.observedAt, input.quote.maxAgeMs)) {
    return refused(input.symbol, riskBudgetEUR, "STALE_MARKET_QUOTE");
  }
  if (!isFresh(input.now, spec.verifiedAt, spec.maxAgeMs)) {
    return refused(input.symbol, riskBudgetEUR, "STALE_INSTRUMENT_SPECIFICATION");
  }
  if (!Number.isFinite(spec.roundTurnCostsEURPerLot)
    || spec.roundTurnCostsEURPerLot < 0
    || !Number.isFinite(spec.marginEURPerLot)
    || spec.marginEURPerLot <= 0) {
    return refused(input.symbol, riskBudgetEUR, "UNVERIFIED_COSTS_OR_MARGIN");
  }
  if (!limits.verified
    || !limits.source
    || !isFresh(input.now, limits.verifiedAt, limits.maxAgeMs)
    || !Number.isInteger(limits.maxConcurrentPositions)
    || limits.maxConcurrentPositions <= 0
    || !Number.isFinite(limits.maximumPortfolioRiskEUR)
    || limits.maximumPortfolioRiskEUR <= 0
    || !Number.isFinite(limits.remainingDailyLossAfterOpenRiskEUR)
    || !Number.isFinite(limits.remainingOverallLossAfterOpenRiskEUR)
    || !Number.isFinite(limits.maximumAbsoluteCorrelation)
    || limits.maximumAbsoluteCorrelation < 0
    || limits.maximumAbsoluteCorrelation > 1
    || !Number.isInteger(limits.minimumCorrelationObservations)
    || limits.minimumCorrelationObservations <= 0
    || !Number.isFinite(limits.correlationMaxAgeMs)
    || limits.correlationMaxAgeMs <= 0
    || !Number.isInteger(input.openPositions.length)
    || input.openPositions.some(position => !position.symbol || !Number.isFinite(position.riskEUR) || position.riskEUR < 0)) {
    return refused(input.symbol, riskBudgetEUR, "UNVERIFIED_RISK_LIMITS");
  }
  if (input.openPositions.length >= limits.maxConcurrentPositions) {
    return refused(input.symbol, riskBudgetEUR, "POSITION_LIMIT");
  }

  for (const position of input.openPositions) {
    const correlation = input.correlations.find(evidence =>
      pairMatches(evidence, input.symbol, position.symbol)
      && Number.isFinite(evidence.coefficient)
      && Math.abs(evidence.coefficient) <= 1
      && Number.isInteger(evidence.observations)
      && evidence.observations >= limits.minimumCorrelationObservations
      && !!evidence.timeframe
      && isFresh(input.now, evidence.observedAt, limits.correlationMaxAgeMs));
    if (!correlation) return refused(input.symbol, riskBudgetEUR, "CORRELATION_UNAVAILABLE");
    if (Math.abs(correlation.coefficient) >= limits.maximumAbsoluteCorrelation) {
      return refused(input.symbol, riskBudgetEUR, "CORRELATION_LIMIT");
    }
  }

  const openRiskEUR = input.openPositions.reduce((sum, position) => sum + position.riskEUR, 0);
  const portfolioHeadroomEUR = limits.maximumPortfolioRiskEUR - openRiskEUR;
  if (portfolioHeadroomEUR <= 0) return refused(input.symbol, riskBudgetEUR, "PORTFOLIO_RISK_LIMIT");
  if (limits.remainingDailyLossAfterOpenRiskEUR <= 0) return refused(input.symbol, riskBudgetEUR, "DAILY_LOSS_LIMIT");
  if (limits.remainingOverallLossAfterOpenRiskEUR <= 0) return refused(input.symbol, riskBudgetEUR, "OVERALL_LOSS_LIMIT");

  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
  const riskPerLotEUR = stopDistance / spec.tickSize * spec.tickValueEURPerLot
    + spec.roundTurnCostsEURPerLot;
  if (!Number.isFinite(riskPerLotEUR) || riskPerLotEUR <= 0) {
    return refused(input.symbol, riskBudgetEUR, "INVALID_INPUT");
  }
  const availableRiskEUR = Math.min(
    riskBudgetEUR,
    portfolioHeadroomEUR,
    limits.remainingDailyLossAfterOpenRiskEUR,
    limits.remainingOverallLossAfterOpenRiskEUR,
  );
  const volumeCeiling = Math.min(
    availableRiskEUR / riskPerLotEUR,
    input.freeMarginEUR / spec.marginEURPerLot,
    spec.volumeMaximum,
  );
  const volumeLots = Number((Math.floor((volumeCeiling + spec.volumeStep * 1e-10) / spec.volumeStep)
    * spec.volumeStep).toFixed(12));
  if (volumeLots < spec.volumeMinimum) {
    const minimumMargin = spec.volumeMinimum * spec.marginEURPerLot;
    if (minimumMargin > input.freeMarginEUR) {
      return refused(input.symbol, riskBudgetEUR, "INSUFFICIENT_FREE_MARGIN");
    }
    return refused(input.symbol, riskBudgetEUR, "VOLUME_BELOW_MINIMUM");
  }

  const plannedRiskEUR = volumeLots * riskPerLotEUR;
  const marginRequiredEUR = volumeLots * spec.marginEURPerLot;
  if (plannedRiskEUR > availableRiskEUR || marginRequiredEUR > input.freeMarginEUR) {
    return refused(
      input.symbol,
      riskBudgetEUR,
      marginRequiredEUR > input.freeMarginEUR ? "INSUFFICIENT_FREE_MARGIN" : "PORTFOLIO_RISK_LIMIT",
    );
  }
  return {
    accepted: true,
    refusal: null,
    symbol: input.symbol,
    riskBudgetEUR,
    volumeLots,
    plannedRiskEUR,
    marginRequiredEUR,
  };
}
