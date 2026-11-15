import { z } from "zod";
import { MT5_BRIDGE_URL } from "./mt5-local-bridge";

const n = z.number().finite();
const position = z.object({ entryTime: n, signalTime: n, entry: n, side: z.union([z.literal(1), z.literal(-1)]), lots: n, sl: n, tp: n, riskEUR: n });
export const trialSchema = z.object({
  kind: z.literal("ESSAI_PAPER"), connected: z.boolean(), valuationFresh: z.boolean(), quoteWaiting: z.boolean(), storageFault: z.string().nullable(), costModel: z.string(), riskPercent: n,
  worker: z.object({ status: z.string(), alive: z.boolean(), heartbeat: n.nullable(), cause: z.string().nullable() }),
  feed: z.object({ time: n, fxTime: n, bid: n, ask: n, fx: n }).nullable(),
  state: z.object({ mode: z.literal("PAPER"), liveEnabled: z.literal(false), trial: z.literal(true), tpR: z.literal(2.5), running: z.boolean(),
    balance: n, equity: n, status: z.string(), error: z.string(), verifiedContinuous: z.boolean(),
    quoteWaiting: z.boolean().optional(), quoteWaitReason: z.string().nullable().optional(), quoteWaitAge: n.nullable().optional(), position: position.nullable(),
    trades: z.array(position.extend({ exitTime: n, exit: n, reason: z.string(), pnl: n, balance: n })),
    curve: z.array(z.object({ time: n, equity: n })), lastObserved: n.nullable(),
    lastSignalResult: z.object({ time: n, side: n }).optional(),
  }),
});
export type PaperTrialSnapshot = z.infer<typeof trialSchema>;

export async function trialRequest(action: "state" | "start" | "stop", signal?: AbortSignal): Promise<PaperTrialSnapshot> {
  let response: Response;
  try {
    response = await fetch(`${MT5_BRIDGE_URL}/paper-trial/${action}`, {
      method: action === "state" ? "GET" : "POST", credentials: "omit", cache: "no-store",
      signal: signal ?? AbortSignal.timeout(25000), headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Passerelle MT5 inaccessible ou délai dépassé. Ouvrez MT5 et relancez start_mt5_bridge.bat, puis réessayez.");
  }
  if (response.status === 404) throw new Error("Cette passerelle ne contient pas encore l’essai. Fermez sa fenêtre puis relancez start_mt5_bridge.bat.");
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ detail: z.string() }).safeParse(payload);
    throw new Error(error.success ? error.data.detail : `Essai PAPER : HTTP ${response.status}.`);
  }
  const parsed = trialSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Réponse ESSAI incompatible : aucune position ou cotation de remplacement. Relancez la passerelle mise à jour.");
  return parsed.data;
}
