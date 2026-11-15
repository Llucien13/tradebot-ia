export interface CalendarTrade {
  id: string;
  trade: {
    entryTime: number;
    exitTime?: number;
    entry: number;
    exit?: number;
    side: 1 | -1;
    lots: number;
    pnl?: number;
    reason?: string;
  };
}

export interface CalendarDay {
  trades: CalendarTrade[];
  count: number;
  pnl: number | null;
}

export const PARIS_TIME_ZONE = "Europe/Paris";
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARIS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function parisDateKey(timestampSeconds: number): string {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(timestampSeconds * 1000)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftCalendarDay(dayKey: string, offset: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function mondayOfCalendarWeek(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftCalendarDay(dayKey, -((weekday + 6) % 7));
}

export function parisMidnightEpoch(dayKey: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: PARIS_TIME_ZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(candidate)).map(part => [part.type, Number(part.value)]));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const correction = target - represented;
    candidate += correction;
    if (correction === 0) break;
  }
  return candidate / 1000;
}

export function calendarGrid(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = `${monthKey}-01`;
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekCount = Math.ceil((offset + dayCount) / 7);
  const start = shiftCalendarDay(firstDay, -offset);
  const days = Array.from({ length: weekCount * 7 }, (_, index) => shiftCalendarDay(start, index));
  return { days, weeks: Array.from({ length: weekCount }, (_, index) => days.slice(index * 7, index * 7 + 7)), start, end: days[days.length - 1] };
}

export function summarizeCalendarTrades(items: CalendarTrade[], startDay: string, endDay: string) {
  const unique = new Map<string, CalendarTrade>();
  for (const item of items) {
    if (!unique.has(item.id) && Number.isFinite(item.trade.exitTime)) unique.set(item.id, item);
  }
  const days: Record<string, CalendarDay> = {};
  const weeks: Record<string, CalendarDay> = {};
  const sorted = [...unique.values()].sort((a, b) => a.trade.exitTime! - b.trade.exitTime! || a.id.localeCompare(b.id));
  for (const item of sorted) {
    const day = parisDateKey(item.trade.exitTime!);
    if (day < startDay || day > endDay) continue;
    const week = mondayOfCalendarWeek(day);
    for (const [bucket, key] of [[days, day], [weeks, week]] as const) {
      const current = bucket[key] ?? { trades: [], count: 0, pnl: 0 };
      current.trades.push(item);
      current.count++;
      current.pnl = current.pnl === null || !Number.isFinite(item.trade.pnl) ? null : current.pnl + item.trade.pnl!;
      bucket[key] = current;
    }
  }
  return { days, weeks };
}