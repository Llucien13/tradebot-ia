export type PaperShadowStrategy = "GOLD" | "GOLD_SMC" | "GOLD_FIBONACCI" | "GOLD_SMC_FIBONACCI";
export type PaperShadowDirection = "BUY" | "SELL";

export const GOLD_PAPER_SHADOW_SYMBOL = "XAUUSD";

export interface PaperShadowSignal {
  id: string;
  strategy: PaperShadowStrategy;
  symbol: string;
  timeframe: "M15";
  datasetId: string;
  decisionAt: number;
  intendedEntryAt: number;
  direction: PaperShadowDirection;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
}

export interface PaperShadowComparison {
  datasetId: string;
  symbol: string;
  timeframe: "M15";
  decisionAt: number;
  gold: PaperShadowSignal | null;
  goldSmc: PaperShadowSignal | null;
  outcome: "BOTH_NONE" | "GOLD_ONLY" | "GOLD_SMC_ONLY" | "SAME_DIRECTION" | "DIRECTION_CONFLICT";
}

export interface PaperShadowSymbolSpecification {
  symbol: string;
  verified: boolean;
  source: string;
  verifiedAt: number;
  accountCurrency: string;
  profitCurrency: string;
  contractUnitsPerLot: number;
  volumeMinimum: number;
  volumeMaximum: number;
  volumeStep: number;
  leverage: number;
}

export interface PaperShadowFxQuote {
  fromCurrency: string;
  toCurrency: string;
  fromToRate: number;
  observedAt: number;
  source: string;
}

export interface PaperShadowSizingInput {
  now: number;
  marketSymbol: string;
  capital: number;
  riskPercent: number;
  maxPortfolioRiskPercent: number;
  existingPositionCount: number;
  existingOpenRisk: number;
  freeMargin: number;
  quoteObservedAt: number;
  intendedEntryAt: number;
  entryPrice: number;
  stopPrice: number;
  spreadPrice: number;
  slippagePricePerSide: number;
  commissionProfitCurrencyPerLotPerSide: number;
  marginAccountCurrencyPerLot: number;
  symbolSpecification: PaperShadowSymbolSpecification;
  fxQuote: PaperShadowFxQuote;
  maxQuoteAgeMs: number;
}

export type PaperShadowSizingRejection =
  | "INVALID_INPUT"
  | "SYMBOL_MISMATCH"
  | "UNVERIFIED_SYMBOL_SPECIFICATION"
  | "STALE_SYMBOL_SPECIFICATION"
  | "INVALID_FX_QUOTE"
  | "STALE_FX_QUOTE"
  | "STALE_MARKET_QUOTE"
  | "POSITION_LIMIT"
  | "PORTFOLIO_RISK_LIMIT"
  | "VOLUME_BELOW_MINIMUM"
  | "INSUFFICIENT_FREE_MARGIN";

export interface PaperShadowSizingDecision {
  accepted: boolean;
  rejection: PaperShadowSizingRejection | null;
  accountCurrency: string;
  riskBudget: number;
  riskPerLot: number | null;
  volumeLots: number;
  plannedRisk: number | null;
  marginRequired: number | null;
  costsPerLot: number | null;
}

export type PaperShadowEventKind =
  | "SIGNAL_COMPARISON"
  | "SIZING_DECISION"
  | "DATA_GAP"
  | "INTERRUPTION"
  | "RECOVERY";

export interface PaperShadowJournalEvent {
  eventId: string;
  runId: string;
  kind: PaperShadowEventKind;
  recordedAt: number;
  eventAt: number;
  detail: PaperShadowComparison | PaperShadowSizingDecision | Record<string, string | number | boolean | null>;
}

export interface PaperShadowJournalSnapshot {
  version: 1;
  mode: "SHADOW";
  events: PaperShadowJournalEvent[];
}

const isFinitePositive = (value: number) => Number.isFinite(value) && value > 0;
const isFiniteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;

function isValidSignal(signal: PaperShadowSignal, datasetId: string, symbol: string, decisionAt: number) {
  const directionIsValid = signal.direction === "BUY" || signal.direction === "SELL";
  const pricesAreValid = [signal.entryPrice, signal.stopPrice, signal.targetPrice].every(isFinitePositive);
  const stopIsOnCorrectSide = signal.direction === "BUY"
    ? signal.stopPrice < signal.entryPrice && signal.targetPrice > signal.entryPrice
    : signal.stopPrice > signal.entryPrice && signal.targetPrice < signal.entryPrice;
  return signal.id.length > 0
    && signal.datasetId === datasetId
    && signal.symbol === symbol
    && signal.timeframe === "M15"
    && Number.isFinite(signal.decisionAt)
    && signal.decisionAt === decisionAt
    && Number.isFinite(signal.intendedEntryAt)
    && signal.intendedEntryAt >= signal.decisionAt
    && directionIsValid
    && pricesAreValid
    && stopIsOnCorrectSide;
}

export function compareGoldShadowSignals(
  datasetId: string,
  symbol: string,
  decisionAt: number,
  gold: PaperShadowSignal | null,
  goldSmc: PaperShadowSignal | null,
): PaperShadowComparison {
  if (!datasetId || !symbol || !Number.isFinite(decisionAt)) {
    throw new Error("Contexte invalide pour comparer les signaux Shadow.");
  }
  if (symbol !== GOLD_PAPER_SHADOW_SYMBOL) {
    throw new Error(`Le comparateur GOLD Shadow accepte uniquement ${GOLD_PAPER_SHADOW_SYMBOL}.`);
  }
  if (gold && (gold.strategy !== "GOLD" || !isValidSignal(gold, datasetId, symbol, decisionAt))) {
    throw new Error("Signal GOLD invalide ou calculé sur un autre jeu de données/instant.");
  }
  if (goldSmc && (goldSmc.strategy !== "GOLD_SMC" || !isValidSignal(goldSmc, datasetId, symbol, decisionAt))) {
    throw new Error("Signal GOLD + SMC invalide ou calculé sur un autre jeu de données/instant.");
  }

  const outcome = !gold && !goldSmc
    ? "BOTH_NONE"
    : gold && !goldSmc
      ? "GOLD_ONLY"
      : !gold && goldSmc
        ? "GOLD_SMC_ONLY"
        : gold!.direction === goldSmc!.direction
          ? "SAME_DIRECTION"
          : "DIRECTION_CONFLICT";
  return { datasetId, symbol, timeframe: "M15", decisionAt, gold, goldSmc, outcome };
}

function rejected(
  rejection: PaperShadowSizingRejection,
  accountCurrency: string,
  riskBudget: number,
  riskPerLot: number | null = null,
  costsPerLot: number | null = null,
): PaperShadowSizingDecision {
  return {
    accepted: false,
    rejection,
    accountCurrency,
    riskBudget,
    riskPerLot,
    volumeLots: 0,
    plannedRisk: null,
    marginRequired: null,
    costsPerLot,
  };
}

export function sizePaperShadowPosition(input: PaperShadowSizingInput): PaperShadowSizingDecision {
  const { symbolSpecification: spec, fxQuote: fx } = input;
  const accountCurrency = spec.accountCurrency;
  const riskBudget = input.capital * input.riskPercent / 100;
  if (input.marketSymbol !== GOLD_PAPER_SHADOW_SYMBOL || spec.symbol !== input.marketSymbol) {
    return rejected("SYMBOL_MISMATCH", accountCurrency, riskBudget);
  }
  const validNumbers = [
    input.now,
    input.capital,
    input.riskPercent,
    input.maxPortfolioRiskPercent,
    input.existingPositionCount,
    input.existingOpenRisk,
    input.freeMargin,
    input.quoteObservedAt,
    input.intendedEntryAt,
    input.entryPrice,
    input.stopPrice,
    input.spreadPrice,
    input.slippagePricePerSide,
    input.commissionProfitCurrencyPerLotPerSide,
    input.marginAccountCurrencyPerLot,
    input.maxQuoteAgeMs,
    spec.verifiedAt,
    spec.contractUnitsPerLot,
    spec.volumeMinimum,
    spec.volumeMaximum,
    spec.volumeStep,
    spec.leverage,
    fx.fromToRate,
    fx.observedAt,
  ].every(Number.isFinite);
  if (!validNumbers
    || !isFinitePositive(input.capital)
    || !isFinitePositive(input.riskPercent)
    || !isFinitePositive(input.maxPortfolioRiskPercent)
    || !Number.isInteger(input.existingPositionCount)
    || !isFiniteNonNegative(input.existingPositionCount)
    || !isFiniteNonNegative(input.existingOpenRisk)
    || !isFiniteNonNegative(input.freeMargin)
    || !isFiniteNonNegative(input.quoteObservedAt)
    || !isFinitePositive(input.entryPrice)
    || !isFinitePositive(input.stopPrice)
    || !isFiniteNonNegative(input.spreadPrice)
    || !isFiniteNonNegative(input.slippagePricePerSide)
    || !isFiniteNonNegative(input.commissionProfitCurrencyPerLotPerSide)
    || !isFiniteNonNegative(input.marginAccountCurrencyPerLot)
    || !isFinitePositive(input.maxQuoteAgeMs)
    || !isFinitePositive(spec.contractUnitsPerLot)
    || !isFinitePositive(spec.volumeMinimum)
    || !isFinitePositive(spec.volumeMaximum)
    || !isFinitePositive(spec.volumeStep)
    || !isFinitePositive(spec.leverage)
    || spec.volumeMaximum < spec.volumeMinimum
    || !isFinitePositive(fx.fromToRate)
    || input.intendedEntryAt > input.now
    || (input.stopPrice === input.entryPrice)
    || (spec.accountCurrency !== spec.profitCurrency
      && (fx.fromCurrency !== spec.profitCurrency || fx.toCurrency !== spec.accountCurrency))
    || (spec.accountCurrency === spec.profitCurrency && fx.fromToRate !== 1)) {
    return rejected("INVALID_INPUT", accountCurrency, riskBudget);
  }
  if (!spec.verified || !spec.source.trim()) {
    return rejected("UNVERIFIED_SYMBOL_SPECIFICATION", accountCurrency, riskBudget);
  }
  if (spec.verifiedAt > input.now || input.now - spec.verifiedAt > input.maxQuoteAgeMs) {
    return rejected("STALE_SYMBOL_SPECIFICATION", accountCurrency, riskBudget);
  }
  if (!fx.source.trim() || fx.observedAt > input.now) {
    return rejected("INVALID_FX_QUOTE", accountCurrency, riskBudget);
  }
  if (input.now - fx.observedAt > input.maxQuoteAgeMs) {
    return rejected("STALE_FX_QUOTE", accountCurrency, riskBudget);
  }
  if (input.quoteObservedAt > input.now || input.now - input.quoteObservedAt > input.maxQuoteAgeMs) {
    return rejected("STALE_MARKET_QUOTE", accountCurrency, riskBudget);
  }
  if (input.existingPositionCount >= 1) {
    return rejected("POSITION_LIMIT", accountCurrency, riskBudget);
  }
  if (input.existingOpenRisk + riskBudget > input.capital * input.maxPortfolioRiskPercent / 100) {
    return rejected("PORTFOLIO_RISK_LIMIT", accountCurrency, riskBudget);
  }

  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
  const stopIsOnCorrectSide = input.stopPrice < input.entryPrice || input.stopPrice > input.entryPrice;
  if (!isFinitePositive(stopDistance) || !stopIsOnCorrectSide) {
    return rejected("INVALID_INPUT", accountCurrency, riskBudget);
  }
  const roundTurnCostProfitCurrency =
    (input.spreadPrice + 2 * input.slippagePricePerSide) * spec.contractUnitsPerLot
    + 2 * input.commissionProfitCurrencyPerLotPerSide;
  const riskPerLot = (stopDistance * spec.contractUnitsPerLot + roundTurnCostProfitCurrency) * fx.fromToRate;
  const costsPerLot = roundTurnCostProfitCurrency * fx.fromToRate;
  if (!isFinitePositive(riskPerLot)) return rejected("INVALID_INPUT", accountCurrency, riskBudget);

  const rawLots = riskBudget / riskPerLot;
  const cappedLots = Math.min(rawLots, spec.volumeMaximum);
  const volumeLots = Math.floor((cappedLots + spec.volumeStep * 1e-10) / spec.volumeStep) * spec.volumeStep;
  const normalizedVolume = Number(volumeLots.toFixed(8));
  if (normalizedVolume < spec.volumeMinimum) {
    return rejected("VOLUME_BELOW_MINIMUM", accountCurrency, riskBudget, riskPerLot, costsPerLot);
  }
  const plannedRisk = normalizedVolume * riskPerLot;
  const marginRequired = normalizedVolume * input.marginAccountCurrencyPerLot;
  if (plannedRisk + input.existingOpenRisk > input.capital * input.maxPortfolioRiskPercent / 100) {
    return rejected("PORTFOLIO_RISK_LIMIT", accountCurrency, riskBudget, riskPerLot, costsPerLot);
  }
  if (marginRequired > input.freeMargin) {
    return rejected("INSUFFICIENT_FREE_MARGIN", accountCurrency, riskBudget, riskPerLot, costsPerLot);
  }
  return {
    accepted: true,
    rejection: null,
    accountCurrency,
    riskBudget,
    riskPerLot,
    volumeLots: normalizedVolume,
    plannedRisk,
    marginRequired,
    costsPerLot,
  };
}

const EVENT_KINDS: PaperShadowEventKind[] = [
  "SIGNAL_COMPARISON",
  "SIZING_DECISION",
  "DATA_GAP",
  "INTERRUPTION",
  "RECOVERY",
];

export function appendPaperShadowEvent(
  events: PaperShadowJournalEvent[],
  event: PaperShadowJournalEvent,
): PaperShadowJournalEvent[] {
  if (!event.eventId.trim()
    || !event.runId.trim()
    || !EVENT_KINDS.includes(event.kind)
    || !Number.isFinite(event.recordedAt)
    || !Number.isFinite(event.eventAt)
    || event.eventAt > event.recordedAt
    || events.some(existing => existing.eventId === event.eventId)
    || (events.length > 0 && event.recordedAt < events[events.length - 1].recordedAt)) {
    throw new Error("Événement Shadow invalide, dupliqué ou non chronologique.");
  }
  return [...events, event];
}

export function serializePaperShadowJournal(events: PaperShadowJournalEvent[]): string {
  return JSON.stringify({ version: 1, mode: "SHADOW", events } satisfies PaperShadowJournalSnapshot);
}

export function restorePaperShadowJournal(serialized: string): PaperShadowJournalEvent[] {
  const snapshot = JSON.parse(serialized) as Partial<PaperShadowJournalSnapshot>;
  if (snapshot.version !== 1 || snapshot.mode !== "SHADOW" || !Array.isArray(snapshot.events)) {
    throw new Error("Instantané de journal Shadow invalide.");
  }
  let restored: PaperShadowJournalEvent[] = [];
  for (const event of snapshot.events) restored = appendPaperShadowEvent(restored, event);
  return restored;
}
