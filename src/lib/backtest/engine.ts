import type { Candle } from "@/types";
import { describeCondition, strategySchema, type Strategy, type Condition } from "@/lib/strategies";
import { indicatorSeries, type IndicatorRow } from "./indicators";
import { calculateStatistics } from "./statistics";
import { INTERVAL_MS, warmupBars, type BacktestSettings, type HistoricalData, type BacktestResult, type BacktestTrade, type EquityPoint, type StopChange } from "./types";

interface Decision { direction: "BUY" | "SELL"; confidence: number; conditions: string[]; index: number }
interface Position {
  direction: "BUY" | "SELL"; sign: number; entryTime: number; entry: number; initialSL: number; sl: number; tp: number;
  distance: number; quantity: number; riskMoney: number; confidence: number; conditions: string[]; signalTime: number;
  changes: StopChange[]; reason: BacktestTrade["exitReason"]; bestClose: number;
}
function matches(rule: Condition, current: IndicatorRow, previous: IndicatorRow): boolean {
  const a = current[rule.left], b = rule.rightType === "value" ? rule.value : current[rule.rightField];
  if (a === null || b === null) return false;
  if (rule.operator === "gt") return a > b;
  if (rule.operator === "gte") return a >= b;
  if (rule.operator === "lt") return a < b;
  if (rule.operator === "lte") return a <= b;
  const prevA = previous[rule.left], prevB = rule.rightType === "value" ? rule.value : previous[rule.rightField];
  if (prevA === null || prevB === null) return false;
  return rule.operator === "crossAbove" ? prevA <= prevB && a > b : prevA >= prevB && a < b;
}
function sessionAllowed(time: number, strategy: Strategy) {
  const hour = new Date(time).getUTCHours();
  return strategy.sessions.some(s => s === "Asie" ? hour < 9 : s === "Londres" ? hour >= 7 && hour < 16 : hour >= 13 && hour < 22);
}
export function runBacktest(strategyInput: Strategy, settings: BacktestSettings, history: HistoricalData, progress: (percent: number) => void = () => {}): BacktestResult {
  const strategy = strategySchema.parse(strategyInput);
  if (history.source !== "TWELVE_DATA") throw new Error("Seul un historique réel Twelve Data est accepté.");
  if (!strategy.timeframes.includes(settings.timeframe)) throw new Error("Ce timeframe n’est pas autorisé par la stratégie enregistrée.");
  if (![settings.start, settings.end, settings.initialCapital, settings.spread, settings.slippage, settings.commission].every(Number.isFinite) || settings.start >= settings.end || settings.initialCapital <= 0 || settings.spread < 0 || settings.slippage < 0 || settings.commission < 0) throw new Error("Paramètres de simulation invalides.");
  const step = INTERVAL_MS[settings.timeframe];
  const candles = history.candles;
  if (!candles.every((c, i) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) && c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && (i === 0 || c.time > candles[i - 1].time))) throw new Error("Historique incohérent.");
  const first = candles.findIndex(c => c.time >= settings.start);
  let last = candles.length - 1;
  while (last >= 0 && (candles[last].time < settings.start || candles[last].time + step > settings.end)) last--;
  if (first < warmupBars(strategy) || last <= first) throw new Error("Historique insuffisant ou indicateurs non préchauffés.");
  progress(2);
  const rows = indicatorSeries(candles, strategy);
  progress(10);
  const trades: BacktestTrade[] = [];
  const equity: EquityPoint[] = [{ time: settings.start, equity: settings.initialCapital, drawdown: 0 }];
  let capital = settings.initialCapital, peak = capital;
  let positions: Position[] = [], pending: Decision | null = null;
  let lastExit = -Infinity, buySignals = 0, sellSignals = 0, waits = 0, ambiguousBars = 0, skippedEntries = 0;
  const close = (p: Position, price: number, time: number, reason: BacktestTrade["exitReason"]) => {
    const commission = 2 * p.quantity * settings.commission;
    const gross = (price - p.entry) * p.sign * p.quantity;
    const pnl = gross - commission;
    capital += gross - p.quantity * settings.commission;
    trades.push({ id: trades.length + 1, entryTime: p.entryTime, exitTime: time, direction: p.direction, entry: p.entry, exit: price, initialSL: p.initialSL, initialTP: p.tp, stopChanges: p.changes, exitReason: reason, quantity: p.quantity, riskMoney: p.riskMoney, spread: settings.spread, slippage: settings.slippage, commission, pnl, r: pnl / p.riskMoney, durationMinutes: (time - p.entryTime) / 60000, confidence: p.confidence, conditions: p.conditions, signalTime: p.signalTime });
    lastExit = Math.max(lastExit, time); positions = positions.filter(open => open !== p);
  };
  const canExecute = (time: number) => strategy.enabled && sessionAllowed(time, strategy) && (!strategy.spread.enabled || settings.spread <= strategy.spread.maxUSD) && time - lastExit >= strategy.cooldownMinutes * 60000 && capital > 0;
  for (let i = first; i <= last; i++) {
    const candle = candles[i], row = rows[i];
    // Only the preceding closed candle can submit an entry at this candle's open.
    if (pending && positions.length < strategy.maxConcurrentPositions) {
      const decision = pending;
      pending = null;
      if (canExecute(candle.time)) {
        const sign = decision.direction === "BUY" ? 1 : -1;
        const entry = candle.open + sign * (settings.spread / 2 + settings.slippage);
        const signalRow = rows[decision.index];
        let sl: number;
        if (strategy.stopLoss.mode === "fixed") sl = entry - sign * strategy.stopLoss.fixedDistance;
        else if (strategy.stopLoss.mode === "atr") sl = entry - sign * strategy.stopLoss.atrMultiplier * signalRow.atr!;
        else {
          const window = candles.slice(decision.index + 1 - strategy.stopLoss.structureLookback, decision.index + 1);
          sl = sign === 1 ? Math.min(...window.map(c => c.low)) - strategy.stopLoss.structureBuffer : Math.max(...window.map(c => c.high)) + strategy.stopLoss.structureBuffer;
        }
        const distance = sign * (entry - sl);
        const riskMoney = capital * strategy.riskPercent / 100;
        const quantity = riskMoney / (distance + settings.slippage + 2 * settings.commission);
        const tp = entry + sign * distance * strategy.takeProfitRR;
        const openingExitQuote = candle.open - sign * settings.spread / 2;
        if (entry <= 0 || sl <= 0 || tp <= 0 || distance <= 0 || sign * (openingExitQuote - sl) <= 0 || !Number.isFinite(quantity) || quantity <= 0) skippedEntries++;
        else {
          capital -= quantity * settings.commission;
          positions.push({ direction: decision.direction, sign, entryTime: candle.time, entry, initialSL: sl, sl, tp, distance, quantity, riskMoney, confidence: decision.confidence, conditions: decision.conditions, signalTime: candles[decision.index].time + step, changes: [], reason: "Stop Loss", bestClose: entry });
        }
      } else skippedEntries++;
    }
    const exits: { position: Position; price: number; time: number; reason: BacktestTrade["exitReason"] }[] = [];
    for (const p of positions) {
      const offset = -p.sign * settings.spread / 2;
      const open = candle.open + offset, high = candle.high + offset, low = candle.low + offset;
      const stopTouched = p.sign === 1 ? low <= p.sl : high >= p.sl;
      const tpTouched = p.sign === 1 ? high >= p.tp : low <= p.tp;
      if (stopTouched && tpTouched) ambiguousBars++;
      const stopGap = p.sign === 1 ? open <= p.sl : open >= p.sl;
      const tpGap = p.sign === 1 ? open >= p.tp : open <= p.tp;
      const exit = (price: number, time: number, reason: BacktestTrade["exitReason"]) => exits.push({ position: p, price, time, reason });
      // Gap exits occur at the open; otherwise SL wins when OHLC cannot resolve order.
      if (stopGap) exit(open - p.sign * settings.slippage, candle.time, p.reason);
      else if (tpGap) exit(p.tp - p.sign * settings.slippage, candle.time, "Take Profit");
      else if (stopTouched) exit(p.sl - p.sign * settings.slippage, candle.time + step, p.reason);
      else if (tpTouched) exit(p.tp - p.sign * settings.slippage, candle.time + step, "Take Profit");
      else if (i === last) exit(candle.close + offset - p.sign * settings.slippage, candle.time + step, "Fin de période");
      else {
        // Changes use this closed candle only and become effective on the next candle.
        const closePrice = candle.close + offset;
        p.bestClose = p.sign === 1 ? Math.max(p.bestClose, closePrice) : Math.min(p.bestClose, closePrice);
        const change = (newSL: number, reason: StopChange["reason"]) => {
          if (p.sign * (newSL - p.sl) > 1e-9) {
            p.changes.push({ time: candle.time + step, oldSL: p.sl, newSL, reason }); p.sl = newSL; p.reason = reason;
          }
        };
        if (strategy.breakEven.enabled && p.sign * (closePrice - p.entry) >= p.distance * strategy.breakEven.thresholdR) change(p.entry, "Break-even");
        if (strategy.trailing.enabled && row.atr !== null) {
          const candidate = p.bestClose - p.sign * strategy.trailing.distanceATR * row.atr;
          change(p.sign === 1 ? Math.min(candidate, closePrice - 1e-6) : Math.max(candidate, closePrice + 1e-6), "Trailing ATR");
        }
      }
    }
    // Preserve chronological close order when gaps and intrabar exits share a candle.
    for (const exit of exits.sort((a, b) => a.time - b.time)) close(exit.position, exit.price, exit.time, exit.reason);
    const closeTime = candle.time + step;
    let signal: Decision | null = null;
    if (canExecute(closeTime)) {
      const buy = strategy.buy.filter(rule => matches(rule, row, rows[i - 1]));
      const sell = strategy.sell.filter(rule => matches(rule, row, rows[i - 1]));
      const buyConfidence = 100 * buy.length / strategy.buy.length, sellConfidence = 100 * sell.length / strategy.sell.length;
      const buyValid = buy.length >= strategy.minConfirmations && buyConfidence >= strategy.minConfidence;
      const sellValid = sell.length >= strategy.minConfirmations && sellConfidence >= strategy.minConfidence;
      if (buyValid && !sellValid) { buySignals++; signal = { direction: "BUY", confidence: buyConfidence, conditions: buy.map(describeCondition), index: i }; }
      else if (sellValid && !buyValid) { sellSignals++; signal = { direction: "SELL", confidence: sellConfidence, conditions: sell.map(describeCondition), index: i }; }
      else waits++;
    } else waits++;
    if (positions.length < strategy.maxConcurrentPositions && i < last) pending = signal;
    let currentEquity = capital;
    for (const p of positions) {
      const liquidation = candle.close - p.sign * (settings.spread / 2 + settings.slippage);
      currentEquity += p.sign * (liquidation - p.entry) * p.quantity - p.quantity * settings.commission;
    }
    if (!Number.isFinite(currentEquity)) throw new Error("Résultat numérique invalide : vérifiez le risque et les coûts.");
    peak = Math.max(peak, currentEquity);
    equity.push({ time: closeTime, equity: currentEquity, drawdown: peak > 0 ? 100 * (peak - currentEquity) / peak : 0 });
    if ((i - first) % 25 === 0) progress(10 + Math.floor(89 * (i - first) / (last - first + 1)));
  }
  progress(100);
  const { candles: _candles, ...metadata } = history;
  return { strategy, settings, trades, equity, stats: calculateStatistics(settings.initialCapital, capital, trades, equity), controls: { candles: last - first + 1, warmup: first, first: candles[first].time, last: candles[last].time, buySignals, sellSignals, waits, executed: trades.length, ambiguousBars, skippedEntries }, history: metadata };
}
