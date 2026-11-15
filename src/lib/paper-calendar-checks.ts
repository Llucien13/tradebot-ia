import { calendarGrid, mondayOfCalendarWeek, parisDateKey, parisMidnightEpoch, shiftCalendarDay, summarizeCalendarTrades, type CalendarTrade } from "./paper-calendar.ts";

export function checkPaperCalendar() {
  let assertions = 0;
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(`Calendrier PAPER : ${label}`);
    assertions++;
  };
  const trade = (id: string, exitTime: number, pnl: number): CalendarTrade => ({ id, trade: { entryTime: exitTime - 900, exitTime, entry: 2000, exit: 2001, side: 1, lots: 0.01, pnl } });
  const parisMidnight = parisMidnightEpoch("2026-03-29");
  check(new Date(parisMidnight * 1000).toISOString() === "2026-03-28T23:00:00.000Z", "minuit Europe/Paris avant bascule été");
  check(parisDateKey(parisMidnight + 1800) === "2026-03-29", "date de clôture Europe/Paris");
  check(shiftCalendarDay("2026-03-29", 1) === "2026-03-30", "jour suivant indépendant du fuseau système");
  check(mondayOfCalendarWeek("2026-11-15") === "2026-11-09", "semaine lundi-dimanche");
  const grid = calendarGrid("2026-11");
  check(grid.weeks.every(week => week.length === 7) && grid.weeks[0][0] === "2026-10-26", "grille complète par semaines");
  const closeA = parisMidnightEpoch("2026-03-29") + 1800;
  const closeB = parisMidnightEpoch("2026-03-30") + 1800;
  const summary = summarizeCalendarTrades([
    trade("same-id", closeA, 120), trade("same-id", closeA, 120), trade("loss", closeA + 60, -35),
    trade("next-day", closeB, 10), { ...trade("unknown-pnl", closeB + 60, 99), trade: { ...trade("unknown-pnl", closeB + 60, 99).trade, pnl: undefined } },
    { ...trade("open", closeA, 99), trade: { ...trade("open", closeA, 99).trade, exitTime: undefined } },
  ], "2026-03-29", "2026-03-30");
  check(summary.days["2026-03-29"].count === 2 && summary.days["2026-03-29"].pnl === 85, "doublons exclus et P&L net journalier agrégé");
  check(summary.days["2026-03-30"].count === 2 && summary.days["2026-03-30"].pnl === null && summary.weeks["2026-03-23"].count === 2 && summary.weeks["2026-03-30"].count === 2, "clôture sans P&L conservée et affectée à sa semaine locale");
  check(!summary.days["2026-03-29"].trades.some(item => item.id === "open"), "positions non clôturées exclues");
  return { passed: true, assertions, noTradesExecuted: true };
}