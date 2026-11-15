import type { Candle } from "@/types";
import { mt5HistorySchema } from "@/lib/mt5-data";
import type { BacktestSettings, EquityPoint } from "@/lib/backtest/types";
import { calculateStatistics } from "@/lib/backtest/statistics";
import type { ScalpingTrade, ScalpingBurst } from "./model";
import type { ScalpingMT5History } from "./history";
import { m5SessionIndicators } from "./m5-session-indicators";
import { classifyM5Gap } from "./m5-sessions";
import { NY_CALENDAR, validateM5Calendar, calendarPolicy, type M5Calendar } from "./m5-calendar";
import { validateM5History } from "./m5-engine";
import { m5Schema, m5Setup, m5ScalpingConfig, type M5Config, type M5Result } from "./m5-model";
import { validateM5V2Coverage } from "./m5-v2-validation";

const STEP = 300000, WARMUP = 202;
// Only complete, UTC-aligned triples become M15 bars; missing M5 bars are never filled.
function aggregateM15(candles: Candle[]) {
  const result: Candle[] = [];
  for (let i = 0; i + 2 < candles.length; i++) {
    const a = candles[i], b = candles[i + 1], c = candles[i + 2];
    if (a.time % 900000 || b.time !== a.time + STEP || c.time !== b.time + STEP) continue;
    result.push({ time: a.time, open: a.open, high: Math.max(a.high, b.high, c.high), low: Math.min(a.low, b.low, c.low), close: c.close, volume: a.volume + b.volume + c.volume });
  }
  return result;
}
export function runM5SessionBacktest(input: M5Config, settings: BacktestSettings, data: unknown, progress: (n: number) => void, selectedCalendar: M5Calendar = NY_CALENDAR): M5Result {
  const config = m5Schema.parse(input), history = validateM5History(data);
  if (!config.enabled) throw new Error("Activez et enregistrez le profil M5 avant un test manuel.");
  if (settings.timeframe !== "5m" || settings.start !== Date.parse(history.coverage.requestedStart) || settings.end !== Date.parse(history.coverage.requestedEnd)
    || ![settings.initialCapital, settings.spread, settings.slippage, settings.commission].every(Number.isFinite) || settings.initialCapital <= 0 || Math.min(settings.spread, settings.slippage, settings.commission) < 0) throw new Error("Paramètres de simulation M5 invalides.");
  const calendar = validateM5Calendar(selectedCalendar, history.symbol);
  validateM5V2Coverage(history, calendar);
  const candles = history.candles;
  const { rows, segmentStarts } = m5SessionIndicators(candles, m5Setup, STEP, calendar);
  let normalClosures = 0, anomalies = 0, discardedPending = 0;
  const higher = config.trendM15 ? aggregateM15(candles) : [];
  const { rows: higherRows } = m5SessionIndicators(higher, m5Setup, 900000, calendar);
  let higherIndex = -1, segmentStart = 0;
  let resistance: number | null = null, support: number | null = null;
  let capital = settings.initialCapital, peak = capital, lossStreak = 0, pauseUntil = -Infinity;
  const trades: ScalpingTrade[] = [], bursts: ScalpingBurst[] = [];
  const equity: EquityPoint[] = [{ time: settings.start, equity: capital, drawdown: 0 }];
  let position: { sign: number; entry: number; sl: number; tp: number; quantity: number; risk: number; time: number; signalTime: number; conditions: string[] } | null = null;
  let pending: { sign: number; atr: number; time: number; conditions: string[] } | null = null;
  let buySignals = 0, sellSignals = 0, waits = 0, skippedEntries = 0, ambiguousBars = 0;
  const first = candles.findIndex(c => c.time >= settings.start);
  if (first - segmentStarts[first] < WARMUP) throw new Error("Préchauffage M5 insuffisant au début de la période testée : 202 bougies de préchauffage requises dans le segment de la première bougie testée.");
  const quote = (bid: number, sign: number) => bid + (sign === -1 ? settings.spread : 0);
  const inSession = (time: number) => {
    const hour = new Date(time).getUTCHours();
    return config.sessionStart === config.sessionEnd || (config.sessionStart < config.sessionEnd ? hour >= config.sessionStart && hour < config.sessionEnd : hour >= config.sessionStart || hour < config.sessionEnd);
  };
  const close = (price: number, time: number, reason: ScalpingTrade["exitReason"]) => {
    const p = position!;
    const pnl = p.sign * (price - p.entry) * p.quantity - 2 * p.quantity * settings.commission;
    capital += p.sign * (price - p.entry) * p.quantity - p.quantity * settings.commission;
    trades.push({ id: trades.length + 1, burstId: bursts.length, entryTime: p.time, exitTime: time, direction: p.sign === 1 ? "BUY" : "SELL", entry: p.entry, exit: price,
      initialSL: p.sl, initialTP: p.tp, stopChanges: [], exitReason: reason, quantity: p.quantity, riskMoney: p.risk,
      spread: settings.spread, slippage: settings.slippage, commission: 2 * p.quantity * settings.commission,
      pnl, r: pnl / p.risk, durationMinutes: (time - p.time) / 60000, confidence: 100, conditions: p.conditions, signalTime: p.signalTime });
    lossStreak = pnl < 0 ? lossStreak + 1 : 0;
    if (config.lossPause && lossStreak >= 3) { pauseUntil = time + config.pauseMinutes * 60000; lossStreak = 0; }
    position = null;
  };
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], time = c.time + STEP, row = rows[i];
    if (i && c.time !== candles[i - 1].time + STEP) {
      const kind = classifyM5Gap(candles[i - 1].time, c.time, STEP, calendar);
      if (kind === "scheduled-close") normalClosures++; else anomalies++;
      // Pivots never straddle an interruption. Pending entries expire at their exact next open.
      segmentStart = i; resistance = null; support = null;
      if (pending) { pending = null; skippedEntries++; discardedPending++; }
    }
    const previous = i > segmentStart ? candles[i - 1] : null;
    const buyBreakout = resistance !== null && previous !== null && previous.close <= resistance && c.close > resistance;
    const sellBreakout = support !== null && previous !== null && previous.close >= support && c.close < support;
    // Pivots become known only after two closed candles on their right.
    if (i - segmentStart >= 4) {
      const pivot = candles[i - 2], neighbors = [candles[i - 4], candles[i - 3], candles[i - 1], c];
      if (neighbors.every(n => pivot.high > n.high)) resistance = pivot.high;
      if (neighbors.every(n => pivot.low < n.low)) support = pivot.low;
    }
    while (higherIndex + 1 < higher.length && higher[higherIndex + 1].time + 900000 <= time) higherIndex++;
    if (i < first) continue;
    if (position) {
      const p = position, openQuote = quote(c.open, p.sign);
      if (p.sign * (openQuote - p.sl) <= 0) close(openQuote - p.sign * settings.slippage, c.time, "Stop Loss");
      else if (p.sign * (openQuote - p.tp) >= 0) close(p.tp - p.sign * settings.slippage, c.time, "Take Profit");
    }
    const signal = pending; pending = null;
    if (signal) {
      if (position || signal.time !== c.time || c.time < pauseUntil || capital <= 0 || (config.spreadFilter && settings.spread > config.maxSpread) || (config.sessionFilter && !inSession(c.time))) skippedEntries++;
      else {
        const distance = 1.5 * signal.atr, risk = capital * config.riskPercent / 100;
        const quantity = risk / (distance + settings.slippage + 2 * settings.commission);
        const entry = c.open + (signal.sign === 1 ? settings.spread : 0) + signal.sign * settings.slippage;
        const sl = entry - signal.sign * distance, tp = entry + signal.sign * 3 * distance;
        if (quantity <= 0 || !Number.isFinite(quantity) || Math.min(sl, tp) <= 0 || signal.sign * (quote(c.open, signal.sign) - sl) <= 0 || quantity * settings.commission >= capital) skippedEntries++;
        else {
          position = { sign: signal.sign, entry, sl, tp, quantity, risk, time: c.time, signalTime: signal.time, conditions: signal.conditions };
          capital -= quantity * settings.commission;
          bursts.push({ id: bursts.length + 1, time: c.time, signalTime: signal.time, direction: signal.sign === 1 ? "BUY" : "SELL", positions: 1, budget: risk, committedRisk: risk });
        }
      }
    }
    if (position) {
      const p = position, low = quote(c.low, p.sign), high = quote(c.high, p.sign);
      const stop = p.sign === 1 ? low <= p.sl : high >= p.sl;
      const target = p.sign === 1 ? high >= p.tp : low <= p.tp;
      if (stop && target) ambiguousBars++;
      if (stop) close(p.sl - p.sign * settings.slippage, time - 1, "Stop Loss");
      else if (target) close(p.tp - p.sign * settings.slippage, time - 1, "Take Profit");
      else if (i === candles.length - 1) close(quote(c.close, p.sign) - p.sign * settings.slippage, time - 1, "Fin de période");
    }
    const value = capital + (position ? position.sign * (quote(c.close, position.sign) - position.sign * settings.slippage - position.entry) * position.quantity - position.quantity * settings.commission : 0);
    if (!Number.isFinite(value)) throw new Error("Résultat M5 non fini.");
    peak = Math.max(peak, value);
    equity.push({ time, equity: value, drawdown: 100 * Math.max(0, peak - value) / peak });
    let sign = 0;
    if (i - segmentStarts[i] >= WARMUP && row.middle !== null && row.slow !== null && row.atr !== null && row.atr > 0) {
      if (row.middle > row.slow && buyBreakout) sign = 1;
      if (row.middle < row.slow && sellBreakout) sign = -1;
    }
    const conditions = ["EMA 20/50 M5", "Cassure de pivot confirmé à la clôture", "SL 1,5 ATR / TP 3R"];
    if (sign && config.trendM15) {
      const h = higherRows[higherIndex];
      if (!h || higher[higherIndex].time + 900000 !== time - time % 900000 || h.middle === null || h.slow === null || sign * (h.middle - h.slow) <= 0) sign = 0;
      else conditions.push("Tendance EMA 20/50 M15 clôturée");
    }
    if (sign && config.volatility) {
      const values = rows.slice(Math.max(segmentStarts[i], i - 50), i).map(r => r.atr).filter((v): v is number => v !== null);
      const average = values.reduce((sum, v) => sum + v, 0) / values.length;
      if (values.length < 50 || row.atr! < average * config.atrMinRatio || row.atr! > average * config.atrMaxRatio) sign = 0;
      else conditions.push("ATR dans la plage relative autorisée");
    }
    if (sign && config.emaDistanceFilter) {
      if (row.middle === null || row.atr === null || row.atr <= 0
        || Math.abs(c.close - row.middle) > config.emaDistanceThreshold * row.atr) sign = 0;
      else conditions.push(`Distance EMA20 ≤ ${config.emaDistanceThreshold} × ATR14`);
    }
    if (sign && i < candles.length - 1) {
      if (sign === 1) buySignals++; else sellSignals++;
      pending = { sign, atr: row.atr!, time, conditions };
    } else waits++;
    if (i % 50 === 0) progress(Math.round(100 * i / candles.length));
  }
  const { candles: omitted, ...metadata } = history;
  const scalping = m5ScalpingConfig(config);
  progress(100);
  return { strategy: scalping.signal, settings, history: metadata, scalping, trades, bursts, days: [], equity,
    stats: calculateStatistics(settings.initialCapital, capital, trades, equity), engineVersion: "m5-session-continuity-2", gapAudit: { policy: calendarPolicy(calendar), normalClosures, anomalies, discardedPending, pivots: "Réinitialisés à chaque interruption ; 5 bougies clôturées pour reconfirmer", pending: "Annulés à chaque interruption ; aucune entrée différée à la réouverture" }, validation: "Non validé",
    controls: { candles: candles.length - first, warmup: first, first: candles[first].time, last: candles.at(-1)!.time, buySignals, sellSignals, waits, executed: trades.length, ambiguousBars, skippedEntries } };
}
