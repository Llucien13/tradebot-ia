import { defineHandler } from "nitro";
import { useRuntimeConfig } from "nitro/runtime-config";
import { createError, setResponseHeader } from "nitro/h3";
import { z } from "zod";

const rateSchema = z.object({ symbol: z.literal("EUR/USD"), rate: z.coerce.number().finite().positive(), timestamp: z.coerce.number().int().positive() });
let cache: { usdPerEur: number; time: number; source: "TWELVE_DATA"; expires: number } | null = null;
let pending: Promise<{ usdPerEur: number; time: number; source: "TWELVE_DATA" }> | null = null;
let retryAfter = 0;
export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  if (cache && cache.expires > Date.now()) return { usdPerEur: cache.usdPerEur, time: cache.time, source: cache.source };
  if (pending) return pending;
  if (retryAfter > Date.now()) throw createError({ statusCode: 429, statusMessage: "Conversion EUR/USD indisponible récemment. Attendez une minute ; aucun taux fictif n’est utilisé." });
  const config = useRuntimeConfig();
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim() || (typeof config.twelveDataApiKey === "string" ? config.twelveDataApiKey.trim() : "");
  if (!apiKey) throw createError({ statusCode: 503, statusMessage: "Twelve Data non configuré : conversion EUR/USD réelle impossible." });
  pending = (async () => {
    let response: Response;
    try { response = await fetch("https://api.twelvedata.com/exchange_rate?symbol=EUR%2FUSD", { headers: { Authorization: `apikey ${apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(15000) }); }
    catch { throw createError({ statusCode: 503, statusMessage: "EUR/USD inaccessible. Compte non enregistré, aucun taux de remplacement." }); }
    if (!response.ok) throw createError({ statusCode: response.status === 429 ? 429 : 502, statusMessage: "Twelve Data refuse la conversion EUR/USD (quota ou droits de l’offre). Aucun taux inventé." });
    let body: unknown;
    try { body = await response.json(); } catch { throw createError({ statusCode: 502, statusMessage: "Réponse EUR/USD illisible." }); }
    const parsed = rateSchema.safeParse(body);
    if (!parsed.success || parsed.data.timestamp * 1000 > Date.now() + 60000) throw createError({ statusCode: 502, statusMessage: "Taux EUR/USD réel invalide ou non disponible avec votre offre. Compte paper non enregistré." });
    const rate = { usdPerEur: parsed.data.rate, time: parsed.data.timestamp * 1000, source: "TWELVE_DATA" as const };
    cache = { ...rate, expires: Date.now() + 300000 };
    return rate;
  })().catch(error => { retryAfter = Date.now() + 60000; throw error; }).finally(() => { pending = null; });
  return pending;
});
