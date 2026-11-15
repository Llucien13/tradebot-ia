import { z } from "zod";

const n = z.number().finite();
const maybe = n.nullable();
export const brokerPositionSchema = z.object({
  id: z.string(), owner: z.literal("NOT_PAPER_BOT"),
  provenance: z.enum(["MANUAL", "EXTERNAL_AUTOMATION", "UNCONFIRMED", "NETTING_AGGREGATE"]),
  ticket: z.string(), identifier: z.string().nullable(), magic: z.string().nullable(), reason: maybe,
  symbol: z.string(), side: z.enum(["BUY", "SELL", "UNKNOWN"]), volume: maybe,
  entry: maybe, lastPrice: maybe, sl: maybe, tp: maybe, profit: maybe, swap: maybe,
  timeRaw: maybe, timeMscRaw: maybe, quoteFreshness: z.literal("UNVERIFIED"),
});
export const manualPositionsSchema = z.object({
  source: z.literal("MT5_ACCOUNT"), readOnly: z.literal(true), liveEnabled: z.literal(false),
  available: z.boolean(), status: z.enum(["OBSERVED", "BUSY", "DISCONNECTED", "UNAVAILABLE", "ACCOUNT_CHANGED", "TOO_MANY_POSITIONS"]),
  observedAt: maybe, checkedAt: n,
  account: z.object({ login: z.string(), server: z.string(), currency: z.string(),
    type: z.enum(["DEMO", "REAL", "CONTEST", "UNKNOWN"]),
    mode: z.enum(["HEDGING", "NETTING", "UNKNOWN"]), marginModeRaw: maybe }).nullable(),
  positions: z.array(brokerPositionSchema).max(1000),
  exposure: z.object({ liveAllowed: z.literal(false), riskComplete: z.literal(false), riskAtStops: z.null(),
    balance: maybe, equity: maybe, margin: maybe, marginFree: maybe, brokerPositionCount: n,
    missingStops: n, pendingOrdersChecked: z.literal(false), paperIncluded: z.literal(false) }).nullable(),
});
export type BrokerPosition = z.infer<typeof brokerPositionSchema>;
