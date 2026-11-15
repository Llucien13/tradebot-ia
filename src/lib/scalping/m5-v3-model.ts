import { z } from "zod";
import type { BacktestSettings, BacktestTrade } from "@/lib/backtest/types";
import type { ScalpingResult } from "./model";
import { defaultScalping } from "./model";
import type { M5Calendar } from "./m5-calendar";

export const V3_VERSION = "m5-price-action-3";
export const V3_KEY = "tradebot.scalping.m5.v3.profile";
export const v3ConfigSchema = z.object({
  riskPercent: z.number().finite().positive().max(1).default(1),
  pivotBars: z.number().int().min(2).max(10).default(2),
  zoneAtr: z.number().finite().min(0.05).max(1).default(0.25),
  reactionBars: z.number().int().min(5).max(50).default(5),
  breakAtr: z.number().finite().min(0.1).max(2).default(0.5),
  stopAtr: z.number().finite().min(0.1).max(2).default(0.25),
  targetAtr: z.number().finite().min(0).max(1).default(0.1),
  minRR: z.number().finite().min(2).max(10).default(2),
  wickBody: z.number().finite().min(2).max(5).default(2),
  wickShare: z.number().finite().min(0.6).max(0.9).default(0.6),
  oppositeWick: z.number().finite().min(0).max(0.2).default(0.2),
  allowNeutral: z.boolean().default(true), emaFilter: z.boolean().default(false),
});
export type V3Config = Required<z.infer<typeof v3ConfigSchema>>;
export const v3BrokerSchema = z.object({
  symbol: z.string().min(1).max(100), accountCurrency: z.literal("USD"),
  contractSize: z.number().finite().positive(), minLot: z.number().finite().positive(), maxLot: z.number().finite().positive(), lotStep: z.number().finite().positive(),
  marginPerLotUSD: z.number().finite().positive(),
  provenance: z.string().min(5).max(500), confirmed: z.literal(true),
}).refine(b => b.maxLot >= b.minLot && b.lotStep <= b.maxLot, "Volumes broker incohérents.");
export type V3Broker = Required<z.infer<typeof v3BrokerSchema>>;
export interface V3Plan { developmentStart: number; developmentEnd: number; validationStart: number; validationEnd: number }
export function validateV3Plan(plan: V3Plan, settings: BacktestSettings, phase: "development" | "validation") {
  const values = Object.values(plan);
  if (values.length !== 4 || !values.every(n => Number.isFinite(n) && n % 300000 === 0)
    || plan.developmentStart >= plan.developmentEnd || plan.validationStart >= plan.validationEnd || plan.developmentEnd > plan.validationStart) throw new Error("Développement puis validation hors échantillon non chevauchants requis, bornes M5 UTC.");
  const start = phase === "development" ? plan.developmentStart : plan.validationStart;
  const end = phase === "development" ? plan.developmentEnd : plan.validationEnd;
  if (settings.start < start || settings.end > end) throw new Error("Le lot chargé doit être entièrement dans la période choisie.");
}
export interface V3Trade extends BacktestTrade { burstId: number; lots: number; marginUSD: number; potentialRR: number; zone: string; formation: string; trend: string }
export type V3Result = Omit<ScalpingResult, "trades" | "scalping"> & {
  scalping: ReturnType<typeof v3DisplayConfig>; trades: V3Trade[]; calendar: M5Calendar; v3: { config: V3Config; broker: V3Broker; plan: V3Plan; phase: "development" | "validation"; profileFingerprint: string; dataFingerprint: string };
  execution: { engineVersion: string; runId: string; startedAt: string; completedAt: string };
  audit: { normalClosures: number; anomalies: number; ignoredWarmup: number; eligible: number; discardedPending: number; rejectedRisk: number; rejectedMargin: number; rejectedRR: number };
};
export function v3DisplayConfig(config: V3Config) {
  const base = defaultScalping();
  return { ...base, enabled: true, timeframe: "5m" as const, burstRiskPercent: config.riskPercent,
    signal: { ...base.signal, name: "M5 V3 — Rebond Price Action", enabled: true, timeframes: ["5m" as const], riskPercent: config.riskPercent,
      buy: [], sell: [], stopLoss: { ...base.signal.stopLoss, mode: "structure" as const }, takeProfitRR: config.minRR,
      breakEven: { enabled: false, thresholdR: 1 }, trailing: { enabled: false, distanceATR: 2 } } };
}
export async function v3Fingerprint(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest)).map(n => n.toString(16).padStart(2, "0")).join("");
}
