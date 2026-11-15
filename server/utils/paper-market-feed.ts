import { createError } from "nitro/h3";
import { z } from "zod";
import type { PaperCandle, PaperFeed, PaperTimeframe } from "../../src/lib/paper/model";

const responseSchema = z.object({
  meta: z.object({ symbol: z.literal("XAU/USD"), interval: z.enum(["1h", "4h"]) }),
  values: z.array(z.object({
    datetime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    open: z.coerce.number().finite().positive(),
    high: z.coerce.number().finite().positive(),
    low: z.coerce.number().finite().positive(),
    close: z.coerce.number().finite().positive(),
  })).min(2).max(2000),
});

let cache: { data: PaperFeed; expires: number } | null = null;
let pending: Promise<PaperFeed> | null = null;
let retryAfter = 0;

async function load(timeframe: PaperTimeframe, apiKey: string): Promise<PaperCandle[]> {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.search = new URLSearchParams({
    symbol: "XAU/USD",
    interval: timeframe,
    outputsize: "2000",
    timezone: "UTC",
    order: "ASC",
    format: "JSON",
  }).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `apikey ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw createError({ statusCode: 503, statusMessage: `Twelve Data ${timeframe} inaccessible. Aucun signal ou trade de remplacement.` });
  }
  if (!response.ok) {
    throw createError({
      statusCode: response.status === 429 ? 429 : 502,
      statusMessage: response.status === 429
        ? "Quota Twelve Data atteint. Le moteur paper est suspendu jusqu’à récupération de données réelles."
        : `Twelve Data refuse XAU/USD ${timeframe}. Vérifiez les droits de votre offre.`,
    });
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Réponse Twelve Data illisible. Aucun mode DEMO." });
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.meta.interval !== timeframe) {
    throw createError({
      statusCode: 422,
      statusMessage: `Bougies Twelve Data ${timeframe} indisponibles ou invalides (abonnement, quota ou profondeur historique). Aucun prix inventé.`,
    });
  }

  const candles = parsed.data.values.map(candle => ({
    time: Date.parse(`${candle.datetime.replace(" ", "T")}Z`),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  })).sort((a, b) => a.time - b.time);
  if (!candles.every((candle, index) =>
    Number.isFinite(candle.time)
    && candle.time <= Date.now()
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close)
    && (!index || candle.time > candles[index - 1].time))) {
    throw createError({ statusCode: 502, statusMessage: `Historique ${timeframe} incohérent. Simulation bloquée.` });
  }
  return candles;
}

export async function getPaperMarketFeed(apiKey: string): Promise<PaperFeed> {
  if (cache && cache.expires > Date.now()) return cache.data;
  if (pending) return pending;
  if (retryAfter > Date.now()) {
    throw createError({ statusCode: 429, statusMessage: "Historique paper indisponible récemment. Attendez une minute avant de réessayer." });
  }

  pending = Promise.all([load("1h", apiKey), load("4h", apiKey)])
    .then(([hour, fourHours]) => {
      const data: PaperFeed = { source: "TWELVE_DATA", fetchedAt: Date.now(), series: { "1h": hour, "4h": fourHours } };
      cache = { data, expires: Date.now() + 300000 };
      return data;
    })
    .catch(error => {
      retryAfter = Date.now() + 60000;
      throw error;
    })
    .finally(() => { pending = null; });
  return pending;
}

export function getTwelveDataApiKey(runtimeKey = ""): string {
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim() || runtimeKey.trim();
  if (!apiKey) {
    throw createError({ statusCode: 503, statusMessage: "Twelve Data n’est pas configuré. Aucun signal ni trade paper ne peut être généré." });
  }
  return apiKey;
}
