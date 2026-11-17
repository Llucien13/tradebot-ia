import { createError } from "nitro/h3";

export interface CloudPublicConfig {
  url: string;
  anonKey: string;
}

function isPublicAnonKey(value: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown };
    return payload.role === "anon";
  } catch {
    return false;
  }
}

export function getCloudPublicConfig(): CloudPublicConfig {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  let url: URL | undefined;
  try {
    if (rawUrl) url = new URL(rawUrl);
  } catch {
    url = undefined;
  }

  if (!url || url.protocol !== "https:" || !url.hostname || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash
      || !anonKey || anonKey.length > 4096 || !isPublicAnonKey(anonKey)) {
    throw createError({ statusCode: 503, statusMessage: "Configuration publique Supabase absente ou invalide." });
  }

  return { url: url.origin, anonKey };
}
