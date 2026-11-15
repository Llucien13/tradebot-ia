import { defineHandler } from "nitro";
import { useRuntimeConfig } from "nitro/runtime-config";
import { setResponseHeader } from "nitro/h3";
import { z } from "zod";
import type { MarketDataResponse } from "../../../src/types/market-data";

const candleSchema = z.object({
  datetime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  open: z.coerce.number().finite().positive(),
  high: z.coerce.number().finite().positive(),
  low: z.coerce.number().finite().positive(),
  close: z.coerce.number().finite().positive(),
  volume: z.coerce.number().finite().nonnegative().nullish(),
});
const seriesSchema = z.object({
  meta: z.object({ symbol: z.literal("XAU/USD"), interval: z.literal("1h") }),
  values: z.array(candleSchema).min(50).max(1000),
});

// Shared cache and in-flight request avoid spending a credit for every visitor.
let cache: { data: MarketDataResponse; expiresAt: number } | null = null;
let pending: Promise<MarketDataResponse> | null = null;

async function loadMarketData(apiKey: string): Promise<MarketDataResponse> {
  try {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.search = new URLSearchParams({ symbol: "XAU/USD", interval: "1h", outputsize: "1000", timezone: "UTC", format: "JSON" }).toString();
    const response = await fetch(url, {
      headers: { Authorization: `apikey ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    console.info("[MarketData] Twelve Data HTTP", { status: response.status, ok: response.ok });
    if (!response.ok) {
      return { status: "ERROR", message: response.status === 429 ? "Quota Twelve Data atteint. Données DEMO fictives utilisées." : "Twelve Data a refusé la requête. Vérifiez la clé et les droits XAU/USD. Données DEMO fictives utilisées." };
    }
    const body: unknown = await response.json();
    const parsed = seriesSchema.safeParse(body);
    if (!parsed.success) {
      // Never forward upstream messages, URLs, or credentials to the browser.
      return { status: "ERROR", message: "Données Twelve Data indisponibles ou invalides (clé, abonnement ou quota). Données DEMO fictives utilisées." };
    }
    const candles = parsed.data.values.map((value) => ({
      time: Date.parse(`${value.datetime.replace(" ", "T")}Z`),
      open: value.open, high: value.high, low: value.low, close: value.close,
      volume: value.volume ?? 0,
    })).sort((a, b) => a.time - b.time);
    const valid = candles.every((candle, index) => Number.isFinite(candle.time)
      && candle.high >= Math.max(candle.open, candle.close)
      && candle.low <= Math.min(candle.open, candle.close)
      && (index === 0 || candle.time > candles[index - 1].time));
    if (!valid) return { status: "ERROR", message: "Historique Twelve Data incohérent. Données DEMO fictives utilisées." };
    return { status: "LIVE", candles, fetchedAt: new Date().toISOString(), volumeAvailable: parsed.data.values.every((value) => value.volume != null) };
  } catch {
    return { status: "OFFLINE", message: "Connexion à Twelve Data impossible ou délai dépassé. Données DEMO fictives utilisées." };
  }
}

export default defineHandler(async (event): Promise<MarketDataResponse> => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const config = useRuntimeConfig();
  const environmentKey = process.env.TWELVE_DATA_API_KEY?.trim() ?? "";
  const apiKey = environmentKey || (typeof config.twelveDataApiKey === "string" ? config.twelveDataApiKey.trim() : "");
  console.info("[MarketData] Configuration", { environmentKeyDetected: Boolean(environmentKey), keyDetected: Boolean(apiKey) });
  if (!apiKey) return { status: "DEMO", message: "Twelve Data non configuré. Données DEMO fictives utilisées." };
  if (cache && Date.now() < cache.expiresAt) return cache.data;
  if (!pending) {
    pending = loadMarketData(apiKey).then((data) => {
      console.info("[MarketData] XAU/USD", { status: data.status, validSeries: data.status === "LIVE" });
      cache = { data, expiresAt: Date.now() + (data.status === "LIVE" ? 300000 : 60000) };
      return data;
    }).finally(() => { pending = null; });
  }
  return pending;
});
