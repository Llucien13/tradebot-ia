import { z } from "zod";
import { defaultStrategy, newCondition, strategySchema, TIMEFRAMES } from "@/lib/strategies";
import type { BacktestResult, BacktestTrade } from "@/lib/backtest/types";
import type { ScalpingHistoryMetadata, ScalpingDataGap } from "./history";

export const SCALPING_KEY = "tradebot.scalping.v1";
export const scalpingSetupSchema = z.object({
  emaFast: z.number().int().min(2).max(100).default(9),
  emaMiddle: z.number().int().min(3).max(150).default(20),
  emaSlow: z.number().int().min(5).max(200).default(50),
  rsiPeriod: z.number().int().min(2).max(50).default(14),
  atrPeriod: z.number().int().min(2).max(50).default(14),
  adxPeriod: z.number().int().min(2).max(50).default(14),
  trend: z.boolean().default(true), slowTrend: z.boolean().default(false),
  priceFilter: z.boolean().default(true), rsiFilter: z.boolean().default(true),
  adxFilter: z.boolean().default(false), atrFilter: z.boolean().default(false),
  rsiMin: z.number().min(0).max(100).default(50), rsiMax: z.number().min(0).max(100).default(70),
  adxMin: z.number().min(0).max(100).default(20), atrMin: z.number().min(0).max(100).default(0.3),
  rewardRisk: z.number().min(0.5).max(5).default(1.5),
  candlePatternFilter: z.boolean().optional(), trendlineFilter: z.boolean().optional(),
  supportResistanceFilter: z.boolean().optional(), breakoutFilter: z.boolean().optional(),
  retestFilter: z.boolean().optional(), structureFilter: z.boolean().optional(),
}).refine(p => p.rsiMin < p.rsiMax, { message: "RSI minimum doit être inférieur au maximum", path: ["rsiMin"] })
  .refine(p => p.emaFast < p.emaMiddle && p.emaMiddle < p.emaSlow, { message: "Les périodes EMA doivent être croissantes", path: ["emaFast"] })
  .refine(p => p.trend || p.slowTrend || p.priceFilter || p.rsiFilter, { message: "Au moins un filtre directionnel est requis", path: ["trend"] });
export type ScalpingSetup = z.infer<typeof scalpingSetupSchema>;
export const scalpingSchema = z.object({
  enabled: z.boolean(), timeframe: z.enum(TIMEFRAMES),
  maxPositionsPerBurst: z.number().int().min(1).max(10),
  individualProfit: z.number().finite().positive(), individualLoss: z.number().finite().positive(),
  maxBurstsPerDay: z.number().int().min(1).max(1000),
  delayMinutes: z.number().finite().min(0).max(10080),
  dailyLoss: z.number().finite().positive(), dailyGain: z.number().finite().positive(),
  burstRiskPercent: z.number().finite().positive().max(100),
  stopDistance: z.number().finite().positive().max(10000),
  signal: strategySchema,
  setup: scalpingSetupSchema.default({}),
});
export type ScalpingConfig = z.infer<typeof scalpingSchema>;
export function defaultScalping(): ScalpingConfig {
  const signal = defaultStrategy();
  return {
    enabled: false, timeframe: "1m", maxPositionsPerBurst: 1, individualProfit: 1, individualLoss: 1,
    maxBurstsPerDay: 5, delayMinutes: 5, dailyLoss: 10, dailyGain: 10, burstRiskPercent: 1, stopDistance: 1,
    setup: scalpingSetupSchema.parse({}),
    signal: { ...signal, name: "Mode Scalping", enabled: false, timeframes: ["1m"],
      indicators: { ema20: true, ema50: false, ema200: false, rsi: false, macd: false, adx: false, atr: false, bollinger: false },
      buy: [newCondition("price", "ema20", "crossAbove")], sell: [newCondition("price", "ema20", "crossBelow")],
      minConfirmations: 1, minConfidence: 100, stopLoss: { ...signal.stopLoss, mode: "fixed" },
      breakEven: { enabled: false, thresholdR: 1 }, trailing: { enabled: false, distanceATR: 2 },
      spread: { enabled: false, maxUSD: 0.5 }, sessions: ["Asie", "Londres", "New York"], cooldownMinutes: 0,
    },
  };
}
export function loadScalping(): { config: ScalpingConfig; error: string | null } {
  try {
    const raw = localStorage.getItem(SCALPING_KEY);
    return { config: raw ? scalpingSchema.parse(JSON.parse(raw)) : defaultScalping(), error: null };
  } catch {
    return { config: defaultScalping(), error: "Configuration scalping illisible : éditeur désactivé par défaut. Aucun stockage existant ne sera remplacé sans enregistrement explicite." };
  }
}
export function saveScalping(config: ScalpingConfig) {
  localStorage.setItem(SCALPING_KEY, JSON.stringify(scalpingSchema.parse(config)));
}
export interface ScalpingTrade extends BacktestTrade { burstId: number }
export interface ScalpingBurst { id: number; time: number; signalTime: number; direction: "BUY" | "SELL"; positions: number; budget: number; committedRisk: number }
export interface ScalpingDay { day: string; baseline: number; pnl: number; bursts: number; blockedAt: number | null; reason: "Perte quotidienne" | "Gain quotidien" | null; conservative: boolean }
export interface ScalpingResult extends Omit<BacktestResult, "history"> {
  history: ScalpingHistoryMetadata;
  dataGaps?: ScalpingDataGap[];
  engineVersion?: string;
  validation?: "Non validé";
  scalping: ScalpingConfig; trades: ScalpingTrade[]; bursts: ScalpingBurst[]; days: ScalpingDay[];
}
