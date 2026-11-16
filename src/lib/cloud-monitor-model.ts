import { z } from "zod";

const finite = z.number().finite();
const tradeSchema = z.object({
  entryTime: finite,
  signalTime: finite,
  entry: finite,
  side: z.union([z.literal(1), z.literal(-1)]),
  lots: finite,
  sl: finite,
  tp: finite,
  riskEUR: finite,
  exitTime: finite.optional(),
  exit: finite.optional(),
  pnl: finite.optional(),
  reason: z.string().optional(),
  entryReason: z.string().optional(),
});

export const cloudMonitorSnapshotSchema = z.object({
  version: z.literal(86),
  mode: z.literal("PAPER"),
  liveEnabled: z.literal(false),
  readOnly: z.literal(true),
  observedAt: finite,
  fresh: z.boolean(),
  status: z.enum(["RUNNING", "WAITING_QUOTES", "WAITING_MARKET", "SAFE_STOP", "STOPPED"]),
  floatingEUR: finite.nullable(),
  position: tradeSchema.extend({
    id: z.string().min(1).max(100),
    instrument: z.literal("XAUUSD"),
    floatingEUR: finite.nullable(),
    netPositionEUR: finite.nullable(),
    percentInitial: finite.nullable(),
    r: finite.nullable(),
    riskPercentInitial: finite,
    needsReview: z.boolean(),
  }).nullable(),
  metrics: z.object({
    initial: z.literal(20000),
    balance: finite,
    realized: finite,
    count: finite,
    wins: finite,
    losses: finite,
    neutral: finite,
    winRate: finite.nullable(),
  }),
  health: z.object({
    mt5: z.enum(["CONNECTED", "DISCONNECTED", "UNKNOWN"]),
    worker: z.object({ status: z.string().max(80), alive: z.boolean(), heartbeat: finite.nullable() }),
    storageFault: z.boolean(),
  }),
}).strict();

export const cloudMonitorTradeSchema = z.object({
  id: z.string().min(1).max(100),
  needsReview: z.boolean(),
  trade: tradeSchema,
}).strict();

export const cloudMonitorJournalSchema = z.object({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  items: z.array(cloudMonitorTradeSchema).max(100),
}).strict();

export type CloudMonitorSnapshot = z.infer<typeof cloudMonitorSnapshotSchema>;
export type CloudMonitorTrade = z.infer<typeof cloudMonitorTradeSchema>;
