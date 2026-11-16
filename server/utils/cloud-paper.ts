import { createError, getHeader } from "nitro/h3";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { accountSchema, paperStateSchema, validatePaperStateIntegrity, type PaperState } from "../../src/lib/paper/model";
import { strategySchema, type Strategy } from "../../src/lib/strategies";

export interface CloudPaperRow {
  user_id: string;
  revision: number;
  state: PaperState;
  strategy: Strategy;
  running: boolean;
  updated_at: string;
}

export interface CloudPaperEvent {
  event_id: string;
  event_type: "SIGNAL" | "POSITION_OPENED" | "POSITION_CLOSED" | "ENTRY_CANCELLED";
  occurred_at: string;
  payload: unknown;
}

export function validateCloudPaperRow(raw: unknown, userId?: string): CloudPaperRow {
  if (!raw || typeof raw !== "object") {
    throw createError({ statusCode: 503, statusMessage: "Compte Cloud PAPER invalide dans le stockage." });
  }
  const row = raw as Partial<CloudPaperRow>;
  const state = paperStateSchema.safeParse(row.state);
  const strategy = strategySchema.safeParse(row.strategy);
  if (typeof row.user_id !== "string" || (userId && row.user_id !== userId)
      || !Number.isSafeInteger(row.revision) || row.revision! < 0
      || typeof row.running !== "boolean" || typeof row.updated_at !== "string"
      || !Number.isFinite(Date.parse(row.updated_at)) || !state.success || !strategy.success
      || state.data.running !== row.running || !state.data.account) {
    throw createError({ statusCode: 503, statusMessage: "Compte Cloud PAPER corrompu ou incohérent; moteur arrêté sans remplacement." });
  }
  const account = accountSchema.safeParse(state.data.account);
  if (!account.success) {
    throw createError({ statusCode: 503, statusMessage: "Paramètres du compte Cloud PAPER incohérents; moteur arrêté." });
  }
  try {
    validatePaperStateIntegrity(state.data);
  } catch {
    throw createError({ statusCode: 503, statusMessage: "Registre ou capital Cloud PAPER incohérent; moteur arrêté sans recalcul." });
  }
  return {
    user_id: row.user_id,
    revision: row.revision!,
    state: state.data,
    strategy: strategy.data,
    running: row.running,
    updated_at: row.updated_at,
  };
}

interface CloudConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
}

function config(): CloudConfig {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceKey || !/^https:\/\/[^/]+$/.test(url)) {
    throw createError({ statusCode: 503, statusMessage: "Cloud PAPER indisponible : la configuration privée Supabase n’est pas complète." });
  }
  return { url, anonKey, serviceKey };
}

export async function requireCloudPaperUser(event: Parameters<typeof getHeader>[0]) {
  const authorization = getHeader(event, "authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9._~-]+$/.test(authorization)) {
    throw createError({ statusCode: 401, statusMessage: "Authentification Cloud PAPER requise." });
  }
  const settings = config();
  let response: Response;
  try {
    response = await fetch(`${settings.url}/auth/v1/user`, {
      headers: { apikey: settings.anonKey, Authorization: authorization, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw createError({ statusCode: 503, statusMessage: "Service d’authentification Cloud PAPER inaccessible." });
  }
  if (response.status === 401 || response.status === 403) {
    throw createError({ statusCode: 401, statusMessage: "Session Cloud PAPER invalide ou expirée." });
  }
  if (!response.ok) throw createError({ statusCode: 502, statusMessage: "Vérification de session Cloud PAPER impossible." });
  let profile: unknown;
  try {
    profile = await response.json();
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Réponse d’authentification Cloud PAPER invalide." });
  }
  if (!profile || typeof profile !== "object" || !("id" in profile) || typeof profile.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profile.id)) {
    throw createError({ statusCode: 401, statusMessage: "Identité Cloud PAPER invalide." });
  }
  return { id: profile.id, settings };
}

export async function serviceRequest<T>(settings: CloudConfig, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${settings.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: settings.serviceKey,
        Authorization: `Bearer ${settings.serviceKey}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw createError({ statusCode: 503, statusMessage: "Stockage durable Cloud PAPER inaccessible." });
  }
  if (!response.ok) {
    throw createError({
      statusCode: response.status === 409 ? 409 : response.status >= 500 ? 503 : 502,
      statusMessage: response.status === 409
        ? "Conflit de révision Cloud PAPER. Rechargez l’état avant de réessayer."
        : "Écriture ou lecture du stockage Cloud PAPER impossible.",
    });
  }
  const prefer = new Headers(init?.headers).get("Prefer") ?? "";
  if (response.status === 204 || (response.status === 201 && prefer.includes("return=minimal"))) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Réponse du stockage Cloud PAPER invalide." });
  }
}

export async function getCloudPaperAccount(settings: CloudConfig, userId: string): Promise<CloudPaperRow | null> {
  const rows = await serviceRequest<unknown>(
    settings,
    `cloud_paper_accounts?select=user_id,revision,state,strategy,running,updated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  if (!Array.isArray(rows)) throw createError({ statusCode: 502, statusMessage: "Compte Cloud PAPER invalide dans le stockage." });
  if (!rows.length) return null;
  return validateCloudPaperRow(rows[0], userId);
}

export async function createCloudPaperAccount(
  settings: CloudConfig,
  userId: string,
  state: PaperState,
  strategy: Strategy,
): Promise<void> {
  await serviceRequest(settings, "cloud_paper_accounts", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, revision: 0, state, strategy, running: false }),
  });
}

export async function listCloudPaperAccounts(settings: CloudConfig): Promise<CloudPaperRow[]> {
  const rows = await serviceRequest<unknown>(
    settings,
    "cloud_paper_accounts?select=user_id,revision,state,strategy,running,updated_at&order=updated_at.asc&limit=200",
  );
  if (!Array.isArray(rows)) throw createError({ statusCode: 502, statusMessage: "Liste des comptes Cloud PAPER invalide." });
  if (rows.length >= 200) throw createError({ statusCode: 503, statusMessage: "Limite de comptes Cloud PAPER atteinte; cycle interrompu sans omettre silencieusement de compte." });
  return rows.map(row => validateCloudPaperRow(row));
}

export async function commitCloudPaperCycle(
  settings: CloudConfig,
  row: CloudPaperRow,
  nextState: PaperState,
  events: CloudPaperEvent[],
): Promise<boolean> {
  const result = await serviceRequest<unknown>(settings, "rpc/cloud_paper_commit_cycle", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: row.user_id,
      p_expected_revision: row.revision,
      p_state: nextState,
      p_events: events,
      p_updated_at: new Date().toISOString(),
    }),
  });
  if (typeof result !== "boolean") throw createError({ statusCode: 502, statusMessage: "Réponse de persistance Cloud PAPER invalide." });
  return result;
}

export async function readCloudPaperEvents(
  settings: CloudConfig,
  userId: string,
  limit = 100,
): Promise<CloudPaperEvent[]> {
  const rows = await serviceRequest<unknown>(
    settings,
    `cloud_paper_events?select=event_id,event_type,occurred_at,payload&user_id=eq.${encodeURIComponent(userId)}&order=occurred_at.desc&limit=${limit}`,
  );
  if (!Array.isArray(rows)) throw createError({ statusCode: 502, statusMessage: "Journal Cloud PAPER invalide." });
  return rows.map(raw => {
    if (!raw || typeof raw !== "object") throw createError({ statusCode: 502, statusMessage: "Événement Cloud PAPER invalide." });
    const event = raw as Record<string, unknown>;
    if (typeof event.event_id !== "string" || !["SIGNAL", "POSITION_OPENED", "POSITION_CLOSED", "ENTRY_CANCELLED"].includes(String(event.event_type))
        || typeof event.occurred_at !== "string" || !event.payload || typeof event.payload !== "object") {
      throw createError({ statusCode: 502, statusMessage: "Événement Cloud PAPER invalide." });
    }
    const payload = z.record(z.string(), z.unknown()).safeParse(event.payload);
    if (!payload.success) throw createError({ statusCode: 502, statusMessage: "Charge utile de journal Cloud PAPER invalide." });
    return {
      event_id: event.event_id,
      event_type: event.event_type as CloudPaperEvent["event_type"],
      occurred_at: event.occurred_at,
      payload: payload.data,
    };
  });
}

export async function verifyCronRequest(authorization: string | undefined): Promise<CloudConfig> {
  const secret = process.env.CRON_SECRET?.trim() || process.env.CLOUD_PAPER_CRON_SECRET?.trim();
  if (!secret) throw createError({ statusCode: 503, statusMessage: "Cycle Cloud PAPER désactivé : secret cron serveur absent." });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization ?? "");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw createError({ statusCode: 401, statusMessage: "Cycle Cloud PAPER non autorisé." });
  }
  return config();
}

export async function fetchPaperFxRate(apiKey: string): Promise<{ rate: number; timestamp: number }> {
  let response: Response;
  try {
    response = await fetch("https://api.twelvedata.com/exchange_rate?symbol=EUR%2FUSD", {
      headers: { Authorization: `apikey ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw createError({ statusCode: 503, statusMessage: "EUR/USD inaccessible. Compte cloud non créé; aucun taux de remplacement." });
  }
  if (!response.ok) {
    throw createError({
      statusCode: response.status === 429 ? 429 : 502,
      statusMessage: "Twelve Data refuse la conversion EUR/USD (quota ou droits de l’offre). Aucun taux inventé.",
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Réponse EUR/USD illisible." });
  }
  const parsed = z.object({
    symbol: z.literal("EUR/USD"),
    rate: z.coerce.number().finite().positive(),
    timestamp: z.coerce.number().int().positive(),
  }).safeParse(body);
  if (!parsed.success || parsed.data.timestamp * 1000 > Date.now() + 60000
      || Date.now() - parsed.data.timestamp * 1000 > 300000) {
    throw createError({ statusCode: 502, statusMessage: "Taux EUR/USD absent, périmé ou invalide. Compte cloud non créé." });
  }
  return { rate: parsed.data.rate, timestamp: parsed.data.timestamp * 1000 };
}
