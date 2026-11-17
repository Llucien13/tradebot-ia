import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({
  configFile: false,
  root,
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true },
  appType: "custom",
});

class MemoryStorage {
  #items = new Map();

  get length() { return this.#items.size; }
  clear() { this.#items.clear(); }
  getItem(key) { return this.#items.get(key) ?? null; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  removeItem(key) { this.#items.delete(key); }
  setItem(key, value) { this.#items.set(key, String(value)); }
}

const storage = new MemoryStorage();
globalThis.window = { sessionStorage: storage };

const accessToken = expiresAt => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: expiresAt,
    role: "authenticated",
    sub: "00000000-0000-4000-8000-000000000001",
  })}.signature`;
};
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "paper@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: new Date().toISOString(),
};

let configIsValid = false;
let authMode = "success";
let authCalls = 0;
let refreshCalls = 0;
let expectedAccessToken = "";
let apiAuthorizationValid = false;
const privateTestPassword = "test-password-never-log";

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "https://app.example.test");
  if (url.pathname === "/api/cloud-paper/public-config") {
    return Response.json({
      url: "https://project.supabase.co",
      anonKey: configIsValid ? `sb_publishable_${"a".repeat(32)}` : "invalid-public-key",
    });
  }

  if (url.pathname === "/auth/v1/token") {
    authCalls++;
    if (url.searchParams.get("grant_type") === "password") {
      if (authMode === "invalid") {
        return Response.json({ code: "invalid_credentials", message: "Invalid login credentials" }, { status: 400 });
      }
      if (authMode === "malformed") return Response.json({});
      expectedAccessToken = accessToken(Math.floor(Date.now() / 1000) + 3600);
      return Response.json({
        access_token: expectedAccessToken,
        refresh_token: "refresh-token-for-tests",
        token_type: "bearer",
        expires_in: 3600,
        user,
      });
    }

    if (url.searchParams.get("grant_type") === "refresh_token") {
      refreshCalls++;
      expectedAccessToken = accessToken(Math.floor(Date.now() / 1000) + 3600);
      return Response.json({
        access_token: expectedAccessToken,
        refresh_token: "rotated-refresh-token-for-tests",
        token_type: "bearer",
        expires_in: 3600,
        user,
      });
    }
  }

  if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });

  if (url.pathname === "/api/paper-monitor/state") {
    apiAuthorizationValid = new Headers(init.headers).get("Authorization") === `Bearer ${expectedAccessToken}`;
    return Response.json({
      configured: true,
      syncedAt: new Date().toISOString(),
      snapshot: {
        version: 86,
        mode: "PAPER",
        liveEnabled: false,
        readOnly: true,
        observedAt: Date.now(),
        fresh: true,
        status: "STOPPED",
        floatingEUR: null,
        position: null,
        metrics: {
          initial: 20000,
          balance: 20000,
          realized: 0,
          count: 0,
          wins: 0,
          losses: 0,
          neutral: 0,
          winRate: null,
        },
        health: {
          mt5: "UNKNOWN",
          worker: { status: "not-running", alive: false, heartbeat: null },
          storageFault: false,
        },
      },
    });
  }

  throw new Error("Unexpected request in Cloud auth integration test.");
};

try {
  const {
    clearCloudPaperSession,
    readCloudMonitorState,
    readCloudPaperSession,
    signInCloudPaper,
  } = await vite.ssrLoadModule("/src/lib/cloud-paper-api.ts");

  let assertions = 0;
  const check = (condition, message) => {
    assert.ok(condition, message);
    assertions++;
  };

  await assert.rejects(
    signInCloudPaper("paper@example.test", privateTestPassword),
    /Configuration publique Supabase absente ou invalide/,
  );
  check(authCalls === 0, "Invalid runtime config is rejected before any auth request.");

  configIsValid = true;
  const session = await signInCloudPaper("paper@example.test", privateTestPassword);
  check(session.authenticated === true, "A valid SDK password login returns an authenticated app session.");
  check(storage.getItem("tradebot.cloud-paper.session.v1") !== null, "The SDK persists the session in tab storage.");

  const persisted = JSON.parse(storage.getItem("tradebot.cloud-paper.session.v1"));
  persisted.expires_at = Math.floor(Date.now() / 1000) - 1;
  storage.setItem("tradebot.cloud-paper.session.v1", JSON.stringify(persisted));

  const restoredSession = await readCloudPaperSession();
  check(restoredSession?.authenticated === true, "The SDK restores an existing session.");
  check(refreshCalls === 1, "The SDK refreshes an expired session and persists its rotated credentials.");

  const monitor = await readCloudMonitorState(restoredSession);
  check(monitor.snapshot?.mode === "PAPER", "Authenticated Cloud API reads continue to validate the monitoring payload.");
  check(apiAuthorizationValid, "Cloud API requests use the current SDK-managed access token.");

  await clearCloudPaperSession();
  check(storage.getItem("tradebot.cloud-paper.session.v1") === null, "SDK sign-out clears the persisted tab session.");
  check(await readCloudPaperSession() === null, "Signed-out sessions are not restored.");

  authMode = "invalid";
  await assert.rejects(
    signInCloudPaper("paper@example.test", privateTestPassword),
    error => error instanceof Error && error.message === "Adresse e-mail ou mot de passe invalide.",
  );
  assertions++;
  authMode = "malformed";
  await assert.rejects(
    signInCloudPaper("paper@example.test", privateTestPassword),
    error => error instanceof Error && error.message === "La réponse d’authentification Supabase est invalide ou non prise en charge.",
  );
  assertions++;

  console.log(`Cloud auth SDK integration checks passed: ${assertions} assertions.`);
} finally {
  await vite.close();
  delete globalThis.window;
  delete globalThis.fetch;
}
