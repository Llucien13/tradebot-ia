import { scalpingIndicators, scalpingSignal, scalpingWarmup } from "./signals";
import { calculateStatistics } from "@/lib/backtest/statistics";
import { INTERVAL_MS, type BacktestSettings, type EquityPoint } from "@/lib/backtest/types";
import { type ScalpingConfig, type ScalpingTrade, type ScalpingResult, type ScalpingDay, type ScalpingBurst } from "./model";
import { validateMT5ScalpingHistory, mt5PeriodGaps, type ScalpingHistory } from "./history";
import { burstSizing, safeScalpingConfig, executionLevels, executionExitQuote, SCALPING_ENGINE_VERSION } from "./safety";
import { checkScalpingInvariants } from "./invariants";

interface Signal { direction: "BUY" | "SELL"; confidence: number; conditions: string[]; time: number; atr: number; close: number }
interface Position {
  burstId: number; entryTime: number; entry: number; sign: number; sl: number; tp: number;
  quantity: number; riskMoney: number; signal: Signal;
}
const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);
export function runScalpingBacktest(input: ScalpingConfig, settings: BacktestSettings, history: ScalpingHistory, progress: (n: number) => void = () => {}): ScalpingResult {
  const checks = checkScalpingInvariants();
  if (checks.length) throw new Error(`Contrôles internes Scalping échoués : ${checks.join(", ")}`);
  const config = safeScalpingConfig(input);
  if (history.source !== "TWELVE_DATA" && history.source !== "MT5") throw new Error("Le scalping accepte uniquement les historiques réels Twelve Data ou MT5.");
  if (history.source === "MT5") history = validateMT5ScalpingHistory(history, config, settings);
  if (settings.timeframe !== config.timeframe) throw new Error("Le timeframe doit correspondre au module scalping enregistré.");
  if (![settings.start, settings.end, settings.initialCapital, settings.spread, settings.slippage, settings.commission].every(Number.isFinite) || settings.start >= settings.end || settings.initialCapital <= 0 || settings.spread < 0 || settings.slippage < 0 || settings.commission < 0) throw new Error("Paramètres de simulation invalides.");
  const step = INTERVAL_MS[config.timeframe], candles = history.candles;
  if (!candles.every((c, i) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) && c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && (!i || c.time > candles[i - 1].time))) throw new Error("Historique scalping incohérent.");
  const first = candles.findIndex(c => c.time >= settings.start);
  let last = candles.length - 1;
  while (last >= 0 && (candles[last].time < settings.start || candles[last].time + step > settings.end)) last--;
  if (first < scalpingWarmup(config.setup) || last <= first) throw new Error("Historique insuffisant ou indicateurs scalping non préchauffés.");
  const strategy = { ...config.signal, name: "Mode Scalping", enabled: config.enabled, timeframes: [config.timeframe], riskPercent: config.burstRiskPercent };
  const rows = scalpingIndicators(candles, config.setup);
  progress(10);
  const trades: ScalpingTrade[] = [], bursts: ScalpingBurst[] = [], days: ScalpingDay[] = [];
  const equity: EquityPoint[] = [{ time: settings.start, equity: settings.initialCapital, drawdown: 0 }];
  let capital = settings.initialCapital, peak = capital, previousEquity = capital;
  let positions: Position[] = [], pending: Signal | null = null;
  let lastBurst = -Infinity, currentDay: ScalpingDay | null = null;
  let buySignals = 0, sellSignals = 0, waits = 0, skippedEntries = 0, ambiguousBars = 0;
  const bidPrices = history.source === "MT5";
  // Preserve OHLC; derive simulated execution quotes with the configured spread.
  const exitQuote = (reference: number, sign: number) => executionExitQuote(reference, sign, settings.spread, bidPrices);
  const liquidationQuote = (reference: number, sign: number) => exitQuote(reference, sign) - sign * settings.slippage;
  const floating = (p: Position, reference: number) => {
    const liquidation = liquidationQuote(reference, p.sign);
    return p.sign * (liquidation - p.entry) * p.quantity - p.quantity * settings.commission;
  };
  const markedEquity = (reference: number) => capital + positions.reduce((sum, p) => sum + floating(p, reference), 0);
  const checkDay = (value: number, time: number, lossOnly = false) => {
    const day = currentDay!;
    if (!lossOnly) day.pnl = value - day.baseline;
    if (day.blockedAt !== null) return;
    const pnl = value - day.baseline;
    const lossReached = pnl <= -Math.min(config.dailyLoss, Math.max(0, day.baseline) * 0.03) + 1e-8;
    if (lossReached || (!lossOnly && pnl >= config.dailyGain - 1e-8)) {
      day.blockedAt = time; day.reason = lossReached ? "Perte quotidienne" : "Gain quotidien";
      day.conservative = lossOnly;
    }
  };
  const close = (p: Position, price: number, time: number, reason: ScalpingTrade["exitReason"]) => {
    const gross = p.sign * (price - p.entry) * p.quantity;
    const commission = 2 * p.quantity * settings.commission, pnl = gross - commission;
    capital += gross - p.quantity * settings.commission;
    trades.push({ id: trades.length + 1, burstId: p.burstId, entryTime: p.entryTime, exitTime: time,
      direction: p.signal.direction, entry: p.entry, exit: price, initialSL: p.sl, initialTP: p.tp,
      stopChanges: [], exitReason: reason, quantity: p.quantity, riskMoney: p.riskMoney,
      spread: settings.spread, slippage: settings.slippage, commission, pnl, r: pnl / p.riskMoney,
      durationMinutes: (time - p.entryTime) / 60000, confidence: p.signal.confidence,
      conditions: p.signal.conditions, signalTime: p.signal.time });
    positions = positions.filter(open => open !== p);
  };
  for (let i = first; i <= last; i++) {
    const candle = candles[i], closeTime = candle.time + step;
    const dayName = dayOf(candle.time);
    if (currentDay?.day !== dayName) {
      currentDay = { day: dayName, baseline: previousEquity, pnl: 0, bursts: 0, blockedAt: null, reason: null, conservative: false };
      days.push(currentDay);
    }
    const day = currentDay;
    // Resolve gaps before daily valuation: a TP gap fills at TP, not a fictitious opening gain.
    for (const p of [...positions]) {
      const quote = exitQuote(candle.open, p.sign);
      if (p.sign * (quote - p.sl) <= 0) close(p, quote - p.sign * settings.slippage, candle.time, "Stop Loss");
      else if (p.sign * (quote - p.tp) >= 0) close(p, p.tp - p.sign * settings.slippage, candle.time, "Take Profit");
    }
    checkDay(markedEquity(candle.open), candle.time);
    const signal = pending; pending = null;
    if (signal && config.enabled) {
      if (positions.length > 0 || candle.time !== signal.time || day.blockedAt !== null || day.bursts >= config.maxBurstsPerDay || candle.time - lastBurst < config.delayMinutes * 60000 || capital <= 0
        || Math.abs(candle.open - signal.close) > 0.5 * signal.atr
        || settings.spread + 2 * settings.slippage + 2 * settings.commission > 0.5 * config.stopDistance) skippedEntries++;
      else {
        const available = Math.max(0, Math.min(capital, markedEquity(candle.open)));
        const remainingDailyLoss = Math.max(0, Math.min(config.dailyLoss, day.baseline * 0.03) + markedEquity(candle.open) - day.baseline);
        const { budget, count, unitRisk, quantity } = burstSizing(available, remainingDailyLoss, config, settings.slippage, settings.commission);
        const sign = signal.direction === "BUY" ? 1 : -1;
        const target = Math.max(config.individualProfit, unitRisk * config.setup.rewardRisk);
        const { entry, sl, tp } = executionLevels(candle.open, sign, bidPrices, settings.spread, settings.slippage, settings.commission, config.stopDistance, quantity, target);
        const openingQuote = exitQuote(candle.open, sign);
        const fees = count * quantity * settings.commission;
        if (unitRisk <= 0 || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(tp) || entry <= 0 || sl <= 0 || tp <= 0 || sign * (openingQuote - sl) <= 0 || fees >= available) skippedEntries++;
        else {
          const id = bursts.length + 1;
          // Each object is distinct, despite identical execution prices within the burst.
          for (let n = 0; n < count; n++) positions.push({ burstId: id, entryTime: candle.time, entry, sign, sl, tp, quantity, riskMoney: unitRisk, signal });
          capital -= fees; day.bursts++; lastBurst = candle.time;
          bursts.push({ id, time: candle.time, signalTime: signal.time, direction: signal.direction, positions: count, budget, committedRisk: count * unitRisk });
          checkDay(markedEquity(candle.open), candle.time);
        }
      }
    }
    // OHLC cannot order opposite-direction extrema. A bounded, adverse portfolio valuation
    // is deliberately conservative and only latches the daily loss, never authorizes entries.
    const adverseEquity = capital + positions.reduce((sum, p) => {
      const reference = p.sign === 1 ? candle.low : candle.high;
      const quote = exitQuote(reference, p.sign);
      const boundedQuote = p.sign === 1 ? Math.max(quote, p.sl) : Math.min(quote, p.sl);
      return sum + p.sign * (boundedQuote - p.sign * settings.slippage - p.entry) * p.quantity - p.quantity * settings.commission;
    }, 0);
    checkDay(adverseEquity, closeTime - 1, true);
    equity.push({ time: closeTime - 1, equity: adverseEquity, drawdown: peak > 0 ? 100 * Math.max(0, peak - adverseEquity) / peak : 0 });
    for (const p of [...positions]) {
      const low = exitQuote(candle.low, p.sign), high = exitQuote(candle.high, p.sign);
      const stopTouched = p.sign === 1 ? low <= p.sl : high >= p.sl;
      const tpTouched = p.sign === 1 ? high >= p.tp : low <= p.tp;
      if (stopTouched && tpTouched) ambiguousBars++;
      if (stopTouched) close(p, p.sl - p.sign * settings.slippage, closeTime - 1, "Stop Loss");
      else if (tpTouched) close(p, p.tp - p.sign * settings.slippage, closeTime - 1, "Take Profit");
      else if (i === last) close(p, liquidationQuote(candle.close, p.sign), closeTime - 1, "Fin de période");
    }
    const value = markedEquity(candle.close);
    if (!Number.isFinite(value)) throw new Error("Résultat numérique scalping invalide.");
    checkDay(value, closeTime - 1);
    previousEquity = value; peak = Math.max(peak, value);
    equity.push({ time: closeTime, equity: value, drawdown: peak > 0 ? 100 * (peak - value) / peak : 0 });
    // After a gap, require a fresh uninterrupted warmup; never interpolate or reuse stale EMA seeds.
    const continuous = i >= scalpingWarmup(config.setup) && candles[i].time - candles[i - scalpingWarmup(config.setup)].time === scalpingWarmup(config.setup) * step;
    if (config.enabled && continuous && day.blockedAt === null && day.bursts < config.maxBurstsPerDay && i < last) {
      const candidate = scalpingSignal(rows[i], config.setup);
      if (candidate && rows[i].atr !== null) {
        if (candidate.direction === "BUY") buySignals++; else sellSignals++;
        pending = { ...candidate, confidence: 100, time: closeTime, atr: rows[i].atr!, close: candle.close };
      } else waits++;
    } else waits++;
    if ((i - first) % 25 === 0) progress(10 + Math.floor(89 * (i - first) / (last - first + 1)));
  }
  progress(100);
  const { candles: _candles, ...metadata } = history;
  return { strategy, settings, trades, equity, stats: calculateStatistics(settings.initialCapital, capital, trades, equity),
    controls: { candles: last - first + 1, warmup: first, first: candles[first].time, last: candles[last].time, buySignals, sellSignals, waits, executed: trades.length, ambiguousBars, skippedEntries },
    ...(history.source === "MT5" ? { dataGaps: mt5PeriodGaps(history) } : {}),
    engineVersion: SCALPING_ENGINE_VERSION, validation: "Non validé",
    history: metadata, scalping: config, bursts, days };
}
