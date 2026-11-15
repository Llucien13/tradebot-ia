import type { BacktestSettings, HistoricalData } from "@/lib/backtest/types";
import { scalpingWarmup } from "./signals";
import { mt5HistorySchema, type MT5History } from "@/lib/mt5-data";
import type { Candle } from "@/types";
import type { ScalpingConfig } from "./model";

export type ScalpingMT5History = Required<Omit<MT5History, "candles" | "coverage">> & { candles: Candle[]; coverage: Required<MT5History["coverage"]> };
export type ScalpingHistory = HistoricalData | ScalpingMT5History;
export type ScalpingHistoryMetadata = Omit<HistoricalData, "candles"> | Omit<ScalpingMT5History, "candles">;
export interface ScalpingDataGap { from: number; to: number; minutes: number }

export function mt5PeriodGaps(history: ScalpingMT5History): ScalpingDataGap[] {
  const start = Date.parse(history.coverage.requestedStart), end = Date.parse(history.coverage.requestedEnd);
  const gaps: ScalpingDataGap[] = [];
  let next = start;
  for (const candle of history.candles) {
    if (candle.time < start) continue;
    if (candle.time > next) gaps.push({ from: next, to: candle.time, minutes: (candle.time - next) / 60000 });
    next = candle.time + 60000;
  }
  if (next < end) gaps.push({ from: next, to: end, minutes: (end - next) / 60000 });
  return gaps;
}

export function validateMT5ScalpingHistory(input: unknown, config: ScalpingConfig, settings: BacktestSettings): ScalpingMT5History {
  const parsed = mt5HistorySchema.safeParse(input);
  if (!parsed.success) throw new Error("Données MT5 absentes ou invalides. Chargez les bougies avec le connecteur existant ; aucun repli Twelve Data.");
  const history = parsed.data as ScalpingMT5History;
  if (history.symbol !== "XAUUSD-ECN") throw new Error("Le backtest MT5 exige le symbole XAUUSD-ECN. Chargez ce symbole dans le panneau MT5.");
  if (history.interval !== "1m" || history.apiTimeframe !== "TIMEFRAME_M1" || config.timeframe !== "1m" || settings.timeframe !== "1m") throw new Error("La source MT5 est disponible uniquement pour le backtest Scalping M1. Rechargez un lot M1 ; aucun timeframe enregistré n’est modifié automatiquement.");
  if (history.priceBasis !== "BID") throw new Error("La base de prix MT5 n’est pas BID. Ce raccordement refuse une base LAST plutôt que de simuler un spread incorrect.");
  const start = Date.parse(history.coverage.requestedStart), end = Date.parse(history.coverage.requestedEnd);
  if (start !== settings.start || end !== settings.end || start >= end || end > Date.now() || start % 60000 || end % 60000) throw new Error("Les dates du test ne correspondent pas à la plage M1 passée réellement chargée dans MT5.");
  const candles = history.candles;
  if (!candles.every((c, i) => c.time % 60000 === 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.high >= c.low && c.time + 60000 <= end && (!i || c.time > candles[i - 1].time))) throw new Error("OHLC MT5 incohérents, désordonnés ou hors période. Aucun tri, correction ou interpolation n’est effectué.");
  const first = candles.findIndex(c => c.time >= start);
  const required = scalpingWarmup(config.setup);
  if (first < required || first !== history.coverage.warmupCount || candles.length - first < 2) throw new Error(`Historique MT5 insuffisant : au moins ${required} bougies réelles de préchauffage et deux bougies clôturées de période sont requises. Rechargez les données sans modifier les indicateurs.`);
  const tested = candles.length - first;
  if (tested !== history.coverage.testedCount || candles[first].time !== Date.parse(history.coverage.first) || candles[candles.length - 1].time !== Date.parse(history.coverage.last) || history.coverage.expectedMinutes !== (end - start) / 60000 || history.coverage.missingMinutes !== (end - start) / 60000 - tested) throw new Error("La couverture MT5 ne correspond pas aux bougies chargées. Rechargez l’historique ; aucune autre source ne sera utilisée.");
  return history;
}
