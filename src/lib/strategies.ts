import { z } from "zod";

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const;
export const SESSIONS = ["Asie", "Londres", "New York"] as const;
export const INDICATORS = ["ema20", "ema50", "ema200", "rsi", "macd", "adx", "atr", "bollinger"] as const;
export const INDICATOR_LABELS: Record<typeof INDICATORS[number], string> = {
  ema20: "EMA 20", ema50: "EMA 50", ema200: "EMA 200", rsi: "RSI 14",
  macd: "MACD", adx: "ADX", atr: "ATR", bollinger: "Bollinger Bands",
};
export const FIELDS = ["price", "ema20", "ema50", "ema200", "rsi", "macd", "macdSignal", "adx", "atr", "bbUpper", "bbMiddle", "bbLower"] as const;
export const FIELD_LABELS: Record<typeof FIELDS[number], string> = {
  price: "Clôture", ema20: "EMA 20", ema50: "EMA 50", ema200: "EMA 200", rsi: "RSI 14",
  macd: "MACD", macdSignal: "Signal MACD", adx: "ADX", atr: "ATR",
  bbUpper: "Bollinger haute", bbMiddle: "Bollinger médiane", bbLower: "Bollinger basse",
};
export const OPERATORS = ["gt", "gte", "lt", "lte", "crossAbove", "crossBelow"] as const;
export const OPERATOR_LABELS: Record<typeof OPERATORS[number], string> = {
  gt: ">", gte: "≥", lt: "<", lte: "≤", crossAbove: "Croise au-dessus", crossBelow: "Croise en dessous",
};
const fieldIndicator: Partial<Record<typeof FIELDS[number], typeof INDICATORS[number]>> = {
  ema20: "ema20", ema50: "ema50", ema200: "ema200", rsi: "rsi", macd: "macd", macdSignal: "macd",
  adx: "adx", atr: "atr", bbUpper: "bollinger", bbMiddle: "bollinger", bbLower: "bollinger",
};
export const conditionSchema = z.object({
  id: z.string().min(1), left: z.enum(FIELDS), operator: z.enum(OPERATORS),
  rightType: z.enum(["field", "value"]), rightField: z.enum(FIELDS), value: z.number().finite(),
});
const period = z.number().int().min(2).max(500);
export const strategySchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1, "Le nom est obligatoire.").max(80),
  symbol: z.literal("XAU/USD"), enabled: z.boolean(),
  timeframes: z.array(z.enum(TIMEFRAMES)).min(1, "Sélectionnez au moins un timeframe.").max(5),
  indicators: z.object({ ema20: z.boolean(), ema50: z.boolean(), ema200: z.boolean(), rsi: z.boolean(), macd: z.boolean(), adx: z.boolean(), atr: z.boolean(), bollinger: z.boolean() }),
  parameters: z.object({ macdFast: period, macdSlow: period, macdSignal: period, adxPeriod: period, atrPeriod: period, bbPeriod: period, bbDeviation: z.number().min(0.1).max(10) }),
  buy: z.array(conditionSchema).min(1, "Ajoutez une condition BUY.").max(30),
  sell: z.array(conditionSchema).min(1, "Ajoutez une condition SELL.").max(30),
  minConfirmations: z.number().int().min(1).max(30), minConfidence: z.number().min(0).max(100),
  riskPercent: z.number().positive().max(100),
  maxConcurrentPositions: z.number().int().min(1).max(5).default(1),
  stopLoss: z.object({ mode: z.enum(["atr", "fixed", "structure"]), atrMultiplier: z.number().positive().max(100), fixedDistance: z.number().positive().max(10000), structureLookback: z.number().int().min(2).max(500), structureBuffer: z.number().min(0).max(1000) }),
  takeProfitRR: z.number().positive().max(100),
  breakEven: z.object({ enabled: z.boolean(), thresholdR: z.number().positive().max(100) }),
  trailing: z.object({ enabled: z.boolean(), distanceATR: z.number().positive().max(100) }),
  spread: z.object({ enabled: z.boolean(), maxUSD: z.number().min(0).max(1000) }),
  cooldownMinutes: z.number().int().min(0).max(10080),
  sessions: z.array(z.enum(SESSIONS)).min(1, "Sélectionnez au moins une session.").max(3),
}).superRefine((s, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (s.minConfirmations > s.buy.length || s.minConfirmations > s.sell.length) error("Les confirmations minimales ne peuvent dépasser le nombre de conditions BUY ou SELL.");
  if (s.parameters.macdFast >= s.parameters.macdSlow) error("La période rapide MACD doit être inférieure à la période lente.");
  for (const [side, rules] of [["BUY", s.buy], ["SELL", s.sell]] as const) {
    for (const rule of rules) {
      for (const field of [rule.left, ...(rule.rightType === "field" ? [rule.rightField] : [])]) {
        const indicator = fieldIndicator[field];
        if (indicator && !s.indicators[indicator]) error(`${side} : activez ${INDICATOR_LABELS[indicator]} ou retirez la condition associée.`);
      }
    }
  }
  if ((s.stopLoss.mode === "atr" || s.trailing.enabled) && !s.indicators.atr) error("Activez ATR pour le stop ATR ou le trailing stop.");
});
export type Strategy = z.infer<typeof strategySchema>;
export type Condition = z.infer<typeof conditionSchema>;

export function newCondition(left: Condition["left"] = "price", rightField: Condition["rightField"] = "ema20", operator: Condition["operator"] = "gt"): Condition {
  return { id: crypto.randomUUID(), left, rightField, operator, rightType: "field", value: 50 };
}
export function defaultStrategy(): Strategy {
  return {
    id: crypto.randomUUID(), name: "Trend Master XAU", symbol: "XAU/USD", enabled: false,
    timeframes: ["1h", "4h"],
    indicators: { ema20: true, ema50: true, ema200: true, rsi: true, macd: true, adx: true, atr: true, bollinger: false },
    parameters: { macdFast: 12, macdSlow: 26, macdSignal: 9, adxPeriod: 14, atrPeriod: 14, bbPeriod: 20, bbDeviation: 2 },
    buy: [newCondition("ema20", "ema50"), newCondition("price", "ema200"), { ...newCondition("rsi"), rightType: "value", value: 50 }],
    sell: [newCondition("ema20", "ema50", "lt"), newCondition("price", "ema200", "lt"), { ...newCondition("rsi", "ema20", "lt"), rightType: "value", value: 50 }],
    minConfirmations: 2, minConfidence: 60, riskPercent: 1, maxConcurrentPositions: 1,
    stopLoss: { mode: "atr", atrMultiplier: 2, fixedDistance: 10, structureLookback: 10, structureBuffer: 1 },
    takeProfitRR: 2, breakEven: { enabled: true, thresholdR: 1 }, trailing: { enabled: false, distanceATR: 2 },
    spread: { enabled: true, maxUSD: 0.5 }, cooldownMinutes: 60, sessions: ["Londres", "New York"],
  };
}
export const STRATEGY_STORAGE_KEY = "tradebot.strategies.v1";
export const BACKTEST_STORAGE_KEY = "tradebot.backtest-strategy.v1";
export function loadStrategies(): { strategies: Strategy[]; error: string | null } {
  try {
    const raw = localStorage.getItem(STRATEGY_STORAGE_KEY);
    if (!raw) return { strategies: [defaultStrategy()], error: null };
    const parsed = z.array(strategySchema).min(1).parse(JSON.parse(raw));
    return { strategies: parsed, error: null };
  } catch {
    return { strategies: [defaultStrategy()], error: "Les stratégies locales sont illisibles ou le stockage est inaccessible. Une stratégie par défaut est chargée ; rien ne sera écrasé avant un enregistrement explicite." };
  }
}
export function saveStrategies(strategies: Strategy[]) {
  localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(z.array(strategySchema).min(1).parse(strategies)));
}
export function describeCondition(rule: Condition) {
  return `${FIELD_LABELS[rule.left]} ${OPERATOR_LABELS[rule.operator]} ${rule.rightType === "field" ? FIELD_LABELS[rule.rightField] : rule.value}`;
}
