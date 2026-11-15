import { scalpingSchema, type ScalpingConfig } from "./model";

export const SCALPING_ENGINE_VERSION = "m1-safety-2";
export const REFERENCE_CAPITAL = 300;

export function safeScalpingConfig(input: ScalpingConfig): ScalpingConfig {
  const config = scalpingSchema.parse(input);
  return {
    ...config, timeframe: "1m", maxPositionsPerBurst: Math.min(3, config.maxPositionsPerBurst),
    burstRiskPercent: Math.min(1, config.burstRiskPercent), individualLoss: Math.min(3, config.individualLoss),
    dailyLoss: Math.min(9, config.dailyLoss), maxBurstsPerDay: Math.min(5, config.maxBurstsPerDay),
    delayMinutes: Math.max(5, config.delayMinutes),
    setup: { ...config.setup, trend: true, slowTrend: true, priceFilter: true, rsiFilter: true,
      adxFilter: true, atrFilter: true, rsiMin: Math.max(52, Math.min(65, config.setup.rsiMin)),
      rsiMax: Math.max(66, Math.min(70, config.setup.rsiMax)), adxMin: Math.max(20, config.setup.adxMin),
      atrMin: Math.max(0.3, config.setup.atrMin) },
  };
}

// Monetary risk is shared by the whole burst, never multiplied by its position count.
export function burstSizing(available: number, remainingDailyLoss: number, config: ScalpingConfig, slippage: number, commission: number) {
  const budget = Math.max(0, Math.min(available * config.burstRiskPercent / 100,
    available * 0.01, REFERENCE_CAPITAL * 0.01, remainingDailyLoss));
  const count = budget > 0 ? Math.min(config.maxPositionsPerBurst, Math.ceil(budget / config.individualLoss)) : 0;
  const unitRisk = count ? Math.min(config.individualLoss, budget / count) : 0;
  const quantity = unitRisk / (config.stopDistance + slippage + 2 * commission);
  return { budget, count, unitRisk, quantity };
}

export function executionExitQuote(reference: number, sign: number, spread: number, bidPrices: boolean) {
  return bidPrices ? reference + (sign === -1 ? spread : 0) : reference - sign * spread / 2;
}

export function executionLevels(reference: number, sign: number, bidPrices: boolean, spread: number, slippage: number, commission: number, stopDistance: number, quantity: number, target: number) {
  const entry = reference + (bidPrices ? sign === 1 ? spread : 0 : sign * spread / 2) + sign * slippage;
  const sl = entry - sign * stopDistance;
  const tp = entry + sign * (target / quantity + slippage + 2 * commission);
  return { entry, sl, tp };
}
