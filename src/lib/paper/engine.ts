import { describeCondition, type Strategy, type Condition } from "@/lib/strategies";
import type { IndicatorRow } from "@/lib/backtest/indicators";
import { configuredIndicators } from "./indicators";
import { allocatePaperPosition } from "./risk-manager";
import { PAPER_INTERVAL, PAPER_TIMEFRAMES, requiredPaperBars, type PaperState, type PaperFeed, type PaperTimeframe, type PaperSignal, type ValidatedRule, type PaperPosition } from "./model";

function validRules(rules: Condition[], row: IndicatorRow, previous: IndicatorRow): ValidatedRule[] {
  return rules.flatMap(rule => {
    const a = row[rule.left], b = rule.rightType === "value" ? rule.value : row[rule.rightField];
    if (a === null || b === null) throw new Error("Indicateur enregistré non calculable : aucun signal de remplacement.");
    let valid: boolean;
    if (rule.operator === "gt") valid = a > b;
    else if (rule.operator === "gte") valid = a >= b;
    else if (rule.operator === "lt") valid = a < b;
    else if (rule.operator === "lte") valid = a <= b;
    else {
      const pa = previous[rule.left], pb = rule.rightType === "value" ? rule.value : previous[rule.rightField];
      if (pa === null || pb === null) throw new Error("Préchauffage insuffisant pour un croisement enregistré.");
      valid = rule.operator === "crossAbove" ? pa <= pb && a > b : pa >= pb && a < b;
    }
    return valid ? [{ id: rule.id, description: describeCondition(rule), left: a, right: b }] : [];
  });
}
function entryFilters(s: Strategy, state: PaperState, time: number): string[] {
  const reasons: string[] = [];
  if (!s.enabled) reasons.push("Stratégie enregistrée désactivée.");
  const h = new Date(time).getUTCHours();
  if (!s.sessions.some(session => session === "Asie" ? h < 9 : session === "Londres" ? h >= 7 && h < 16 : h >= 13 && h < 22)) reasons.push("Hors des sessions UTC enregistrées.");
  if (state.lastExit !== null && time - state.lastExit < s.cooldownMinutes * 60000) reasons.push("Cooldown enregistré non écoulé.");
  if (s.spread.enabled && !state.account) reasons.push("Spread simulé non renseigné : le filtre enregistré ne peut pas être validé.");
  else if (s.spread.enabled && state.account!.spread > s.spread.maxUSD) reasons.push("Spread simulé supérieur au maximum enregistré.");
  return reasons;
}
export function paperUnrealized(state: PaperState): number | null {
  if (!state.position) return state.account ? 0 : null;
  if (!state.account || !state.lastPrice) return null;
  const p = state.position, a = state.account, sign = p.direction === "BUY" ? 1 : -1;
  return (sign * (state.lastPrice.price - sign * (a.spread / 2 + a.slippage) - p.entry) * p.quantity - a.commission * p.quantity) / a.usdPerEur;
}
function equityPoint(state: PaperState, time: number, reference: number) {
  if (!state.account) return;
  const p = state.position, a = state.account;
  const sign = p?.direction === "BUY" ? 1 : -1;
  const floating = p ? (sign * (reference - sign * (a.spread / 2 + a.slippage) - p.entry) * p.quantity - a.commission * p.quantity) / a.usdPerEur : 0;
  const equity = state.cash! + floating;
  const peak = Math.max(a.initialCapital, equity, ...state.equity.map(point => point.equity));
  const point = { time, equity, drawdown: peak > 0 ? 100 * (peak - equity) / peak : 0 };
  const last = state.equity[state.equity.length - 1];
  if (last?.time === time) state.equity[state.equity.length - 1] = point;
  else if (!last || time > last.time) state.equity.push(point);
}
function closePosition(state: PaperState, price: number, time: number, reason: PaperPosition["stopReason"] | "Take Profit") {
  const p = state.position!, a = state.account!, sign = p.direction === "BUY" ? 1 : -1;
  const gross = sign * (price - p.entry) * p.quantity / a.usdPerEur, commission = 2 * a.commission * p.quantity / a.usdPerEur;
  const pnl = gross - commission;
  state.cash! += gross - a.commission * p.quantity / a.usdPerEur;
  state.trades.push({ id: state.trades.length + 1, source: "TWELVE_DATA", timeframe: p.timeframe, version: p.version, positionId: p.id, lots: p.lots, riskBudgetEUR: p.riskBudgetEUR, marginEUR: p.marginEUR, entryTime: p.entryTime, exitTime: time, direction: p.direction, entry: p.entry, exit: price, initialSL: p.initialSL, initialTP: p.tp, stopChanges: p.changes, exitReason: reason, quantity: p.quantity, riskMoney: p.riskMoney, spread: a.spread, slippage: a.slippage, commission, pnl, r: pnl / p.riskMoney, durationMinutes: (time - p.entryTime) / 60000, confidence: p.confidence, conditions: p.conditions, signalTime: p.signalTime });
  state.position = null; state.lastExit = time;
}
export function advancePaper(previousState: PaperState, strategy: Strategy | null, feed: PaperFeed): PaperState {
  if (feed.source !== "TWELVE_DATA") throw new Error("Le moteur refuse toute source autre que Twelve Data.");
  const state = structuredClone(previousState);
  let version: string | null = null;
  if (strategy) {
    version = Object.keys(state.versions).find(key => JSON.stringify(state.versions[key]) === JSON.stringify(strategy)) ?? crypto.randomUUID();
    state.versions[version] = structuredClone(strategy);
  }
  if (version !== state.currentVersion) {
    if (state.pending) { const signal = state.signals.find(s => s.id === state.pending!.signalId); if (signal) signal.execution = "Entrée annulée : configuration enregistrée modifiée."; }
    state.pending = null; state.currentVersion = version;
  }
  const rows = {} as Record<PaperTimeframe, IndicatorRow[]>;
  const positionRows = {} as Record<PaperTimeframe, IndicatorRow[]>;
  const events: { time: number; kind: "open" | "close"; timeframe: PaperTimeframe; index: number }[] = [];
  for (const timeframe of PAPER_TIMEFRAMES) {
    const candles = feed.series[timeframe], step = PAPER_INTERVAL[timeframe];
    let last = candles.length - 1;
    while (last >= 0 && candles[last].time + step > feed.fetchedAt) last--;
    const needed = strategy ? requiredPaperBars(strategy) : state.position ? requiredPaperBars(state.versions[state.position.version]) : 2;
    if (last < needed) throw new Error(`Pas assez de bougies réelles ${timeframe} pour les indicateurs enregistrés. Moteur bloqué.`);
    const cursor = state.cursors[timeframe];
    if (cursor !== null && cursor < candles[0].time) throw new Error(`La période non traitée ${timeframe} n’est plus couverte par l’historique disponible. Aucun trade de rattrapage inventé.`);
    if (strategy) rows[timeframe] = configuredIndicators(candles, strategy);
    if (state.position?.timeframe === timeframe) positionRows[timeframe] = configuredIndicators(candles, state.versions[state.position.version]);
    const anchor = cursor ?? candles[last].time;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (c.time >= anchor && c.time <= feed.fetchedAt) events.push({ time: c.time, kind: "open", timeframe, index: i });
      if (i <= last && (cursor === null ? i === last : c.time + step > cursor)) events.push({ time: c.time + step, kind: "close", timeframe, index: i });
    }
  }
  events.sort((a, b) => a.time - b.time || (a.kind === b.kind ? PAPER_TIMEFRAMES.indexOf(a.timeframe) - PAPER_TIMEFRAMES.indexOf(b.timeframe) : a.kind === "close" ? -1 : 1));
  for (const event of events) {
    const { timeframe, index, time } = event, candle = feed.series[timeframe][index];
    if (event.kind === "open") {
      // Gaps are processed using the actual next open, never a fabricated tick.
      if (state.position?.timeframe === timeframe && state.position.entryTime < time) {
        const p = state.position, a = state.account!, sign = p.direction === "BUY" ? 1 : -1;
        const quote = candle.open - sign * a.spread / 2;
        if (sign * (quote - p.sl) <= 0) closePosition(state, quote - sign * a.slippage, time, p.stopReason);
        else if (sign * (quote - p.tp) >= 0) closePosition(state, p.tp - sign * a.slippage, time, "Take Profit");
      }
      const pending = state.pending;
      if (!pending || pending.timeframe !== timeframe || time < pending.time) continue;
      const signal = state.signals.find(s => s.id === pending.signalId)!;
      state.pending = null;
      if (time !== pending.time) { signal.execution = "Pas de bougie d’ouverture correspondant au signal ; entrée expirée."; continue; }
      if (!state.account || !state.running || time < state.startedAt!) { signal.execution = "Signal antérieur au démarrage ou paper trading en pause : aucune entrée rétroactive."; continue; }
      if (!strategy || pending.version !== version || entryFilters(strategy, state, time).length) { signal.execution = "Filtres enregistrés non validés à l’ouverture."; continue; }
      if (state.position) { signal.execution = "Une position virtuelle est déjà ouverte."; continue; }
      if (state.cash! <= 0) { signal.execution = "Capital paper insuffisant."; continue; }
      const a = state.account, sign = pending.direction === "BUY" ? 1 : -1;
      const entry = candle.open + sign * (a.spread / 2 + a.slippage);
      let sl: number;
      if (strategy.stopLoss.mode === "fixed") sl = entry - sign * strategy.stopLoss.fixedDistance;
      else if (strategy.stopLoss.mode === "atr") {
        if (pending.atr === null) throw new Error("ATR réel absent pour le stop enregistré.");
        sl = entry - sign * pending.atr * strategy.stopLoss.atrMultiplier;
      } else sl = sign === 1 ? pending.structureLow - strategy.stopLoss.structureBuffer : pending.structureHigh + strategy.stopLoss.structureBuffer;
      const distance = sign * (entry - sl), tp = entry + sign * distance * strategy.takeProfitRR;
      if (![entry, sl, tp].every(Number.isFinite) || sl <= 0 || tp <= 0 || distance <= 0 || sign * (candle.open - sign * a.spread / 2 - sl) <= 0) { signal.execution = "Risk Manager : stop non valide au prix d’ouverture réel."; continue; }
      // No concurrent position: cash equals account equity immediately before this entry.
      const allocation = allocatePaperPosition(a, state.cash!, entry, distance, strategy.riskPercent);
      if (allocation.error) { signal.execution = allocation.error; continue; }
      const { quantity, lots, riskMoney, riskBudgetEUR, marginEUR } = allocation;
      state.cash! -= quantity * a.commission / a.usdPerEur;
      state.position = { id: crypto.randomUUID(), source: "TWELVE_DATA", timeframe, version: version!, signalId: signal.id, entryTime: time, entry, direction: pending.direction, sl, initialSL: sl, tp, quantity, lots, marginEUR, riskMoney, riskBudgetEUR, distance, bestClose: entry, changes: [], stopReason: "Stop Loss", confidence: signal.confidence, conditions: (pending.direction === "BUY" ? signal.buy : signal.sell).map(rule => rule.description), signalTime: signal.time };
      signal.execution = "Position virtuelle ouverte par le Risk Manager.";
      continue;
    }
    if (state.position?.timeframe === timeframe && state.position.entryTime < time) {
      const p = state.position, saved = state.versions[p.version], a = state.account!, sign = p.direction === "BUY" ? 1 : -1;
      const offset = -sign * a.spread / 2;
      const stop = sign === 1 ? candle.low + offset <= p.sl : candle.high + offset >= p.sl;
      const target = sign === 1 ? candle.high + offset >= p.tp : candle.low + offset <= p.tp;
      if (stop) closePosition(state, p.sl - sign * a.slippage, time, p.stopReason);
      else if (target) closePosition(state, p.tp - sign * a.slippage, time, "Take Profit");
      else {
        const reference = candle.close + offset;
        p.bestClose = sign === 1 ? Math.max(p.bestClose, reference) : Math.min(p.bestClose, reference);
        const change = (newSL: number, reason: "Break-even" | "Trailing ATR") => { if (sign * (newSL - p.sl) > 0) { p.changes.push({ time, oldSL: p.sl, newSL, reason }); p.sl = newSL; p.stopReason = reason; } };
        if (saved.breakEven.enabled && sign * (reference - p.entry) >= p.distance * saved.breakEven.thresholdR) change(p.entry, "Break-even");
        if (saved.trailing.enabled) {
          const series = positionRows[timeframe] ?? configuredIndicators(feed.series[timeframe], saved);
          const atr = series[index].atr;
          if (atr === null) throw new Error("ATR réel indisponible pour le trailing enregistré.");
          const candidate = p.bestClose - sign * saved.trailing.distanceATR * atr;
          if (sign * (candidate - p.sl) > 0) {
            change(candidate, "Trailing ATR");
            // If the updated stop is already crossed, exit at the actual closed quote.
            if (sign * (reference - candidate) <= 0) closePosition(state, reference - sign * a.slippage, time, "Trailing ATR");
          }
        }
      }
    }
    state.cursors[timeframe] = time;
    if (strategy?.enabled) {
      const row = rows[timeframe][index], previous = rows[timeframe][index - 1];
      const buy = validRules(strategy.buy, row, previous), sell = validRules(strategy.sell, row, previous);
      const buyConfidence = 100 * buy.length / strategy.buy.length, sellConfidence = 100 * sell.length / strategy.sell.length;
      const b = buy.length >= strategy.minConfirmations && buyConfidence >= strategy.minConfidence;
      const s = sell.length >= strategy.minConfirmations && sellConfidence >= strategy.minConfidence;
      const reasons = entryFilters(strategy, state, time);
      if (b && s) reasons.push("BUY et SELL valides simultanément : WAIT.");
      else if (!b && !s) reasons.push("Confirmations ou confiance enregistrées non atteintes.");
      const direction = reasons.length ? "WAIT" : b ? "BUY" : s ? "SELL" : "WAIT";
      const signal: PaperSignal = { id: crypto.randomUUID(), source: "TWELVE_DATA", version: version!, timeframe, time, observedAt: feed.fetchedAt, direction, confidence: direction === "BUY" ? buyConfidence : direction === "SELL" ? sellConfidence : Math.max(buyConfidence, sellConfidence), buy, sell, buyConfidence, sellConfidence, reasons, execution: null };
      state.signals.push(signal);
      if (direction !== "WAIT") {
        if (!state.account || !state.running) signal.execution = "Signal calculé ; paper trading non démarré.";
        else if (time < state.startedAt!) signal.execution = "Signal antérieur au démarrage ; aucune entrée rétroactive.";
        else if (state.position || state.pending) signal.execution = "Une position ou entrée virtuelle est déjà en cours.";
        else {
          const lookback = strategy.stopLoss.mode === "structure" ? strategy.stopLoss.structureLookback : 1;
          const window = feed.series[timeframe].slice(index + 1 - lookback, index + 1);
          state.pending = { signalId: signal.id, version: version!, timeframe, time, direction, atr: row.atr, structureLow: Math.min(...window.map(c => c.low)), structureHigh: Math.max(...window.map(c => c.high)) };
          signal.execution = "En attente de l’ouverture réelle de la bougie suivante.";
        }
      }
    }
    if (state.account && time >= state.account.createdAt) equityPoint(state, time, candle.close);
  }
  const latest = feed.series["1h"][feed.series["1h"].length - 1];
  state.lastPrice = { price: latest.close, time: feed.fetchedAt }; state.fetchedAt = feed.fetchedAt;
  if (state.account && (state.equity[state.equity.length - 1]?.time ?? 0) < feed.fetchedAt) equityPoint(state, feed.fetchedAt, latest.close);
  state.signals = state.signals.slice(-500);
  return state;
}
