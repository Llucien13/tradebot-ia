import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { accountInputSchema, paperCapitalSchema, paperStateSchema } from "@/lib/paper/model";
import { strategySchema } from "@/lib/strategies";
import { cloudMonitorJournalSchema, cloudMonitorSnapshotSchema } from "@/lib/cloud-monitor-model";

const setupSchema = z.object({
  account: accountInputSchema.extend({ initialCapital: paperCapitalSchema }),
  strategy: strategySchema,
});
const storageKey = "tradebot.cloud-paper.session.v1";
let publicConfigPending: Promise<{ url: string; anonKey: string }> | null = null;
let cloudClientPending: Promise<SupabaseClient> | null = null;

export interface CloudPaperSession {
  authenticated: true;
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
      if (error instanceof Error && error.message.startsWith("Configuration publique Supabase")) throw error;
      throw new Error("Impossible de joindre la configuration Cloud. Réessayez dans quelques instants.");
    });
  }
  return publicConfigPending;
}

async function cloudAuthClient(): Promise<SupabaseClient> {
  if (!cloudClientPending) {
    cloudClientPending = config().then(({ url, anonKey }) => {
      if (typeof window === "undefined") throw new Error("La connexion Cloud doit être ouverte dans un navigateur.");
      let storage: Storage;
      try {
        storage = window.sessionStorage;
      } catch {
        throw new Error("Le stockage de session est indisponible dans ce navigateur.");
      }
      return createClient(url, anonKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
          storage,
          storageKey,
        },
      });
    }).catch(error => {
      cloudClientPending = null;
      throw error;
    });
  }
  return cloudClientPending;
}

function authErrorMessage(error: unknown, purpose: "login" | "session"): string {
  const details = typeof error === "object" && error !== null
    ? error as { status?: unknown; name?: unknown }
    : {};
  const status = typeof details.status === "number" ? details.status : null;
  const name = typeof details.name === "string" ? details.name : "";
  if (name === "AuthInvalidTokenResponseError") return "La réponse d’authentification Supabase est invalide ou non prise en charge.";
  if (purpose === "login" && (status === 400 || status === 401)) {
    return "Adresse e-mail ou mot de passe invalide.";
  }
  if (status === 429) return "Trop de tentatives de connexion. Réessayez plus tard.";
  if (purpose === "session" && (status === 400 || status === 401)) {
    return "Session Cloud expirée; reconnectez-vous.";
  }
  if (status !== null && status >= 500) return "Le service d’authentification Cloud est temporairement indisponible.";
  if (name === "AuthRetryableFetchError" || error instanceof TypeError) {
    return "Impossible de joindre Supabase. Vérifiez votre connexion puis réessayez.";
  }
  if (purpose === "login") return "La réponse d’authentification Supabase est invalide ou non prise en charge.";
  return "Impossible de vérifier la session Cloud. Réessayez ou reconnectez-vous.";
}

function authenticatedSession(session: Session | null): CloudPaperSession | null {
  return session ? { authenticated: true } : null;
}

export async function readCloudPaperSession(): Promise<CloudPaperSession | null> {
  const client = await cloudAuthClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(authErrorMessage(error, "session"));
  return authenticatedSession(data.session);
}

export async function clearCloudPaperSession(): Promise<void> {
  if (!cloudClientPending) {
    try {
      window.sessionStorage.removeItem(storageKey);
      return;
    } catch {
      throw new Error("Impossible d’effacer la session Cloud dans ce navigateur.");
    }
  }
  const client = await cloudClientPending;
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new Error(authErrorMessage(error, "session"));
}

export async function signInCloudPaper(email: string, password: string): Promise<CloudPaperSession> {
  const client = await cloudAuthClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authErrorMessage(error, "login"));
  if (!data.session) {
    throw new Error(data.user
      ? "La confirmation de l’adresse e-mail est nécessaire avant la connexion."
      : "Supabase n’a pas retourné de session Cloud valide.");
  }
  return { authenticated: true };
}

async function cloudRequest<T>(
  path: string,
  session: CloudPaperSession,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (!session.authenticated) throw new Error("Session Cloud expirée; reconnectez-vous.");
  const client = await cloudAuthClient();
  const { data: authData, error: authError } = await client.auth.getSession();
  if (authError) throw new Error(authErrorMessage(authError, "session"));
  if (!authData.session) throw new Error("Session Cloud expirée; reconnectez-vous.");

  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${authData.session.access_token}`,
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
  if (response.status === 401) {
    await clearCloudPaperSession();
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
