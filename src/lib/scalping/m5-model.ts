import { z } from "zod";
import { defaultScalping, scalpingSetupSchema, type ScalpingResult } from "./model";
import type { M5EligibilityDiagnostics } from "./m5-diagnostics";
import type { M5EngineVersion } from "./m5-sessions";
import type { M5Calendar } from "./m5-calendar";

export type M5Result = Omit<ScalpingResult, "scalping"> & { scalping: ReturnType<typeof m5ScalpingConfig>; calendar?: M5Calendar; eligibility?: M5EligibilityDiagnostics; execution?: { runId: string; engineVersion: M5EngineVersion; startedAt: string; completedAt: string }; gapAudit?: { policy: string; normalClosures: number; anomalies: number; discardedPending: number; pivots: string; pending: string } };

export const M5_KEY = "tradebot.scalping.m5.v1";
export const m5Schema = z.object({
  enabled: z.boolean().default(false),
  riskPercent: z.number().finite().positive().max(1).default(1),
  trendM15: z.boolean().default(false),
  volatility: z.boolean().default(false),
  atrMinRatio: z.number().finite().positive().default(0.5),
  atrMaxRatio: z.number().finite().positive().default(2),
  spreadFilter: z.boolean().default(false),
  maxSpread: z.number().finite().nonnegative().default(0.5),
  sessionFilter: z.boolean().default(false),
  sessionStart: z.number().int().min(0).max(23).default(7),
  sessionEnd: z.number().int().min(0).max(23).default(21),
  lossPause: z.boolean().default(false),
  pauseMinutes: z.number().finite().positive().max(10080).default(60),
  emaDistanceFilter: z.boolean().default(false),
  emaDistanceThreshold: z.number().finite().positive().default(1.5),
}).refine(c => c.atrMinRatio < c.atrMaxRatio, { message: "Le ratio ATR minimum doit être inférieur au maximum." });
export type M5Config = z.infer<typeof m5Schema>;
export const m5Setup = scalpingSetupSchema.parse({ emaFast: 9, emaMiddle: 20, emaSlow: 50, atrPeriod: 14, trend: false, slowTrend: true, priceFilter: false, rsiFilter: false, breakoutFilter: true, rewardRisk: 3 });
export function m5ScalpingConfig(config: M5Config) {
  const base = defaultScalping();
  return { ...base, enabled: config.enabled, timeframe: "5m" as const, burstRiskPercent: config.riskPercent,
    m5Profile: config,
    setup: m5Setup, signal: { ...base.signal, name: "Scalping XAU/USD M5", enabled: config.enabled,
      timeframes: ["5m" as const], riskPercent: config.riskPercent,
      stopLoss: { ...base.signal.stopLoss, mode: "atr" as const, atrMultiplier: 1.5 }, takeProfitRR: 3,
      breakEven: { enabled: false, thresholdR: 1 }, trailing: { enabled: false, distanceATR: 2 } } };
}
export function loadM5(): { config: M5Config; error: string } {
  try {
    const raw = localStorage.getItem(M5_KEY);
    return { config: m5Schema.parse(raw ? JSON.parse(raw) : {}), error: "" };
  } catch {
    return { config: m5Schema.parse({}), error: "Profil M5 illisible : aucun remplacement automatique. Enregistrez explicitement pour créer un profil valide." };
  }
}
