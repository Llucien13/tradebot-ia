import {
  planShadowRisk,
  rankShadowSignals,
  SHADOW_INSTRUMENT_CANDIDATES,
  type ShadowRiskPlanInput,
} from "./multi-asset-shadow-risk.ts";

export function checkMultiAssetShadowRisk() {
  let assertions = 0;
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(`Contrôles risque multi-actifs Shadow : ${label}`);
    assertions++;
  };
  const now = 1_000_000;
  const base: ShadowRiskPlanInput = {
    now,
    symbol: "XAUUSD",
    accountCurrency: "EUR",
    equityEUR: 20_000,
    riskPercent: 0.5,
    freeMarginEUR: 10_000,
    quote: { bid: 2_500, ask: 2_500.3, observedAt: now - 1_000, maxAgeMs: 60_000 },
    direction: "BUY",
    entryPrice: 2_500.3,
    stopPrice: 2_490.3,
    targetPrice: 2_525.3,
    specification: {
      verified: true,
      source: "fixture:verified-symbol-metadata",
      symbol: "XAUUSD",
      accountCurrency: "EUR",
      verifiedAt: now - 1_000,
      maxAgeMs: 60_000,
      contractUnitsPerLot: 100,
      tickSize: 0.01,
      tickValueEURPerLot: 1,
      volumeMinimum: 0.01,
      volumeMaximum: 100,
      volumeStep: 0.01,
      roundTurnCostsEURPerLot: 10,
      marginEURPerLot: 500,
    },
    limits: {
      verified: true,
      source: "fixture:verified-account-risk-limits",
      verifiedAt: now - 1_000,
      maxAgeMs: 60_000,
      maxConcurrentPositions: 3,
      maximumPortfolioRiskEUR: 200,
      remainingDailyLossAfterOpenRiskEUR: 100,
      remainingOverallLossAfterOpenRiskEUR: 500,
      maximumAbsoluteCorrelation: 0.8,
      minimumCorrelationObservations: 100,
      correlationMaxAgeMs: 24 * 60 * 60_000,
    },
    openPositions: [{ symbol: "EURUSD", riskEUR: 50 }],
    correlations: [{
      symbolA: "XAUUSD",
      symbolB: "EURUSD",
      coefficient: 0.3,
      observations: 500,
      timeframe: "M15",
      observedAt: now - 60_000,
    }],
  };

  check(SHADOW_INSTRUMENT_CANDIDATES.length === 18, "déclare 18 candidats sans prétendre qu'ils sont disponibles");
  check(
    SHADOW_INSTRUMENT_CANDIDATES.filter(candidate => candidate.availability === "READ_ONLY_ROUTE_PRESENT")
      .map(candidate => candidate.canonicalSymbol).join(",") === "XAUUSD",
    "ne marque que XAUUSD comme route de bougies connue",
  );

  const ranked = rankShadowSignals([
    { id: "xau-old", symbol: "XAUUSD", direction: "BUY", decisionAt: now - 1, qualityScore: 90 },
    { id: "xau-new", symbol: "XAUUSD", direction: "SELL", decisionAt: now, qualityScore: 10 },
    { id: "eur", symbol: "EURUSD", direction: "BUY", decisionAt: now, qualityScore: 70 },
    { id: "silver", symbol: "XAGUSD", direction: "SELL", decisionAt: now, qualityScore: 80 },
  ]);
  check(ranked.length === 3 && ranked[0].symbol === "XAGUSD", "classe les signaux et déduplique chaque instrument au même instant");
  check(ranked.find(signal => signal.symbol === "XAUUSD")?.id === "xau-new", "garde le signal le plus récent par instrument");

  const plan = planShadowRisk(base);
  check(plan.accepted && plan.refusal === null, "dimensionne uniquement avec métadonnées et limites vérifiées explicites");
  check(plan.volumeLots === 0.09, "arrondit vers le bas au pas de volume déclaré");
  check(plan.plannedRiskEUR !== null && plan.plannedRiskEUR <= 100, "respecte le budget maximal de 100 EUR par trade");
  check(plan.marginRequiredEUR !== null && plan.marginRequiredEUR <= base.freeMarginEUR, "respecte la marge disponible déclarée");
  check(
    planShadowRisk({ ...base, riskPercent: 0.51 }).refusal === "INVALID_INPUT",
    "refuse un risque supérieur à 0,5 %",
  );
  check(
    planShadowRisk({ ...base, quote: { ...base.quote, observedAt: now - 120_000 } }).refusal === "STALE_MARKET_QUOTE",
    "refuse une cotation périmée",
  );
  check(
    planShadowRisk({
      ...base,
      specification: { ...base.specification, verified: false },
    }).refusal === "UNVERIFIED_INSTRUMENT",
    "refuse une spécification non vérifiée",
  );
  check(
    planShadowRisk({
      ...base,
      specification: { ...base.specification, roundTurnCostsEURPerLot: Number.NaN },
    }).refusal === "UNVERIFIED_COSTS_OR_MARGIN",
    "refuse les frais ou la marge manquants",
  );
  check(
    planShadowRisk({ ...base, limits: { ...base.limits, verified: false } }).refusal === "UNVERIFIED_RISK_LIMITS",
    "refuse les limites de compte non vérifiées",
  );
  check(
    planShadowRisk({ ...base, correlations: [] }).refusal === "CORRELATION_UNAVAILABLE",
    "refuse une corrélation absente",
  );
  check(
    planShadowRisk({
      ...base,
      correlations: base.correlations.map(correlation => ({ ...correlation, coefficient: 0.9 })),
    }).refusal === "CORRELATION_LIMIT",
    "bloque une position trop corrélée",
  );
  check(
    planShadowRisk({ ...base, openPositions: [{ symbol: "EURUSD", riskEUR: 200 }] }).refusal
      === "PORTFOLIO_RISK_LIMIT",
    "respecte le plafond de risque cumulé",
  );
  check(
    planShadowRisk({ ...base, openPositions: [{ symbol: "EURUSD", riskEUR: 0 }, { symbol: "GBPUSD", riskEUR: 0 }, { symbol: "USDJPY", riskEUR: 0 }] }).refusal
      === "POSITION_LIMIT",
    "respecte le maximum de positions simultanées",
  );
  check(
    planShadowRisk({ ...base, freeMarginEUR: 1 }).refusal === "INSUFFICIENT_FREE_MARGIN",
    "refuse une marge insuffisante",
  );

  return { passed: true, assertions, noNetwork: true, noOrdersSent: true };
}
