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

try {
  const { parseSupabaseAuthResponse } = await vite.ssrLoadModule("/src/lib/cloud-paper-api.ts");
  const now = 1_800_000_000_000;
  const base = {
    access_token: `access-token-${"a".repeat(32)}`,
    refresh_token: `refresh-token-${"b".repeat(32)}`,
    token_type: "bearer",
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      aud: "authenticated",
      email: "paper@example.test",
      app_metadata: {},
      user_metadata: {},
      created_at: new Date(now).toISOString(),
    },
  };

  let assertions = 0;
  const check = (condition, message) => {
    assert.ok(condition, message);
    assertions++;
  };

  const secondsExpiry = parseSupabaseAuthResponse({ ...base, expires_in: 3600, expires_at: now / 1000 + 3600 }, now);
  check(secondsExpiry?.expiresAt === now + 3600_000, "Standard Supabase Unix-second expiry is normalized.");

  const stringExpiry = parseSupabaseAuthResponse({ ...base, expires_in: "3600", expires_at: String(now / 1000 + 3600) }, now);
  check(stringExpiry?.expiresAt === now + 3600_000, "Numeric expiry strings are normalized.");

  const isoExpiry = parseSupabaseAuthResponse({ ...base, expires_at: new Date(now + 600_000).toISOString() }, now);
  check(isoExpiry?.expiresAt === now + 600_000, "ISO absolute expiry is normalized.");

  const nullAbsolute = parseSupabaseAuthResponse({ ...base, expires_at: null, expires_in: 120 }, now);
  check(nullAbsolute?.expiresAt === now + 120_000, "Null absolute expiry falls back to relative expiry.");

  const millisecondExpiry = parseSupabaseAuthResponse({ ...base, expires_at: now + 300_000 }, now);
  check(millisecondExpiry?.expiresAt === now + 300_000, "Millisecond absolute expiry is preserved.");

  const noExpiry = parseSupabaseAuthResponse({ ...base, expires_at: null, expires_in: null }, now);
  check(noExpiry?.expiresAt === null, "Missing expiry is represented as non-refreshable session expiry.");

  for (const invalid of [
    { ...base, access_token: "" },
    { ...base, refresh_token: null },
    { ...base, expires_in: "not-a-duration" },
    { ...base, expires_at: "not-a-date" },
    { ...base, user: { id: "not-a-uuid" } },
    { ...base, user: undefined },
  ]) {
    check(parseSupabaseAuthResponse(invalid, now) === null, "Malformed auth responses are rejected.");
  }

  check(parseSupabaseAuthResponse({ ...base, expires_at: now / 1000 - 1 }, now) === null, "Expired sessions are rejected.");
  console.log(`Cloud auth checks passed: ${assertions} assertions.`);
} finally {
  await vite.close();
}
