import { z } from "zod";

export const m5CalendarSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gold-ny-reference") }),
  z.object({ kind: z.literal("xauusd-ecn-observed-utc"), symbol: z.literal("XAUUSD-ECN"), dailyResumeMinute: z.number().int().min(5).max(1435).multipleOf(5), weekendStartDay: z.number().int().min(0).max(6), weekendStartMinute: z.number().int().min(0).max(1435).multipleOf(5), weekendResumeDay: z.number().int().min(0).max(6) }),
]);
export type M5Calendar = { kind: "gold-ny-reference" } | { kind: "xauusd-ecn-observed-utc"; symbol: "XAUUSD-ECN"; dailyResumeMinute: number; weekendStartDay: number; weekendStartMinute: number; weekendResumeDay: number };
export const NY_CALENDAR: M5Calendar = { kind: "gold-ny-reference" };
export const OBSERVED_ECN_CALENDAR: M5Calendar = { kind: "xauusd-ecn-observed-utc", symbol: "XAUUSD-ECN", dailyResumeMinute: 60, weekendStartDay: 6, weekendStartMinute: 0, weekendResumeDay: 1 };
export function validateM5Calendar(value: unknown, symbol?: string): M5Calendar {
  const calendar = m5CalendarSchema.parse(value) as M5Calendar;
  if (calendar.kind === "xauusd-ecn-observed-utc") {
    if (symbol && symbol.toUpperCase() !== calendar.symbol) throw new Error("Ce calendrier observé exige le symbole XAUUSD-ECN.");
    const duration = ((calendar.weekendResumeDay * 1440 + calendar.dailyResumeMinute - calendar.weekendStartDay * 1440 - calendar.weekendStartMinute) + 10080) % 10080;
    if (!duration || duration > 5760) throw new Error("Fermeture hebdomadaire requise, de durée positive et au plus quatre jours.");
  }
  return calendar;
}
export function calendarPolicy(calendar: M5Calendar) {
  return calendar.kind === "gold-ny-reference" ? "gold-ny-17-18-weekend-v1" : `xauusd-ecn-observed-utc-v1:daily-0-${calendar.dailyResumeMinute}:week-${calendar.weekendStartDay}-${calendar.weekendStartMinute}-${calendar.weekendResumeDay}-${calendar.dailyResumeMinute}`;
}
export function observedClosed(time: number, calendar: Extract<M5Calendar, { kind: "xauusd-ecn-observed-utc" }>) {
  const date = new Date(time), minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (minute < calendar.dailyResumeMinute) return true;
  const slot = date.getUTCDay() * 1440 + minute;
  const start = calendar.weekendStartDay * 1440 + calendar.weekendStartMinute;
  const end = calendar.weekendResumeDay * 1440 + calendar.dailyResumeMinute;
  return start < end ? slot >= start && slot < end : slot >= start || slot < end;
}
