import { z } from "zod";
import { STRATEGY_STORAGE_KEY, strategySchema, type Strategy } from "@/lib/strategies";
import type { BacktestTrade, EquityPoint, StopChange } from "@/lib/backtest/types";

export const PAPER_KEY = "tradebot.paper.eur.v2";
export const PAPER_LEGACY_KEY = "tradebot.paper.real.v1";
export const PAPER_DEFAULT_CAPITAL = 20000;
export const PAPER_CAPITAL_OPTIONS = [20000, 45000] as const;
export const paperCapitalSchema = z.union([z.literal(20000), z.literal(45000)]);
export const PAPER_TIMEFRAMES = ["1h", "4h"] as const;
export type PaperTimeframe = typeof PAPER_TIMEFRAMES[number];
export const PAPER_INTERVAL: Record<PaperTimeframe, number> = { "1h": 3600000, "4h": 14400000 };
export const candleSchema = z.object({ time: z.number().int().positive(), open: z.number().finite().positive(), high: z.number().finite().positive(), low: z.number().finite().positive(), close: z.number().finite().positive() }).refine(c => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close));
export type PaperCandle = z.infer<typeof candleSchema>;
const seriesSchema = z.array(candleSchema).min(2).max(2000).refine(candles => candles.every((c, i) => !i || c.time > candles[i - 1].time));
export const feedSchema = z.object({ source: z.literal("TWELVE_DATA"), fetchedAt: z.number().int().positive(), series: z.object({ "1h": seriesSchema, "4h": seriesSchema }) });
export type PaperFeed = z.infer<typeof feedSchema>;
export const accountInputSchema = z.object({
  initialCapital: z.number().finite().positive(), spread: z.number().finite().positive(),
  slippage: z.number().finite().nonnegative(), commission: z.number().finite().nonnegative(),
  contractSize: z.number().finite().positive(), minLot: z.number().finite().positive(),
  lotStep: z.number().finite().positive(), leverage: z.number().finite().min(1).max(20),
});
export type PaperAccountInput = z.infer<typeof accountInputSchema>;
export const accountSchema = accountInputSchema.extend({
  currency: z.literal("EUR"), usdPerEur: z.number().finite().positive(), fxTime: z.number().int().positive(),
  fxSource: z.literal("TWELVE_DATA"), createdAt: z.number().int().positive(),
});
export type PaperAccount = z.infer<typeof accountSchema>;
export interface ValidatedRule { id: string; description: string; left: number; right: number }
export interface PaperSignal {
  id: string; source: "TWELVE_DATA"; version: string; timeframe: PaperTimeframe; time: number; observedAt: number;
  direction: "BUY" | "SELL" | "WAIT"; confidence: number;
  buy: ValidatedRule[]; sell: ValidatedRule[]; buyConfidence: number; sellConfidence: number;
  reasons: string[]; execution: string | null;
}
export interface PaperPosition {
  id: string; source: "TWELVE_DATA"; timeframe: PaperTimeframe; version: string; signalId: string;
  entryTime: number; entry: number; direction: "BUY" | "SELL"; sl: number; initialSL: number; tp: number;
  quantity: number; lots: number; marginEUR: number; riskMoney: number; riskBudgetEUR: number; distance: number; bestClose: number;
  changes: StopChange[]; stopReason: "Stop Loss" | "Break-even" | "Trailing ATR";
  confidence: number; conditions: string[]; signalTime: number;
}
export interface PaperTrade extends BacktestTrade { source: "TWELVE_DATA"; timeframe: PaperTimeframe; version: string; positionId: string; lots: number; riskBudgetEUR: number; marginEUR: number }
export interface PendingEntry { signalId: string; version: string; timeframe: PaperTimeframe; time: number; direction: "BUY" | "SELL"; atr: number | null; structureLow: number; structureHigh: number }
export interface PaperState {
  version: 2; account: PaperAccount | null; cash: number | null; running: boolean; startedAt: number | null;
  signals: PaperSignal[]; position: PaperPosition | null; pending: PendingEntry | null; trades: PaperTrade[];
  equity: EquityPoint[]; versions: Record<string, Strategy>; currentVersion: string | null;
  cursors: Record<PaperTimeframe, number | null>; lastExit: number | null;
  lastPrice: { price: number; time: number } | null; fetchedAt: number | null;
}
const finite = z.number().finite(), time = z.number().int().positive();
const tf = z.enum(PAPER_TIMEFRAMES), source = z.literal("TWELVE_DATA");
const stopChange = z.object({ time, oldSL: finite, newSL: finite, reason: z.enum(["Break-even", "Trailing ATR"]) });
const rule = z.object({ id: z.string(), description: z.string(), left: finite, right: finite });
export const paperStateSchema = z.object({
  version: z.literal(2), account: accountSchema.nullable(), cash: finite.nullable(), running: z.boolean(), startedAt: time.nullable(),
  signals: z.array(z.object({ id: z.string(), source, version: z.string(), timeframe: tf, time, observedAt: time, direction: z.enum(["BUY", "SELL", "WAIT"]), confidence: finite, buy: z.array(rule), sell: z.array(rule), buyConfidence: finite, sellConfidence: finite, reasons: z.array(z.string()), execution: z.string().nullable() })),
  position: z.object({ id: z.string(), source, timeframe: tf, version: z.string(), signalId: z.string(), entryTime: time, entry: finite, direction: z.enum(["BUY", "SELL"]), sl: finite, initialSL: finite, tp: finite, quantity: finite.positive(), lots: finite.positive(), marginEUR: finite.positive(), riskMoney: finite.positive(), riskBudgetEUR: finite.positive(), distance: finite.positive(), bestClose: finite, changes: z.array(stopChange), stopReason: z.enum(["Stop Loss", "Break-even", "Trailing ATR"]), confidence: finite, conditions: z.array(z.string()), signalTime: time }).nullable(),
  pending: z.object({ signalId: z.string(), version: z.string(), timeframe: tf, time, direction: z.enum(["BUY", "SELL"]), atr: finite.nullable(), structureLow: finite, structureHigh: finite }).nullable(),
  trades: z.array(z.object({ id: z.number().int().positive(), source, timeframe: tf, version: z.string(), positionId: z.string(), lots: finite.positive(), riskBudgetEUR: finite.positive(), marginEUR: finite.positive(), entryTime: time, exitTime: time, direction: z.enum(["BUY", "SELL"]), entry: finite, exit: finite, initialSL: finite, initialTP: finite, stopChanges: z.array(stopChange), exitReason: z.enum(["Stop Loss", "Break-even", "Trailing ATR", "Take Profit", "Fin de période"]), quantity: finite.positive(), riskMoney: finite.positive(), spread: finite.nonnegative(), slippage: finite.nonnegative(), commission: finite.nonnegative(), pnl: finite, r: finite, durationMinutes: finite.nonnegative(), confidence: finite, conditions: z.array(z.string()), signalTime: time })),
  equity: z.array(z.object({ time, equity: finite, drawdown: finite.nonnegative() })), versions: z.record(z.string(), strategySchema), currentVersion: z.string().nullable(),
  cursors: z.object({ "1h": time.nullable(), "4h": time.nullable() }), lastExit: time.nullable(), lastPrice: z.object({ price: finite.positive(), time }).nullable(), fetchedAt: time.nullable(),
});
export function emptyPaperState(): PaperState {
  return { version: 2, account: null, cash: null, running: false, startedAt: null, signals: [], position: null, pending: null, trades: [], equity: [], versions: {}, currentVersion: null, cursors: { "1h": null, "4h": null }, lastExit: null, lastPrice: null, fetchedAt: null };
}
export function readPaperState(): PaperState {
  const raw = localStorage.getItem(PAPER_KEY);
  if (!raw) return emptyPaperState();
  const state = paperStateSchema.parse(JSON.parse(raw)) as PaperState;
  validatePaperStateIntegrity(state);
  return state;
}
export function validatePaperStateIntegrity(state: PaperState) {
  if (state.account === null && (state.cash !== null || state.trades.length || state.position || state.running)) throw new Error("Compte paper incohérent.");
  if ([...state.signals, ...state.trades, ...(state.position ? [state.position] : [])].some(item => !state.versions[item.version])) throw new Error("Configuration d’audit absente du journal paper.");
  if (state.account && Math.abs(state.cash! - (state.account.initialCapital + state.trades.reduce((sum, t) => sum + t.pnl, 0) - (state.position ? state.position.quantity * state.account.commission / state.account.usdPerEur : 0))) > 0.00001) throw new Error("Le capital paper ne correspond pas aux trades calculés.");
  return state;
}
export function writePaperState(state: PaperState) {
  paperStateSchema.parse(state);
  localStorage.setItem(PAPER_KEY, JSON.stringify(state));
}
export function readTrendMaster(): Strategy {
  const raw = localStorage.getItem(STRATEGY_STORAGE_KEY);
  if (!raw) throw new Error("Trend Master XAU n’est pas enregistrée dans Strategy Lab. Aucun modèle par défaut ne sera créé par le moteur.");
  const all = z.array(strategySchema).parse(JSON.parse(raw));
  const named = all.filter(s => s.name === "Trend Master XAU");
  const active = named.filter(s => s.enabled);
  if (!named.length) throw new Error("La stratégie enregistrée Trend Master XAU est introuvable.");
  if (active.length > 1) throw new Error("Plusieurs stratégies actives portent le nom Trend Master XAU. Le moteur refuse de choisir arbitrairement.");
  const s = active[0] ?? named[0];
  if (s.timeframes.length !== 2 || !s.timeframes.includes("1h") || !s.timeframes.includes("4h")) throw new Error("Les timeframes enregistrés ne correspondent pas à 1h et 4h. Moteur bloqué ; aucun paramètre de stratégie n’est modifié.");
  return s;
}
export function requiredPaperBars(s: Strategy): number {
  const periods = [2];
  if (s.indicators.ema20) periods.push(20);
  if (s.indicators.ema50) periods.push(50);
  if (s.indicators.ema200) periods.push(200);
  if (s.indicators.rsi) periods.push(15);
  if (s.indicators.macd) periods.push(s.parameters.macdSlow + s.parameters.macdSignal);
  if (s.indicators.adx) periods.push(2 * s.parameters.adxPeriod);
  if (s.indicators.atr) periods.push(s.parameters.atrPeriod);
  if (s.indicators.bollinger) periods.push(s.parameters.bbPeriod);
  if (s.stopLoss.mode === "structure") periods.push(s.stopLoss.structureLookback);
  return Math.max(...periods) + 2;
}
