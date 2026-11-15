import { z } from "zod";

export const MT5_BRIDGE_URL = "http://127.0.0.1:8765";
export const MT5_BRIDGE_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"] as const;
export type MT5BridgeTimeframe = typeof MT5_BRIDGE_TIMEFRAMES[number];
const finite = z.number().finite();
const safety = {
  source: z.literal("MT5"), readOnly: z.literal(true), mode: z.literal("PAPER"),
  liveEnabled: z.literal(false), botState: z.literal("STOPPED"), symbol: z.enum(["XAUUSD", "XAUUSD-ECN"]),
  fetchedAt: z.string().datetime({ offset: true }), packageVersion: z.string(),
};
export const bridgeStatusSchema = z.discriminatedUnion("connected", [
  z.object({ ...safety, connected: z.literal(false), error: z.string() }),
  z.object({ ...safety, connected: z.literal(true),
    terminal: z.object({ name: z.string(), path: z.string() }),
    account: z.object({ type: z.enum(["DEMO", "REAL", "CONTEST", "UNKNOWN"]), login: z.string(), server: z.string(), company: z.string(), currency: z.string(), balance: finite, equity: finite }),
    quote: z.object({ bid: finite.positive(), ask: finite.positive(), time: finite.int().positive(), digits: finite.int().min(0).max(12), maxLot: finite.positive() }).nullable(),
    quoteError: z.string().nullable(),
  }),
]);
export type MT5BridgeStatus = z.infer<typeof bridgeStatusSchema>;
const candle = z.object({ time: finite.int().positive(), open: finite.positive(), high: finite.positive(), low: finite.positive(), close: finite.positive(), tickVolume: finite.int().nonnegative(), realVolume: finite.int().nonnegative(), spreadPoints: finite.int().nonnegative() }).refine(c => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.high >= c.low);
export const bridgeCandlesSchema = z.object({
  source: z.literal("MT5"), readOnly: z.literal(true), symbol: z.enum(["XAUUSD", "XAUUSD-ECN"]), timeframe: z.enum(MT5_BRIDGE_TIMEFRAMES),
  closedBarsOnly: z.literal(true), fetchedAt: z.string().datetime({ offset: true }), requestedCount: finite.int().positive(),
  candles: z.array(candle).min(1).max(2000).refine(rows => rows.every((row, index) => !index || row.time > rows[index - 1].time)),
});
export type MT5BridgeCandles = z.infer<typeof bridgeCandlesSchema>;

export async function readLocalMT5<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  try {
    const response = await fetch(`${MT5_BRIDGE_URL}${path}`, { signal, cache: "no-store", credentials: "omit", headers: { Accept: "application/json" } });
    const raw: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ detail: z.string() }).safeParse(raw);
      throw new Error(error.success ? error.data.detail : `Passerelle MT5 : erreur HTTP ${response.status}.`);
    }
    return schema.parse(raw);
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof z.ZodError) throw new Error("Réponse MT5 invalide ou incompatible. Aucune donnée de remplacement affichée.");
    if (error instanceof TypeError) throw new Error("Passerelle inaccessible. Lancez start_mt5_bridge.bat sur ce PC, ouvrez MT5 et utilisez l’aperçu HTTP localhost de Dyad. Vérifiez aussi l’autorisation d’accès au réseau local du navigateur.");
    throw error;
  }
}
