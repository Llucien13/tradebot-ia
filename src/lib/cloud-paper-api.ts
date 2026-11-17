import { z } from "zod";
import { accountInputSchema, paperCapitalSchema, paperStateSchema } from "@/lib/paper/model";
import { strategySchema } from "@/lib/strategies";
import { cloudMonitorJournalSchema, cloudMonitorSnapshotSchema } from "@/lib/cloud-monitor-model";

const authSchema = z.object({
  access_token: z.string().min(20),
  refresh_token: z.string().min(20),
  expires_at: z.number().optional(),
  expires_in: z.number().positive().optional(),
  token_type: z.string().optional(),
});
const sessionSchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20),
  expiresAt: z.number().nullable(),
});
const setupSchema = z.object({
  account: accountInputSchema.extend({ initialCapital: paperCapitalSchema }),
  strategy: strategySchema,
});
const storageKey = "tradebot.cloud-paper.session.v1";
let refreshPending: Promise<CloudPaperSession> | null = null;
let publicConfigPending: Promise<{ url: string; anonKey: string }> | null = null;

export interface CloudPaperSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}

export interface CloudPaperSnapshot {
  configured: boolean;
  revision: number | null;
  running: boolean;
  lastCycleAt: string | null;
  state: z.infer<typeof paperStateSchema> | null;
  strategy: z.infer<typeof strategySchema> | null;
}

async function config() {
  if (!publicConfigPending) {
    publicConfigPending = fetch("/api/cloud-paper/public-config", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    }).then(async response => {
      if (!response.ok) throw new Error("Configuration publique Supabase indisponible côté serveur.");
      const parsed = z.object({
        url: z.string().url().refine(value => {
          try {
            const url = new URL(value);
            return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
          } catch {
            return false;
          }
        }),
        anonKey: z.string().min(20).max(4096).refine(value =>
          /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value)
          || value.split(".").length === 3 && value.split(".").every(part => /^[A-Za-z0-9_-]+$/.test(part)),
        ),
      }).safeParse(await response.json());
      if (!parsed.success) throw new Error("Configuration publique Supabase absente ou invalide.");
      return parsed.data;
    }).catch(error => {
      publicConfigPending = null;
      throw error;
    });
  }
  return publicConfigPending;
}

export function readCloudPaperSession(): CloudPaperSession | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    const value = parsed.data;
    if (value.expiresAt !== null && value.expiresAt <= Date.now()) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt ?? null };
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

export function clearCloudPaperSession() {
  sessionStorage.removeItem(storageKey);
}

export async function signInCloudPaper(email: string, password: string): Promise<CloudPaperSession> {
  const { url, anonKey } = await config();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401
    ? "Adresse e-mail ou mot de passe invalide."
    : "Connexion Cloud PAPER indisponible.");
  const parsed = authSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Réponse d’authentification Cloud invalide.");
  const session: CloudPaperSession = {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: parsed.data.expires_at ? parsed.data.expires_at * 1000
      : parsed.data.expires_in ? Date.now() + parsed.data.expires_in * 1000
        : null,
  };
  sessionStorage.setItem(storageKey, JSON.stringify(session));
  return session;
}

async function cloudRequest<T>(path: string, session: CloudPaperSession, method = "GET", body?: unknown): Promise<T> {
  const activeSession = readCloudPaperSession() ?? session;
  const currentSession = activeSession.expiresAt !== null && activeSession.expiresAt <= Date.now() + 60000
    ? await refreshCloudPaperSession(activeSession)
    : activeSession;
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${currentSession.accessToken}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Réponse Cloud PAPER illisible (HTTP ${response.status}).`);
  }

  async function refreshCloudPaperSession(session: CloudPaperSession): Promise<CloudPaperSession> {
    if (refreshPending) return refreshPending;
    refreshPending = performSessionRefresh(session).finally(() => { refreshPending = null; });
    return refreshPending;
  }

  async function performSessionRefresh(session: CloudPaperSession): Promise<CloudPaperSession> {
    const { url, anonKey } = await config();
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      clearCloudPaperSession();
      throw new Error("Session Cloud expirée; reconnectez-vous.");
    }
    const parsed = authSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Réponse de renouvellement Cloud invalide.");
    const refreshed = {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresAt: parsed.data.expires_at ? parsed.data.expires_at * 1000
        : parsed.data.expires_in ? Date.now() + parsed.data.expires_in * 1000
          : null,
    };
    sessionStorage.setItem(storageKey, JSON.stringify(refreshed));
    return refreshed;
  }
  if (response.status === 401) {
    clearCloudPaperSession();
    throw new Error("Session Cloud expirée; reconnectez-vous.");
  }
  if (!response.ok) {
    const error = z.object({ statusMessage: z.string().optional(), message: z.string().optional() }).safeParse(payload);
    throw new Error(error.success
      ? error.data.statusMessage || error.data.message || `Cloud PAPER : HTTP ${response.status}.`
      : `Cloud PAPER : HTTP ${response.status}.`);
  }
  return payload as T;
}

export async function readCloudPaperState(session: CloudPaperSession) {
  const response = await cloudRequest<unknown>("/api/cloud-paper/state", session);
  const parsed = z.object({
    configured: z.boolean(),
    revision: z.number().int().nonnegative().nullable(),
    running: z.boolean(),
    lastCycleAt: z.string().datetime({ offset: true }).nullable().optional(),
    state: paperStateSchema.nullable(),
    strategy: strategySchema.nullable(),
  }).safeParse(response);
  if (!parsed.success) throw new Error("État Cloud PAPER invalide; aucun état local n’est substitué.");
  return { ...parsed.data, lastCycleAt: parsed.data.lastCycleAt ?? null } as CloudPaperSnapshot;
}

export async function setupCloudPaper(
  session: CloudPaperSession,
  account: z.infer<typeof setupSchema>["account"],
  strategy: z.infer<typeof strategySchema>,
) {
  return cloudRequest<{ configured: boolean; running: boolean; initialCapital: number; currency: string }>(
    "/api/cloud-paper/setup",
    session,
    "POST",
    setupSchema.parse({ account, strategy }),
  );
}

export async function setCloudPaperRunning(
  session: CloudPaperSession,
  running: boolean,
  expectedRevision: number,
) {
  return cloudRequest<{ configured: boolean; revision: number; running: boolean; state: z.infer<typeof paperStateSchema> }>(
    "/api/cloud-paper/control",
    session,
    "POST",
    { running, expectedRevision },
  );
}

export async function readCloudPaperJournal(session: CloudPaperSession) {
  const response = await cloudRequest<unknown>("/api/cloud-paper/journal?limit=100", session);
  const parsed = z.object({
    events: z.array(z.object({
      event_id: z.string(),
      event_type: z.enum(["SIGNAL", "POSITION_OPENED", "POSITION_CLOSED", "ENTRY_CANCELLED"]),
      occurred_at: z.string().datetime({ offset: true }),
      payload: z.record(z.string(), z.unknown()),
    })),
  }).safeParse(response);
  if (!parsed.success) throw new Error("Journal Cloud PAPER invalide.");
  return parsed.data.events;
}

export async function readCloudMonitorState(session: CloudPaperSession) {
  const response = await cloudRequest<unknown>("/api/paper-monitor/state", session);
  const parsed = z.object({
    configured: z.boolean(),
    snapshot: cloudMonitorSnapshotSchema.nullable(),
    syncedAt: z.string().datetime({ offset: true }).nullable(),
  }).safeParse(response);
  if (!parsed.success) throw new Error("État du monitoring PC Cloud invalide.");
  return parsed.data;
}

export async function readCloudMonitorJournal(session: CloudPaperSession, offset = 0, limit = 50) {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  const response = await cloudRequest<unknown>(`/api/paper-monitor/journal?${query}`, session);
  const parsed = cloudMonitorJournalSchema.safeParse(response);
  if (!parsed.success) throw new Error("Journal du monitoring PC Cloud invalide.");
  return parsed.data;
}
