import type { BacktestSettings, BacktestStats } from "@/lib/backtest/types";
import { runScalpingBacktest } from "./engine";
import { scalpingSchema, scalpingSetupSchema, type ScalpingConfig, type ScalpingResult } from "./model";
import { validateMT5ScalpingHistory, type ScalpingHistory } from "./history";
import { scalpingIndicators, scalpingWarmup } from "./signals";
import { safeScalpingConfig } from "./safety";

export interface OptimizationMetrics extends BacktestStats { returnPercent: number; totalCosts: number; days: number; positiveDays: number; bursts: number }
export interface OptimizationCandidate {
  config: ScalpingConfig; score: number; training: OptimizationMetrics; validation: OptimizationMetrics;
  status: "Non validé" | "À confirmer" | "Rejetée"; reason: string;
}
export interface OptimizationReport {
  candidates: OptimizationCandidate[]; tested: number; source: ScalpingHistory["source"]; fetchedAt: string;
  settings: BacktestSettings; splitTime: number; trainingBars: number; validationBars: number;
  stages: string[]; createdAt: string;
}
function metrics(result: ScalpingResult): OptimizationMetrics {
  return { ...result.stats, returnPercent: 100 * result.stats.netPnl / result.settings.initialCapital,
    totalCosts: result.trades.reduce((n, t) => n + t.commission + t.quantity * (result.settings.spread + 2 * result.settings.slippage), 0),
    bursts: result.bursts.length, days: result.days.length, positiveDays: result.days.filter(d => d.pnl > 0).length };
}
function safe(m: OptimizationMetrics) { return m.finalCapital > 0 && m.maxDrawdown <= 15 && m.maxDrawdownMoney <= 45; }
function score(m: OptimizationMetrics) {
  if (!safe(m) || m.trades < 10 || m.netPnl <= 0) return -1e9 + m.netPnl;
  const stability = m.days ? m.positiveDays / m.days : 0;
  return m.netPnl - 2 * m.maxDrawdownMoney - 0.5 * m.longestLossStreak + 5 * stability + Math.min(3, m.profitFactor ?? 0);
}
// Subperiods retain only past warmup candles; no candle from the next segment is available.
function segment(history: ScalpingHistory, start: number, end: number): ScalpingHistory {
  const candles = history.candles.filter(c => c.time + 60000 <= end);
  if (history.source === "TWELVE_DATA") return { ...history, candles };
  const first = candles.findIndex(c => c.time >= start), tested = candles.length - first;
  const expected = (end - start) / 60000;
  return { ...history, candles, coverage: { ...history.coverage,
    requestedStart: new Date(start).toISOString(), requestedEnd: new Date(end).toISOString(),
    first: new Date(candles[first].time).toISOString(), last: new Date(candles[candles.length - 1].time).toISOString(),
    warmupCount: first, testedCount: tested, expectedMinutes: expected, missingMinutes: expected - tested } };
}
export function optimizeScalping(input: ScalpingConfig, settingsInput: BacktestSettings, historyInput: ScalpingHistory, progress: (percent: number, stage: string) => void): OptimizationReport {
  const base = scalpingSchema.parse({ ...input, enabled: true, timeframe: "1m", maxPositionsPerBurst: 1,
    burstRiskPercent: 0.5, individualLoss: 1.5, dailyLoss: 6, dailyGain: 9, maxBurstsPerDay: 5, delayMinutes: 5, setup: scalpingSetupSchema.parse({}) });
  const settings: BacktestSettings = { ...settingsInput, timeframe: "1m", initialCapital: 300 };
  if (![settings.start, settings.end, settings.spread, settings.slippage, settings.commission].every(Number.isFinite) || settings.spread < 0 || settings.slippage < 0 || settings.commission < 0) throw new Error("Coûts ou période invalides.");
  const history = historyInput.source === "MT5" ? validateMT5ScalpingHistory(historyInput, base, settings) : historyInput;
  const testedCandles = history.candles.filter(c => c.time >= settings.start && c.time + 60000 <= settings.end);
  const split = Math.floor(testedCandles.length * 0.7);
  if (split < 100 || testedCandles.length - split < 50) throw new Error("Au moins 150 bougies testables sont nécessaires. Plusieurs semaines sont préférables pour juger la stabilité.");
  const splitTime = testedCandles[split].time;
  const trainSettings = { ...settings, end: splitTime };
  const validationSettings = { ...settings, start: splitTime };
  const trainingHistory = segment(history, settings.start, splitTime);
  // This is the only source used by every search stage.
  const cache = new Map<string, { config: ScalpingConfig; metrics: OptimizationMetrics; score: number }>();
  const evaluate = (inputConfig: ScalpingConfig) => {
    const config = safeScalpingConfig(inputConfig);
    const key = JSON.stringify(config);
    const previous = cache.get(key); if (previous) return previous;
    if (config.burstRiskPercent > 1 || config.dailyLoss > 9 || config.maxPositionsPerBurst > 3) throw new Error("Budget excessif pour un capital de référence de 300 $.");
    const m = metrics(runScalpingBacktest(config, trainSettings, trainingHistory));
    const row = { config, metrics: m, score: score(m) }; cache.set(key, row); return row;
  };
  const best = (rows: ReturnType<typeof evaluate>[], count: number) => [...new Map(rows.map(r => [JSON.stringify(r.config), r])).values()].sort((a, b) => b.score - a.score).slice(0, count);
  const stages = ["Familles de signaux", "Seuils et périodes", "SL/TP et risque de salve", "Validation finale 30 %"];
  const families = [
    { slowTrend: false, rsiFilter: false, adxFilter: false, atrFilter: false },
    { slowTrend: true, rsiFilter: false, adxFilter: false, atrFilter: false },
    { slowTrend: false, rsiFilter: true, adxFilter: false, atrFilter: false },
    { slowTrend: true, rsiFilter: true, adxFilter: false, atrFilter: false },
    { slowTrend: false, rsiFilter: false, adxFilter: true, atrFilter: true },
    { slowTrend: true, rsiFilter: false, adxFilter: true, atrFilter: false },
    { slowTrend: false, rsiFilter: true, adxFilter: true, atrFilter: false },
    { slowTrend: true, rsiFilter: true, adxFilter: true, atrFilter: true },
  ];
  const familyRows = families.map((family, i) => {
    progress(Math.round(i / families.length * 20), stages[0]);
    return evaluate({ ...base, setup: { ...base.setup, ...family, trend: i !== 2 && i !== 5, priceFilter: i !== 4 } });
  });
  const leaders = best(familyRows, 2);
  const thresholdRows: ReturnType<typeof evaluate>[] = [...leaders];
  leaders.forEach((leader, n) => {
    for (let i = 0; i < 8; i++) {
      progress(20 + Math.round((n * 8 + i) / 16 * 25), stages[1]);
      thresholdRows.push(evaluate({ ...leader.config, setup: { ...leader.config.setup,
        emaFast: i < 4 ? 9 : 7, emaMiddle: i < 4 ? 20 : 18, emaSlow: i < 4 ? 50 : 60,
        rsiPeriod: i < 4 ? 14 : 10, atrPeriod: i < 4 ? 14 : 10, adxPeriod: i < 4 ? 14 : 20,
        rsiMin: i % 2 ? 52 : 48, rsiMax: i % 2 ? 68 : 72,
        adxMin: i % 4 < 2 ? 18 : 25, atrMin: i % 2 ? 0.5 : 0.25 } }));
    }
  });
  const thresholdLeaders = best(thresholdRows, 2);
  const atrs = scalpingIndicators(trainingHistory.candles, base.setup).slice(scalpingWarmup(base.setup)).map(r => r.atr).filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  const medianATR = atrs[Math.floor(atrs.length / 2)] ?? 1;
  const riskRows: ReturnType<typeof evaluate>[] = [];
  thresholdLeaders.forEach((leader, n) => {
    for (let i = 0; i < 12; i++) {
      progress(45 + Math.round((n * 12 + i) / 24 * 40), stages[2]);
      const risk = i < 6 ? 0.5 : 1;
      riskRows.push(evaluate({ ...leader.config,
        stopDistance: Math.max(settings.spread + 2 * settings.slippage + 0.1, medianATR * (i % 3 === 0 ? 1 : i % 3 === 1 ? 1.5 : 2)),
        individualLoss: (300 * risk / 100) / (i % 3 + 1), individualProfit: i % 2 ? 1 : 0.5,
        burstRiskPercent: risk, maxPositionsPerBurst: i % 3 + 1,
        maxBurstsPerDay: i % 2 ? 8 : 4, delayMinutes: i % 2 ? 10 : 5,
        dailyLoss: risk === 1 ? 9 : 6, dailyGain: i % 2 ? 12 : 9,
        setup: { ...leader.config.setup, rewardRisk: i % 2 ? 2 : 1.5 } }));
    }
  });
  // Freeze the top three by TRAINING score before ever reading validation performance.
  const finalists = best(riskRows.filter(r => safe(r.metrics) && r.metrics.netPnl > 0 && r.metrics.trades >= 10), 3);
  const validationHistory = segment(history, splitTime, settings.end);
  const candidates = finalists.map((row, i): OptimizationCandidate => {
    progress(85 + i * 5, stages[3]);
    const validation = metrics(runScalpingBacktest(row.config, validationSettings, validationHistory));
    const profitable = row.metrics.netPnl > 0 && validation.netPnl > 0;
    const stable = safe(row.metrics) && safe(validation) && (validation.profitFactor ?? 0) >= 1.1 && validation.positiveDays / Math.max(1, validation.days) >= 0.5;
    const enough = row.metrics.trades >= 30 && validation.trades >= 20 && row.metrics.bursts >= 15 && validation.bursts >= 10 && row.metrics.days >= 10 && validation.days >= 5;
    const status = !profitable || !stable ? "Rejetée" : enough ? "Non validé" : "À confirmer";
    return { config: row.config, score: row.score, training: row.metrics, validation, status,
      reason: status === "Non validé" ? "Critères internes du découpage 70/30 atteints, mais aucune validation indépendante de cet historique : Non validé." : status === "À confirmer" ? "Résultats positifs mais échantillon trop court : minimum 30/20 trades, 15/10 salves et 10/5 jours optimisation/validation. Non validé." : "Bénéfice net non positif ou stabilité/drawdown insuffisants sur l’une des périodes. Non validé." };
  });
  progress(100, "Terminé");
  return { candidates, tested: cache.size, source: history.source, fetchedAt: history.fetchedAt, settings, splitTime,
    trainingBars: split, validationBars: testedCandles.length - split, stages, createdAt: new Date().toISOString() };
}
