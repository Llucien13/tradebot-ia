import { createError } from "nitro/h3";
import { accountSchema, emptyPaperState, PAPER_DEFAULT_CAPITAL, type PaperAccountInput, type PaperFeed, type PaperState } from "../../src/lib/paper/model";
import type { Strategy } from "../../src/lib/strategies";

export interface CloudPaperEvent {
  event_id: string;
  event_type: "SIGNAL" | "POSITION_OPENED" | "POSITION_CLOSED" | "ENTRY_CANCELLED";
  occurred_at: string;
  payload: unknown;
}

export function createCloudPaperInitialState(
  accountInput: Omit<PaperAccountInput, "initialCapital"> & { initialCapital?: number },
  strategy: Strategy,
  fx: { rate: number; timestamp: number },
  createdAt = Date.now(),
): PaperState {
  if (strategy.timeframes.length !== 2 || !strategy.timeframes.includes("1h") || !strategy.timeframes.includes("4h")) {
    throw createError({ statusCode: 422, statusMessage: "La stratégie Cloud PAPER doit utiliser exactement les unités 1h et 4h." });
  }
  const account = accountSchema.parse({
    ...accountInput,
    initialCapital: accountInput.initialCapital ?? PAPER_DEFAULT_CAPITAL,
    currency: "EUR",
    usdPerEur: fx.rate,
    fxTime: fx.timestamp,
    fxSource: "TWELVE_DATA",
    createdAt,
  });
  const state = emptyPaperState();
  state.account = account;
  state.cash = account.initialCapital;
  state.equity = [{ time: createdAt, equity: account.initialCapital, drawdown: 0 }];
  state.versions = { [strategy.id]: strategy };
  state.currentVersion = strategy.id;
  return state;
}

export function cloudPaperFeedFreshness(feed: PaperFeed, now = Date.now()) {
  const last = feed.series["1h"][feed.series["1h"].length - 1];
  const closedAt = last.time + 60 * 60 * 1000;
  const ageMs = now - closedAt;
  return { fresh: ageMs >= 0 && ageMs <= 6 * 60 * 60 * 1000, closedAt, ageMs };
}

export function cloudPaperEventsForCycle(previous: PaperState, next: PaperState): CloudPaperEvent[] {
  const events: CloudPaperEvent[] = [];
  const knownSignals = new Set(previous.signals.map(signal => signal.id));
  for (const signal of next.signals) {
    if (knownSignals.has(signal.id)) continue;
    events.push({
      event_id: `signal:${signal.id}`,
      event_type: "SIGNAL",
      occurred_at: new Date(signal.time).toISOString(),
      payload: signal,
    });
  }
  if (next.position && next.position.id !== previous.position?.id) {
    events.push({
      event_id: `position-opened:${next.position.id}`,
      event_type: "POSITION_OPENED",
      occurred_at: new Date(next.position.entryTime).toISOString(),
      payload: next.position,
    });
  }
  const knownTrades = new Set(previous.trades.map(trade => trade.positionId));
  for (const trade of next.trades) {
    if (knownTrades.has(trade.positionId)) continue;
    events.push({
      event_id: `position-closed:${trade.positionId}`,
      event_type: "POSITION_CLOSED",
      occurred_at: new Date(trade.exitTime).toISOString(),
      payload: trade,
    });
  }
  return events;
}
