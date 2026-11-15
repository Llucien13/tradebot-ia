import { defineHandler } from "nitro";
import { useRuntimeConfig } from "nitro/runtime-config";
import { getQuery, createError, setResponseHeader } from "nitro/h3";
import { z } from "zod";
import type { HistoricalData, BacktestTimeframe } from "../../../src/lib/backtest/types";

const intervals: Record<BacktestTimeframe, number> = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000 };
const querySchema = z.object({
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h"]),
  start: z.coerce.number().int().positive(), end: z.coerce.number().int().positive(),
  warmup: z.coerce.number().int().min(202).max(1002),
});
const seriesSchema = z.object({
  meta: z.object({ symbol: z.literal("XAU/USD"), interval: z.enum(["1m", "5m", "15m", "1h", "4h"]) }),
  values: z.array(z.object({ datetime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/), open: z.coerce.number().finite().positive(), high: z.coerce.number().finite().positive(), low: z.coerce.number().finite().positive(), close: z.coerce.number().finite().positive(), volume: z.coerce.number().finite().nonnegative().nullish() })).min(1).max(5000),
});
const cache = new Map<string, { data: HistoricalData; expires: number }>();
const pending = new Map<string, Promise<HistoricalData>>();
let lastRequestAt = 0;
let blockedUntil = 0;

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Paramètres historiques invalides." });
  const q = parsed.data;
  const step = intervals[q.timeframe];
  if (q.start >= q.end || q.end > Date.now() || q.start < Date.UTC(1970, 0, 2)) throw createError({ statusCode: 400, statusMessage: "La période doit être passée et sa fin postérieure au début (UTC)." });
  if (Math.ceil((q.end - q.start) / step) + q.warmup > 5000) throw createError({ statusCode: 422, statusMessage: "Période trop longue : limite volontaire de 5 000 bougies, préchauffage inclus, en une seule requête Twelve Data. Réduisez la période ou augmentez le timeframe. Aucune pagination coûteuse n’est lancée." });
  const key = `${q.timeframe}:${q.start}:${q.end}:${q.warmup}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return { ...cached.data, cached: true };
  if (pending.has(key)) return pending.get(key);
  if (Date.now() < blockedUntil || Date.now() - lastRequestAt < 10000 || pending.size > 0) throw createError({ statusCode: 429, statusMessage: "Protection du quota Twelve Data : attendez au moins 10 secondes entre deux historiques différents, ou la fin de la limitation fournisseur." });
  const config = useRuntimeConfig();
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim() || (typeof config.twelveDataApiKey === "string" ? config.twelveDataApiKey.trim() : "");
  if (!apiKey) throw createError({ statusCode: 503, statusMessage: "Twelve Data non configuré : aucun historique réel disponible. Aucun résultat de backtest ne sera inventé." });
  lastRequestAt = Date.now();
  const request = (async (): Promise<HistoricalData> => {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.search = new URLSearchParams({ symbol: "XAU/USD", interval: q.timeframe, outputsize: "5000", end_date: new Date(q.end - step).toISOString().slice(0, 19).replace("T", " "), timezone: "UTC", order: "ASC", format: "JSON" }).toString();
    let response: Response;
    try { response = await fetch(url, { headers: { Authorization: `apikey ${apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) }); }
    catch { throw createError({ statusCode: 503, statusMessage: "Historique Twelve Data inaccessible ou délai dépassé. Réessayez plus tard ; aucun mode DEMO pour le backtest." }); }
    if (response.status === 429) { blockedUntil = Date.now() + 60000; throw createError({ statusCode: 429, statusMessage: "Quota Twelve Data atteint. Attendez au moins une minute ; si le quota journalier est épuisé, attendez son renouvellement." }); }
    if (!response.ok) throw createError({ statusCode: 502, statusMessage: "Twelve Data refuse cet historique : vérifiez les droits XAU/USD, le timeframe et la profondeur historique autorisée par votre offre." });
    let body: unknown;
    try { body = await response.json(); } catch { throw createError({ statusCode: 502, statusMessage: "Réponse historique Twelve Data illisible." }); }
    const upstream = z.object({ status: z.literal("error"), code: z.number().optional() }).safeParse(body);
    if (upstream.success) {
      if (upstream.data.code === 429) blockedUntil = Date.now() + 60000;
      throw createError({ statusCode: upstream.data.code === 429 ? 429 : 422, statusMessage: upstream.data.code === 429 ? "Quota Twelve Data épuisé. Aucun historique récupéré." : "Historique indisponible chez Twelve Data : période, timeframe ou profondeur historique non accessibles avec l’offre actuelle. Réduisez la période ou vérifiez votre abonnement. Aucun résultat généré." });
    }
    const data = seriesSchema.safeParse(body);
    if (!data.success || data.data.meta.interval !== q.timeframe) throw createError({ statusCode: 502, statusMessage: "Historique XAU/USD invalide ou timeframe inattendu. Backtest refusé." });
    const candles = data.data.values.map(c => ({ time: Date.parse(`${c.datetime.replace(" ", "T")}Z`), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 })).sort((a, b) => a.time - b.time).filter(c => c.time + step <= q.end);
    if (!candles.length || !candles.every((c, i) => Number.isFinite(c.time) && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && (i === 0 || c.time > candles[i - 1].time))) throw createError({ statusCode: 502, statusMessage: "Bougies historiques incohérentes ou dupliquées. Backtest refusé." });
    const first = candles.findIndex(c => c.time >= q.start);
    if (first < q.warmup) throw createError({ statusCode: 422, statusMessage: "Historique incomplet : pas assez de bougies avant le début pour préchauffer les indicateurs. La limite de 5 000 bougies ou la profondeur de votre offre a été atteinte. Réduisez la période ou choisissez une date plus récente." });
    const tested = candles.filter(c => c.time >= q.start);
    if (tested.length < 2) throw createError({ statusCode: 422, statusMessage: "Moins de deux bougies clôturées dans cette période. Choisissez une période de marché ouverte plus longue." });
    // A boundary may fall on a weekend or the daily metals maintenance break.
    const closed = (time: number) => { const d = new Date(time); const day = d.getUTCDay(); const h = d.getUTCHours(); return day === 6 || (day === 0 && h < 22) || (day === 5 && h >= 21) || (h >= 21 && h < 23); };
    const missingOpenBars = (from: number, to: number) => {
      for (let t = from; t < to; t += step) if (!closed(t)) return true;
      return false;
    };
    if (missingOpenBars(q.start, tested[0].time) || missingOpenBars(tested[tested.length - 1].time + step, q.end - step + 1)) throw createError({ statusCode: 422, statusMessage: "Twelve Data ne couvre pas les bornes demandées sur les heures de marché ouvertes. Historique tronqué ou période non disponible avec cette offre. Choisissez une période couverte." });
    const relevant = candles.slice(first - q.warmup);
    for (let i = 1; i < relevant.length; i++) if (missingOpenBars(relevant[i - 1].time + step, relevant[i].time)) throw createError({ statusCode: 422, statusMessage: "Des bougies manquent pendant les heures de marché dans cet historique. Backtest refusé plutôt que de combler les trous. Vérifiez la période et les droits Twelve Data (jours fériés non modélisés)." });
    const result: HistoricalData = { source: "TWELVE_DATA", candles: relevant, fetchedAt: new Date().toISOString(), cached: false, warnings: ["OHLC Twelve Data uniquement : aucun tick ni spread historique. Spread, slippage et commission sont des hypothèses utilisateur.", "Contrôle de couverture conservateur : week-ends et pause quotidienne 21–23h UTC tolérés ; jours fériés non modélisés."] };
    for (const [k, value] of cache) if (value.expires < Date.now()) cache.delete(k);
    if (cache.size >= 12) cache.delete(cache.keys().next().value!);
    cache.set(key, { data: result, expires: Date.now() + 6 * 3600000 });
    return result;
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
});
