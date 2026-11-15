import type { BacktestSettings } from "@/lib/backtest/types";
import type { V3Broker, V3Config } from "./m5-v3-model";

type V3Size = { reason: "RR" | "risk" | "margin" } | { reason: "ok"; entry: number; quantity: number; lots: number; risk: number; margin: number; potentialRR: number };

export function v3Size(open: number, sign: number, sl: number, tp: number, capital: number, config: V3Config, broker: V3Broker, costs: BacktestSettings): V3Size {
  const entry = open + (sign === 1 ? costs.spread : 0) + sign * costs.slippage;
  const stopDistance = sign * (entry - sl), targetDistance = sign * (tp - entry);
  const potentialRR = targetDistance / stopDistance;
  if (stopDistance <= 0 || targetDistance <= 0 || potentialRR < config.minRR || sl <= 0 || tp <= 0) return { reason: "RR" as const };
  // A sell stop is triggered on ASK: reject an already crossed stop at next open.
  const exitQuote = open + (sign === -1 ? costs.spread : 0);
  if (sign * (exitQuote - sl) <= 0) return { reason: "RR" as const };
  const budget = capital * config.riskPercent / 100;
  const lossPerLot = broker.contractSize * (stopDistance + costs.slippage + 2 * costs.commission);
  const cap = Math.min(broker.maxLot, budget / lossPerLot);
  if (cap < broker.minLot) return { reason: "risk" as const };
  const steps = Math.floor((cap - broker.minLot) / broker.lotStep);
  const lots = Number((broker.minLot + steps * broker.lotStep).toFixed(10));
  const risk = lots * lossPerLot, quantity = lots * broker.contractSize, margin = lots * broker.marginPerLotUSD;
  if (!Number.isFinite(risk) || risk > budget + 1e-9 || lots < broker.minLot || lots > broker.maxLot) return { reason: "risk" as const };
  // Reserve estimated immediate spread/slippage liquidation plus both commissions.
  if (margin + quantity * (costs.spread + 2 * costs.slippage + 2 * costs.commission) > capital) return { reason: "margin" as const };
  return { entry, quantity, lots, risk, margin, potentialRR, reason: "ok" };
}
