import { z } from "zod";
import { MT5_BRIDGE_URL } from "./mt5-local-bridge";

const n = z.number().finite();
const position = z.object({ phase: z.number().int(), entryTime: n, signalTime: n, entry: n, side: z.union([z.literal(1), z.literal(-1)]), lots: n, contract: n, sl: n, tp: n, riskEUR: n, entryFX: n, swapsEUR: n });
const trade = position.extend({ exitTime: n, exit: n, reason: z.string(), pnl: n, grossUSD: n, exitFX: n, balance: n });
export const ftmoSnapshotSchema = z.object({
  connected: z.boolean(), storage: z.string(), verifying: z.boolean(),
  worker: z.object({ status: z.enum(["STOPPED", "SAFE_STOP", "MONITORING"]), heartbeat: n.nullable(), cause: z.string().nullable(), alive: z.boolean() }),
  storageFault: z.string().nullable(), positionSafety: z.enum(["HELD_UNPRICED", "LAST_VERIFIED_OBSERVATION"]),
  feed: z.object({ source: z.literal("MT5"), symbol: z.literal("XAUUSD"), time: n, utcValidUntil: n, bid: n.positive(), ask: n.positive(), spread: n.nonnegative(), fx: n.positive(), fxSymbol: z.string(), fxTime: n, accountType: z.literal("DEMO"), company: z.string(), server: z.string().regex(/^FTMO-Demo/i), bars: z.record(n).optional(),
    contract: z.object({ size: n.positive(), minLot: n.positive(), step: n.positive(), maxLot: n.positive(), tickSize: n, tickValue: n, swapMode: n, swapLong: n, swapShort: n, tripleDay: n }) }).nullable(),
  limits: z.object({ dailyAvailable: n, totalAvailable: n, remainingTarget: n }),
  verification: z.object({ status: z.string(), error: z.string().optional(), unitTests: n.optional(), unitPassed: z.boolean().optional(), replays: z.array(z.object({ year: n, tpR: n, passed: z.boolean(), errors: z.array(z.unknown()), summary: z.record(z.unknown()) })).optional(), signalChecks: z.array(z.object({ time: z.string(), passed: z.boolean() })).optional() }),
  state: z.object({ version: z.literal(1), mode: z.literal("PAPER"), liveEnabled: z.literal(false), running: z.boolean(), tpR: z.literal(2.5), phase: z.union([z.literal(1), z.literal(2)]),
    status: z.enum(["PHASE_1", "PHASE_2", "SUCCEEDED", "FAILED"]), balance: n, equity: n, day: z.string().nullable(), dayBase: n, days: z.array(z.string()),
    position: position.nullable(), trades: z.array(trade), phases: z.array(z.object({ phase: n, start: n.nullable(), end: n, balance: n, gain: n, days: n, trades: n, maxDrawdown: n, status: z.string() })),
    curve: z.array(z.object({ time: n, equity: n, balance: n, phase: n })), maxDrawdown: n, startedAt: n.nullable(), lastObserved: n.nullable(), error: z.string(), verifiedContinuous: z.boolean(),
    cashEvents: z.array(z.object({ phase: n, time: n, amount: n, type: z.enum(["ENTRY_COMMISSION", "EXIT_NET", "SWAP"]) })),
    interruptions: z.array(z.object({ from: n.nullable(), to: n, reason: z.string() })), swapLongUSD: n.nullable(), swapShortUSD: n.nullable(), swapHourUTC: n.nullable(), commissionUSD: n, slippageUSD: n,
  }),
});
export type FTMOSnapshot = z.infer<typeof ftmoSnapshotSchema>;
export const referenceSchema = z.object({ report: z.string(), results: z.array(z.object({ summary: z.object({ year: n, tpR: n, spread: n, net: n, trades: n, phase1_end: z.string().nullable(), phase2_end: z.string().nullable(), phase1_status: z.string(), phase2_status: z.string(), max_dd_ohlc_pct: n }), phases: z.array(z.object({ phase: n, equity: n, days: n, trades: n, start: z.string(), end: z.string(), status: z.string() })) })) });
export type FTMOReferences = z.infer<typeof referenceSchema>;
export const archivedTradesSchema = z.object({ trades: z.array(z.object({ phase: n, entry: z.string(), exit: z.string(), side: n, lot: n, entry_price: n, stop_price: n, tp_price: n, exit_price: n, exit_reason: z.string(), pnl: n })) });
export const startSchema = z.object({ swapLongUSD: n.min(-10000).max(10000), swapShortUSD: n.min(-10000).max(10000), swapHourUTC: n.int().min(0).max(23), commissionUSD: n.min(0).max(10000), slippageUSD: n.min(0).max(100) });

export async function ftmoRequest<T>(path: string, schema: z.ZodType<T>, method: "GET" | "POST" = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(`${MT5_BRIDGE_URL}/ftmo/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit", cache: "no-store", signal: signal ?? AbortSignal.timeout(25000), headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" } });
    const data: unknown = await response.json();
    if (!response.ok) { const err = z.object({ detail: z.string() }).safeParse(data); throw new Error(err.success ? err.data.detail : `Passerelle FTMO : HTTP ${response.status}. Vérifiez les champs et la version de la passerelle.`); }
    return schema.parse(data);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const fields = e.issues.map(issue => `${issue.path.join(".") || "réponse"} : ${issue.message}`).join(" ; ");
      throw new Error(`Données FTMO incompatibles (${fields}). Relancez la passerelle mise à jour ; aucune donnée de remplacement.`);
    }
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) throw new Error("Délai de lecture FTMO dépassé. MT5 peut encore synchroniser les historiques XAUUSD M5/M15/M30/H1/H4/D1. Attendez leur chargement puis retestez ; le test ne démarre pas le bot.");
    if (e instanceof TypeError) throw new Error("Passerelle locale inaccessible. Lancez start_mt5_bridge.bat sur ce PC et utilisez l’aperçu HTTP localhost.");
    throw e;
  }
}
