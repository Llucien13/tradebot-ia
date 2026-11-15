import { z } from "zod";
import { MT5_BRIDGE_URL } from "./mt5-local-bridge";
import { manualPositionsSchema } from "./manual-positions";

const n = z.number().finite();
const maybe = n.nullable();
export const monitorTradeSchema = z.object({
  entryTime: n, signalTime: n, entry: n, side: z.union([z.literal(1), z.literal(-1)]),
  lots: n, sl: n, tp: n, riskEUR: n, exitTime: n.optional(), exit: n.optional(),
  pnl: n.optional(), reason: z.string().optional(), entryReason: z.string().optional(),
});
const optionsSchema = z.object({ enabled: z.boolean(), open: z.boolean(), close: z.boolean(), safe: z.boolean(), recovery: z.boolean() });
const eventSchema = z.object({ id: z.string(), at: n, observed: n, kind: z.string(), trade_id: z.string().nullable(), message: z.string(), delivery: z.string().nullable() });
export const monitorReadySchema = z.object({
  ready: z.literal(true), version: z.literal(86), mode: z.literal("PAPER"), liveEnabled: z.literal(false), readOnly: z.literal(true),
  observedAt: n, fresh: z.boolean(), status: z.enum(["RUNNING", "WAITING_QUOTES", "WAITING_MARKET", "SAFE_STOP", "STOPPED"]),
  observerError: z.string().nullable(), floatingEUR: maybe, costModel: z.string(),
  antiGap: z.object({
    checkedAt: n, entriesAllowed: z.boolean(), closeDue: z.boolean(), marketOpen: z.boolean().nullable(),
    weeklyClose: maybe, reopen: maybe, expiresAt: maybe, evidenceSha256: z.string().nullable(), sourceURL: z.string().nullable(),
    status: z.enum(["UNKNOWN", "OPEN", "ENTRY_BLOCKED", "EXIT_DUE", "CLOSE_PENDING", "MARKET_CLOSED", "CLOSED"]), reason: z.string(),
  }).nullable().optional(),
  position: monitorTradeSchema.extend({ id: z.string(), instrument: z.literal("XAUUSD"), floatingEUR: maybe, netPositionEUR: maybe,
    percentInitial: maybe, r: maybe, riskPercentInitial: n, needsReview: z.boolean() }).nullable(),
  quote: z.object({ time: n, fxTime: n, bid: n, ask: n, fx: n }).nullable(),
  metrics: z.object({ initial: z.literal(20000), balance: n, realized: n,
    periods: z.object({ today: n, week: n, month: n, total: n }),
    count: n, wins: n, losses: n, neutral: n, winRate: maybe, averageWin: maybe, averageLoss: maybe,
    profitFactor: maybe, profitFactorInfinite: z.boolean(), averageEUR: maybe, averageR: maybe, rCount: n,
    drawdownEUR: maybe, drawdownPercent: maybe, curveSamples: n,
    curve: z.array(z.object({ time: n, equity: n })), daily: z.array(z.object({ day: z.string(), pnl: n })),
  }),
  health: z.object({ mt5: z.enum(["CONNECTED", "DISCONNECTED", "UNKNOWN"]),
    worker: z.object({ status: z.string(), alive: z.boolean(), heartbeat: maybe, cause: z.string().nullable() }),
    ticks: z.record(z.object({ time: maybe, age: maybe, fresh: z.boolean() })), frameCounts: z.record(n),
    m15: z.enum(["LAST_VALIDATED", "INSUFFICIENT", "UNKNOWN"]), lastObserved: maybe,
    lastSignal: z.object({ time: n, side: n }).nullable(), waitingReason: z.string().nullable().optional(),
    waitingAge: maybe.optional(), error: z.string(), storageFault: z.string().nullable(), continuous: z.boolean(),
  }),
  lastError: z.object({ time: n, message: z.string() }).nullable(),
  notifications: z.object({ configured: z.boolean(), settings: optionsSchema,
    deliveries: z.array(z.object({ status: z.string(), count: n })), lastFailure: z.string().nullable() }),
  events: z.array(eventSchema),
});
const stateSchema = z.discriminatedUnion("ready", [monitorReadySchema, z.object({ ready: z.literal(false), observerError: z.string() })]);
export const journalSchema = z.object({ total: n, offset: n, items: z.array(z.object({ id: z.string(), needsReview: z.boolean(), trade: monitorTradeSchema })) });
export type MonitorData = z.infer<typeof monitorReadySchema>;
export type MonitorTrade = z.infer<typeof monitorTradeSchema>;
export type NotificationOptions = z.infer<typeof optionsSchema>;
export type JournalData = z.infer<typeof journalSchema>;

async function response(path: string, signal?: AbortSignal, body?: unknown) {
  if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    throw new Error("Le bridge reste local au PC Acer. Sur iPhone, utilisez Bureau à distance Google ; aucun accès distant V86 n’est activé.");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = window.setTimeout(abort, 12000);
  try {
    const result = await fetch(`${MT5_BRIDGE_URL}/paper-monitor/${path}`, {
      method: body === undefined ? "GET" : "POST", credentials: "omit", cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!result.ok) {
      const detail = await result.json().catch(() => ({}));
      throw new Error(typeof detail.detail === "string" ? detail.detail : `Monitoring HTTP ${result.status}. Vérifiez que la passerelle V86 est chargée.`);
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")) {
      throw new Error("Bridge inaccessible ou délai dépassé. Les dernières valeurs ne sont pas des données temps réel.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export async function readMonitor(signal: AbortSignal) {
  return stateSchema.parse(await (await response("state", signal)).json());
}
export async function readManualPositions(signal: AbortSignal) {
  return manualPositionsSchema.parse(await (await response("manual-positions", signal)).json());
}
export async function readJournal(params: URLSearchParams, signal: AbortSignal) {
  return journalSchema.parse(await (await response(`journal?${params}`, signal)).json());
}
export async function saveNotifications(options: NotificationOptions) {
  return optionsSchema.parse(await (await response("notifications/settings", undefined, options)).json());
}
export async function testNotification() {
  return (await response("notifications/test", undefined, {})).json();
}
export async function exportJournal(params: URLSearchParams) {
  const result = await response(`export.csv?${params}`);
  const url = URL.createObjectURL(await result.blob());
  const link = document.createElement("a");
  link.href = url; link.download = "tradebot-paper-v86.csv"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
