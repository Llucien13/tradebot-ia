import type { BacktestSettings, EquityPoint } from "@/lib/backtest/types";
import { calculateStatistics } from "@/lib/backtest/statistics";
import { validateM5History } from "./m5-engine";
import { validateM5V2Coverage } from "./m5-v2-validation";
import { m5SessionIndicators } from "./m5-session-indicators";
import { m5Setup } from "./m5-model";
import { classifyM5Gap } from "./m5-sessions";
import { validateM5Calendar, type M5Calendar } from "./m5-calendar";
import { v3ConfigSchema, v3BrokerSchema, validateV3Plan, v3DisplayConfig, V3_VERSION, v3Fingerprint, type V3Plan, type V3Result, type V3Trade, type V3Config, type V3Broker } from "./m5-v3-model";
import { v3M15, v3ConfirmedPivots, v3AddReaction, v3InvalidateZones, v3Structure, v3Rebound, type V3Zone, type V3Pivot } from "./m5-v3-price-action";
import { v3Size } from "./m5-v3-risk";

export interface V3Request { mode: "PAPER"; runId: string; approved: true; config: V3Config; broker: V3Broker; settings: BacktestSettings; history: unknown; calendar: M5Calendar; plan: V3Plan; phase: "development" | "validation"; profileFingerprint: string }
export async function runM5V3(request: V3Request, progress: (n: number) => void): Promise<V3Result> {
  if (request.mode !== "PAPER" || request.approved !== true || !request.runId) throw new Error("V3 PAPER uniquement : validation explicite requise.");
  if (request.phase !== "development" && request.phase !== "validation") throw new Error("Phase V3 inconnue.");
  const config = v3ConfigSchema.parse(request.config) as V3Config, broker = v3BrokerSchema.parse(request.broker) as V3Broker;
  const history = validateM5History(request.history), settings = request.settings;
  const calendar = validateM5Calendar(request.calendar, history.symbol);
  validateM5V2Coverage(history, calendar);
  if (broker.symbol !== history.symbol || broker.accountCurrency !== "USD") throw new Error("Spécifications broker USD requises pour le symbole exact du lot.");
  if (settings.initialCapital !== 300 || settings.timeframe !== "5m" || settings.start !== Date.parse(history.coverage.requestedStart) || settings.end !== Date.parse(history.coverage.requestedEnd)
    || ![settings.spread, settings.slippage, settings.commission].every(n => Number.isFinite(n) && n >= 0)) throw new Error("Simulation V3 M5 : capital 300 $, coûts valides et période exacte du lot requis.");
  validateV3Plan(request.plan, settings, request.phase);
  const profileFingerprint = await v3Fingerprint({ config, broker, calendar, plan: request.plan, costs: { spread: settings.spread, slippage: settings.slippage, commission: settings.commission } });
  if (profileFingerprint !== request.profileFingerprint) throw new Error("Le profil figé V3 ne correspond pas aux paramètres reçus.");
  const dataFingerprint = await v3Fingerprint(history.candles);
  const startedAt = new Date().toISOString(), candles = history.candles;
  const { rows, segmentStarts } = m5SessionIndicators(candles, m5Setup, 300000, calendar);
  const higher = v3M15(candles), higherIndicators = m5SessionIndicators(higher, m5Setup, 900000, calendar).rows;
  const first = candles.findIndex(c => c.time >= settings.start);
  if (first - segmentStarts[first] < 202) throw new Error("202 bougies initiales valides requises dans le segment de la première bougie testée.");
  let zones: V3Zone[] = [], highs: V3Pivot[] = [], lows: V3Pivot[] = [];
  let segment = 0, higherSegment = 0, hi = -1, capital = 300, peak = 300;
  let pending: ReturnType<typeof v3Rebound> = null;
  type Position = NonNullable<ReturnType<typeof v3Rebound>> & { entry: number; quantity: number; lots: number; risk: number; margin: number; potentialRR: number; entryTime: number };
  let position: Position | null = null;
  const trades: V3Trade[] = [], equity: EquityPoint[] = [{ time: settings.start, equity: capital, drawdown: 0 }];
  const audit = { normalClosures: 0, anomalies: 0, ignoredWarmup: 0, eligible: 0, discardedPending: 0, rejectedRisk: 0, rejectedMargin: 0, rejectedRR: 0 };
  let buySignals = 0, sellSignals = 0, skippedEntries = 0, ambiguousBars = 0;
  const quote = (bid: number, sign: number) => bid + (sign === -1 ? settings.spread : 0);
  const close = (price: number, time: number, exitReason: V3Trade["exitReason"]) => {
    const p = position!;
    const pnl = p.sign * (price - p.entry) * p.quantity - 2 * p.quantity * settings.commission;
    capital += p.sign * (price - p.entry) * p.quantity - p.quantity * settings.commission;
    const zone = `${p.zone.side} ${p.zone.low.toFixed(4)}–${p.zone.high.toFixed(4)} · ${p.zone.reactions} réactions distinctes · ${p.zone.sources.join("/")}`;
    trades.push({ id: trades.length + 1, burstId: trades.length + 1, entryTime: p.entryTime, exitTime: time, direction: p.sign === 1 ? "BUY" : "SELL", entry: p.entry, exit: price, initialSL: p.sl, initialTP: p.tp, stopChanges: [], exitReason,
      quantity: p.quantity, riskMoney: p.risk, spread: settings.spread, slippage: settings.slippage, commission: 2 * p.quantity * settings.commission, pnl, r: pnl / p.risk, durationMinutes: (time - p.entryTime) / 60000,
      confidence: 100, signalTime: p.time, lots: p.lots, marginUSD: p.margin, potentialRR: p.potentialRR, zone, formation: p.formation, trend: p.trend,
      conditions: [`Zone confirmée : ${zone}`, `Structure M15 : ${p.trend}`, `Bougie clôturée : ${p.formation}`, `Filtre EMA20/50 M15 : ${config.emaFilter ? "activé" : "désactivé"}`, `SL derrière zone/mèche : ${p.sl.toFixed(4)} · marge ${config.stopAtr} ATR`, `TP limité par zone opposée ${p.opposite.low.toFixed(4)}–${p.opposite.high.toFixed(4)} : ${p.tp.toFixed(4)}`, `RR potentiel avant frais à l’entrée : ${p.potentialRR.toFixed(3)}`, `Lots ${p.lots} · marge estimée ${p.margin.toFixed(2)} USD · risque frais inclus ${p.risk.toFixed(2)} USD`] });
    position = null;
  };
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], time = c.time + 300000, atr = rows[i].atr;
    const interrupted = i > 0 && c.time !== candles[i - 1].time + 300000;
    if (interrupted) {
      const kind = classifyM5Gap(candles[i - 1].time, c.time, 300000, calendar);
      if (i >= first) { if (kind === "scheduled-close") audit.normalClosures++; else audit.anomalies++; }
      segment = i; zones = []; highs = []; lows = [];
      if (pending) { pending = null; audit.discardedPending++; skippedEntries++; }
    }
    if (i >= first) {
      if (position) {
        const p = position, q = quote(c.open, p.sign);
        if (p.sign * (q - p.sl) <= 0) close(q - p.sign * settings.slippage, c.time, "Stop Loss");
        else if (p.sign * (q - p.tp) >= 0) close(p.tp - p.sign * settings.slippage, c.time, "Take Profit");
      }
      const signal = pending; pending = null;
      if (signal) {
        if (position || signal.time !== c.time || capital <= 0) skippedEntries++;
        else {
          const size = v3Size(c.open, signal.sign, signal.sl, signal.tp, capital, config, broker, settings);
          if (size.reason !== "ok") { skippedEntries++; if (size.reason === "risk") audit.rejectedRisk++; else if (size.reason === "margin") audit.rejectedMargin++; else audit.rejectedRR++; }
          else { position = { ...signal, ...size, entryTime: c.time }; capital -= size.quantity * settings.commission; }
        }
      }
      if (position) {
        const p = position, lo = quote(c.low, p.sign), high = quote(c.high, p.sign);
        const stop = p.sign === 1 ? lo <= p.sl : high >= p.sl, target = p.sign === 1 ? high >= p.tp : lo <= p.tp;
        if (stop && target) ambiguousBars++;
        if (stop) close(p.sl - p.sign * settings.slippage, time - 1, "Stop Loss");
        else if (target) close(p.tp - p.sign * settings.slippage, time - 1, "Take Profit");
        else if (i === candles.length - 1) close(quote(c.close, p.sign) - p.sign * settings.slippage, time - 1, "Fin de période");
      }
      const value = capital + (position ? position.sign * (quote(c.close, position.sign) - position.sign * settings.slippage - position.entry) * position.quantity - position.quantity * settings.commission : 0);
      if (!Number.isFinite(value)) throw new Error("Equity V3 non finie.");
      peak = Math.max(peak, value); equity.push({ time, equity: value, drawdown: 100 * (peak - value) / peak });
    }
    while (hi + 1 < higher.length && higher[hi + 1].time + 900000 <= time) {
      hi++;
      if (hi && higher[hi].time !== higher[hi - 1].time + 900000) { higherSegment = hi; highs = []; lows = []; }
      if (higher[hi].time < c.time - 900000 && interrupted) continue;
      const hAtr = higherIndicators[hi].atr;
      for (const pivot of v3ConfirmedPivots(higher, hi, higherSegment, config.pivotBars, 900000)) {
        if (pivot.side === "resistance") highs = [...highs.slice(-1), pivot]; else lows = [...lows.slice(-1), pivot];
        if (hAtr && hAtr > 0) v3AddReaction(zones, pivot, hAtr, config, "M15");
      }
    }
    if (atr && atr > 0) {
      zones = v3InvalidateZones(zones, c.close, atr, config);
      for (const pivot of v3ConfirmedPivots(candles, i, segment, config.pivotBars, 300000)) {
        if (pivot.side === "support" ? c.close >= pivot.price - config.breakAtr * atr : c.close <= pivot.price + config.breakAtr * atr) v3AddReaction(zones, pivot, atr, config, "M5");
      }
    }
    if (i < first) continue;
    if (i - segmentStarts[i] < 202 || !atr || atr <= 0) { audit.ignoredWarmup++; continue; }
    const trend = v3Structure(highs, lows), h = higherIndicators[hi];
    if (hi < 0 || higher[hi].time + 900000 !== time - time % 900000 || trend === "indisponible") continue;
    audit.eligible++;
    const signal = v3Rebound(c, i > segment ? candles[i - 1] : null, zones, trend, atr, config);
    if (signal && !position && i < candles.length - 1 && (!config.emaFilter || (h && h.middle !== null && h.slow !== null && signal.sign * (h.middle - h.slow) > 0))) {
      pending = signal.sign === -1 ? { ...signal, sl: signal.sl + settings.spread, tp: signal.tp + settings.spread } : signal; if (signal.sign === 1) buySignals++; else sellSignals++;
    }
    if (i % 100 === 0) progress(Math.round(100 * i / candles.length));
  }
  const { candles: omitted, ...metadata } = history, scalping = v3DisplayConfig(config);
  progress(100);
  return { strategy: scalping.signal, settings, history: metadata, scalping, trades, bursts: [], days: [], equity, stats: calculateStatistics(300, capital, trades, equity), engineVersion: V3_VERSION, validation: "Non validé", calendar,
    v3: { config, broker, plan: request.plan, phase: request.phase, profileFingerprint, dataFingerprint }, audit, execution: { engineVersion: V3_VERSION, runId: request.runId, startedAt, completedAt: new Date().toISOString() },
    controls: { candles: candles.length - first, warmup: first, first: candles[first].time, last: candles.at(-1)!.time, buySignals, sellSignals, waits: candles.length - first - buySignals - sellSignals, executed: trades.length, ambiguousBars, skippedEntries } };
}
