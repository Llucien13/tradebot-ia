import type { PaperState } from "./model";

export const PAPER_MONTHLY_GOAL = 200;
const DAY = 86400000;

// Read-only reporting: no dependency from the execution engine or Risk Manager.
export function paperMonthlyPerformance(state: PaperState, equity: number | null, now: number) {
  if (!state.account) return null;
  const account = state.account;
  const date = new Date(now);
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const observed = state.equity.filter(p => p.time >= account.createdAt && p.time <= now).sort((a, b) => a.time - b.time);
  const asOf = observed.at(-1)?.time ?? account.createdAt;
  const start = Math.max(monthStart, account.createdAt);
  const closed = state.trades.filter(t => t.exitTime <= asOf);
  const realized = closed.filter(t => t.exitTime >= start && t.exitTime < monthEnd).reduce((sum, t) => sum + t.pnl, 0);
  const spansBoundary = closed.some(t => t.entryTime < monthStart && t.exitTime >= monthStart)
    || !!(state.position && state.position.entryTime < monthStart);
  // A position spanning midnight requires an actual boundary valuation, never an invented price.
  const baseline = account.createdAt >= monthStart ? account.initialCapital
    : spansBoundary ? observed.find(p => p.time === monthStart)?.equity ?? null
    : account.initialCapital + closed.filter(t => t.exitTime < monthStart).reduce((sum, t) => sum + t.pnl, 0);
  const pnl = asOf >= start && equity !== null && baseline !== null ? equity - baseline : null;
  const returnPercent = pnl !== null && baseline !== null && baseline > 0 ? pnl / baseline * 100 : null;
  const progress = pnl === null ? null : Math.max(0, Math.min(100, pnl / PAPER_MONTHLY_GOAL * 100));
  const elapsedDays = Math.max(0, (asOf - account.createdAt) / DAY);
  const closedPnl = closed.reduce((sum, t) => sum + t.pnl, 0);
  // Explicit minimum sample; this is a descriptive linear pace, not a forecast model.
  const enough = elapsedDays >= 7 && closed.length >= 5;
  const projectedMonthly = enough ? closedPnl / elapsedDays * ((monthEnd - monthStart) / DAY) : null;
  return { monthStart, monthEnd, start, asOf, baseline, pnl, returnPercent, realized, progress, elapsedDays,
    closedTrades: closed.length, projectedMonthly,
    missingBoundary: spansBoundary && baseline === null,
    requiredReturn: baseline !== null && baseline > 0 ? PAPER_MONTHLY_GOAL / baseline * 100 : null };
}
