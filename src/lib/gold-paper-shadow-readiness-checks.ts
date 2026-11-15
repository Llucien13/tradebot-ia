import {
  appendPaperShadowEvent,
  compareGoldShadowSignals,
  restorePaperShadowJournal,
  serializePaperShadowJournal,
  sizePaperShadowPosition,
  type PaperShadowSizingInput,
  type PaperShadowSignal,
} from "./gold-paper-shadow-readiness.ts";

export function checkGoldPaperShadowReadiness() {
  let assertions = 0;
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(`Contrôles de préparation PAPER Shadow : ${label}`);
    assertions++;
  };
  const expectThrow = (fn: () => unknown, label: string) => {
    let thrown = false;
    try {
      fn();
    } catch {
      thrown = true;
    }
    check(thrown, label);
  };
  const now = 1_000_000;
  const makeSignal = (strategy: PaperShadowSignal["strategy"], direction: PaperShadowSignal["direction"]): PaperShadowSignal => ({
    id: `${strategy}-${direction}`,
    strategy,
    symbol: "XAUUSD",
    timeframe: "M15",
    datasetId: "bars-sha256",
    decisionAt: now,
    intendedEntryAt: now,
    direction,
    entryPrice: 3_000,
    stopPrice: direction === "BUY" ? 2_995 : 3_005,
    targetPrice: direction === "BUY" ? 3_012.5 : 2_987.5,
  });
  const gold = makeSignal("GOLD", "BUY");
  const smc = makeSignal("GOLD_SMC", "SELL");
  const comparison = compareGoldShadowSignals("bars-sha256", "XAUUSD", now, gold, smc);
  check(comparison.outcome === "DIRECTION_CONFLICT", "compare les directions sans exécuter de position");
  check(compareGoldShadowSignals("bars-sha256", "XAUUSD", now, null, null).outcome === "BOTH_NONE", "journalise l’absence des deux signaux");
  expectThrow(
    () => compareGoldShadowSignals("other-data", "XAUUSD", now, gold, null),
    "refuse un signal calculé sur un autre historique",
  );
  expectThrow(
    () => compareGoldShadowSignals("bars-sha256", "XAUUSD", now + 1, gold, null),
    "refuse un signal calculé à un autre instant de décision",
  );
  const futureSignal = { ...gold, decisionAt: now + 1 };
  expectThrow(
    () => compareGoldShadowSignals("bars-sha256", "XAUUSD", now, futureSignal, null),
    "refuse un signal fondé sur une clôture future",
  );
  expectThrow(
    () => compareGoldShadowSignals("bars-sha256", "XAUUSD-ECN", now, null, null),
    "refuse un symbole différent de XAUUSD",
  );

  const sizingInput: PaperShadowSizingInput = {
    now,
    marketSymbol: "XAUUSD",
    capital: 20_000,
    riskPercent: 0.5,
    maxPortfolioRiskPercent: 0.5,
    existingPositionCount: 0,
    existingOpenRisk: 0,
    freeMargin: 10_000,
    quoteObservedAt: now - 1_000,
    intendedEntryAt: now,
    entryPrice: 3_000,
    stopPrice: 2_995,
    spreadPrice: 0.3,
    slippagePricePerSide: 0.05,
    commissionProfitCurrencyPerLotPerSide: 3,
    marginAccountCurrencyPerLot: 2_000,
    maxQuoteAgeMs: 60_000,
    symbolSpecification: {
      symbol: "XAUUSD",
      verified: true,
      source: "fixture:broker-symbol-spec",
      verifiedAt: now - 1_000,
      accountCurrency: "EUR",
      profitCurrency: "USD",
      contractUnitsPerLot: 100,
      volumeMinimum: 0.01,
      volumeMaximum: 100,
      volumeStep: 0.01,
      leverage: 20,
    },
    fxQuote: {
      fromCurrency: "USD",
      toCurrency: "EUR",
      fromToRate: 0.8,
      observedAt: now - 1_000,
      source: "fixture:fx",
    },
  };
  const sized = sizePaperShadowPosition(sizingInput);
  check(sized.accepted && sized.rejection === null, "dimensionne avec des spécifications explicites et vérifiées");
  check(sized.volumeLots === 0.22, "arrondit le volume vers le bas au pas déclaré");
  check(sized.plannedRisk !== null && sized.plannedRisk <= 100, "respecte le budget nominal de 100 EUR");
  check(sized.costsPerLot !== null && Math.abs(sized.costsPerLot - 36.8) < 1e-8, "intègre spread, slippage et commissions round-trip");
  check(sized.marginRequired !== null && sized.marginRequired <= sizingInput.freeMargin, "vérifie la marge à partir de la valeur fournie");
  check(
    sizePaperShadowPosition({ ...sizingInput, symbolSpecification: { ...sizingInput.symbolSpecification, verified: false } }).rejection
      === "UNVERIFIED_SYMBOL_SPECIFICATION",
    "refuse le sizing si la spécification de symbole n’est pas vérifiée",
  );
  check(
    sizePaperShadowPosition({
      ...sizingInput,
      symbolSpecification: { ...sizingInput.symbolSpecification, symbol: "XAUUSD-ECN" },
    }).rejection === "SYMBOL_MISMATCH",
    "refuse des spécifications appartenant à un autre symbole",
  );
  check(
    sizePaperShadowPosition({ ...sizingInput, fxQuote: { ...sizingInput.fxQuote, observedAt: now - 120_000 } }).rejection
      === "STALE_FX_QUOTE",
    "refuse un taux de conversion périmé",
  );
  check(
    sizePaperShadowPosition({ ...sizingInput, quoteObservedAt: now - 120_000 }).rejection === "STALE_MARKET_QUOTE",
    "refuse une cotation de marché périmée",
  );
  check(
    sizePaperShadowPosition({ ...sizingInput, existingPositionCount: 1 }).rejection === "POSITION_LIMIT",
    "refuse l’entrée quand une position existe déjà",
  );
  check(
    sizePaperShadowPosition({ ...sizingInput, maxPortfolioRiskPercent: 0.25 }).rejection === "PORTFOLIO_RISK_LIMIT",
    "respecte la limite de risque global",
  );
  check(
    sizePaperShadowPosition({ ...sizingInput, freeMargin: 100 }).rejection === "INSUFFICIENT_FREE_MARGIN",
    "refuse une marge libre insuffisante",
  );
  check(
    sizePaperShadowPosition({ ...sizingInput, symbolSpecification: { ...sizingInput.symbolSpecification, volumeMinimum: 0.5 } }).rejection
      === "VOLUME_BELOW_MINIMUM",
    "refuse de relever artificiellement un volume sous le minimum",
  );

  const event = {
    eventId: "event-1",
    runId: "run-1",
    kind: "SIGNAL_COMPARISON" as const,
    recordedAt: now + 10,
    eventAt: now,
    detail: comparison,
  };
  const journal = appendPaperShadowEvent([], event);
  check(restorePaperShadowJournal(serializePaperShadowJournal(journal)).length === 1, "sérialise et restaure le journal Shadow");
  expectThrow(() => appendPaperShadowEvent(journal, event), "refuse les doublons d’événements");
  expectThrow(
    () => appendPaperShadowEvent(journal, { ...event, eventId: "event-future", eventAt: now + 20 }),
    "refuse un événement daté après son enregistrement",
  );
  expectThrow(
    () => restorePaperShadowJournal(JSON.stringify({ version: 1, mode: "LIVE", events: [] })),
    "refuse un instantané de journal hors mode Shadow",
  );

  return { passed: true, assertions, noBrokerConnection: true, noOrdersSent: true };
}
