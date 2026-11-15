// ─── Types communs TradeBot IA ───────────────────────────────────────────────

export type MarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "VOLATILE";
export type SignalType = "BUY" | "SELL" | "WAIT";
export type BotStatus = "ACTIVE" | "PAUSED" | "ERROR" | "OFFLINE";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorValues {
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  adx: number | null;
}

export interface OpenPosition {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  lotSize: number;
  pnl: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit: number;
  timeOpen: string;
}

export interface DashboardData {
  price: number;
  change24h: number;
  changePercent24h: number;
  trend: "UP" | "DOWN" | "FLAT";
  regime: MarketRegime;
  signal: SignalType;
  confidence: number;
  botStatus: BotStatus;
  paperTrading: boolean;
  dailyPnL: number;
  dailyPnLPercent: number;
  drawdown: number;
  riskRemaining: number;
  openPositions: OpenPosition[];
}

export interface ChartPanelConfig {
  id: string;
  title: string;
  indicator: string;
  height: number;
}
