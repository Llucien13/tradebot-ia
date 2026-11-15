import { NY_CALENDAR, observedClosed, type M5Calendar } from "./m5-calendar";

// Explicit reference schedule, not a broker-provided calendar: Gold pause 17–18 New York,
// weekend Friday 17:00 through Sunday 18:00. Unknown holidays remain anomalies.
export type M5GapKind = "continuous" | "scheduled-close" | "anomaly";
const nyClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23" });
function scheduledClosed(time: number) {
  const parts = nyClock.formatToParts(time);
  const day = parts.find(p => p.type === "weekday")!.value;
  const hour = Number(parts.find(p => p.type === "hour")!.value);
  return day === "Sat" || day === "Fri" && hour >= 17 || day === "Sun" && hour < 18 || day !== "Sun" && hour === 17;
}
export function classifyM5Gap(previousTime: number, nextTime: number, step = 300000, calendar: M5Calendar = NY_CALENDAR): M5GapKind {
  if (nextTime === previousTime + step) return "continuous";
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime) || nextTime <= previousTime || previousTime % step || nextTime % step || nextTime - previousTime > 4 * 86400000) return "anomaly";
  // Inspect every absent five-minute slot, including partial M15 intervals.
  for (let time = previousTime + step; time < nextTime; time += 300000) {
    if (!(calendar.kind === "gold-ny-reference" ? scheduledClosed(time) : observedClosed(time, calendar))) return "anomaly";
  }
  return "scheduled-close";
}
export const M5_SESSION_POLICY = "gold-ny-17-18-weekend-v1";
export const M5_ENGINE_LABELS = {
  "m5-independent-1": "V1 historique — comparaison uniquement",
  "m5-session-continuity-2": "M5 corrigé V2 · continuité des séances (PAPER)",
} as const;
export type M5EngineVersion = keyof typeof M5_ENGINE_LABELS;
