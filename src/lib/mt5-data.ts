import { z } from "zod";

export const mt5ConnectionSchema = z.object({ terminalPath: z.string().max(500).refine(p => !/[\r\n\0]/.test(p), "Chemin de terminal invalide.").default(""), symbol: z.string().max(100).optional() });
export type MT5Connection = z.infer<typeof mt5ConnectionSchema>;
const symbolSchema = z.object({ name: z.string(), description: z.string(), currencyBase: z.string(), currencyProfit: z.string(), digits: z.number().int(), visible: z.boolean(), reason: z.string() });
export const mt5StatusSchema = z.object({ source: z.literal("MT5"), connected: z.literal(true), readOnly: z.literal(true), packageVersion: z.string(), terminalName: z.string(), maxBars: z.number().nonnegative(), symbols: z.array(symbolSchema), selectedSymbol: z.string().nullable(), warnings: z.array(z.string()) });
export type MT5Status = z.infer<typeof mt5StatusSchema>;
export const mt5TimeframeSchema = z.enum(["M1", "M5", "M15"]);
export type MT5Timeframe = z.infer<typeof mt5TimeframeSchema>;
export const mt5HistoryRequestSchema = mt5ConnectionSchema.extend({
  timeframe: mt5TimeframeSchema,
  start: z.string().datetime(),
  end: z.string().datetime(),
  warmup: z.number().int().min(0).default(202),
  token: z.string().uuid(),
});
const candleSchema = z.object({ time: z.number().int().positive(), open: z.number().finite().positive(), high: z.number().finite().positive(), low: z.number().finite().positive(), close: z.number().finite().positive(), volume: z.number().int().nonnegative() });
export const mt5HistorySchema = z.object({
  source: z.literal("MT5"), symbol: z.string(), interval: z.enum(["1m", "5m", "15m"]), apiTimeframe: z.enum(["TIMEFRAME_M1", "TIMEFRAME_M5", "TIMEFRAME_M15"]), priceBasis: z.enum(["BID", "LAST"]), volumeKind: z.literal("TICK_VOLUME"),
  fetchedAt: z.string().datetime(), cached: z.literal(false), candles: z.array(candleSchema).min(2),
  warnings: z.array(z.string()),
  coverage: z.object({ requestedStart: z.string().datetime(), requestedEnd: z.string().datetime(), warmupCount: z.number().int().nonnegative(), testedCount: z.number().int().nonnegative(), expectedMinutes: z.number().int().positive(), missingMinutes: z.number().int().nonnegative(), first: z.string().datetime(), last: z.string().datetime(), gaps: z.array(z.object({ from: z.string().datetime(), to: z.string().datetime(), minutes: z.number().positive() })).max(30), gapCount: z.number().int().nonnegative() }),
});
export type MT5History = z.infer<typeof mt5HistorySchema>;
export function frenchDateToISO(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}
export const mt5FrenchUTC = (value: string | number) => `${new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" }).format(new Date(value))} UTC`;

// Helper maps
export const intervalMap = { M1: "1m", M5: "5m", M15: "15m" } as const;
export const apiTimeframeMap = { M1: "TIMEFRAME_M1", M5: "TIMEFRAME_M5", M15: "TIMEFRAME_M15" } as const;
export const minutesPerBar = { M1: 1, M5: 5, M15: 15 } as const;
export const barsIn7Days = { M1: 10080, M5: 2016, M15: 672 } as const;