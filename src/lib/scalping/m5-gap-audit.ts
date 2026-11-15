import type { Candle } from "@/types";
import { classifyM5Gap } from "./m5-sessions";
import { NY_CALENDAR, calendarPolicy, type M5Calendar } from "./m5-calendar";

export function auditM5Gaps(candles: Candle[], start: number, end: number, calendar: M5Calendar = NY_CALENDAR) {
  const rows: { before: number; after: number; elapsed: number; missingDuration: number; missingSlots: number; classification: string; reason: string }[] = [];
  for (let i = 1; i < candles.length; i++) {
    const before = candles[i - 1].time, after = candles[i].time;
    if (after < start || after >= end || after === before + 300000) continue;
    const kind = classifyM5Gap(before, after, 300000, calendar);
    let reason = `Tous les créneaux M5 absents sont dans une fermeture du calendrier ${calendarPolicy(calendar)}.`;
    if (kind === "anomaly") {
      if (!Number.isFinite(before) || !Number.isFinite(after)) reason = "Horodatage non fini.";
      else if (after <= before) reason = "Horodatages non strictement croissants.";
      else if (before % 300000 || after % 300000) reason = "Horodatage non aligné sur M5 UTC.";
      else if (after - before > 4 * 86400000) reason = "Écart supérieur à la limite de quatre jours du classificateur.";
      else {
        for (let slot = before + 300000; slot < after; slot += 300000) {
          // Ask the unchanged classifier about exactly one absent M5 slot.
          if (classifyM5Gap(slot - 300000, slot + 300000, 300000, calendar) === "anomaly") {
            reason = `Créneau absent ${new Date(slot).toISOString()} considéré ouvert par le calendrier ${calendarPolicy(calendar)}.`;
            break;
          }
        }
      }
    }
    rows.push({ before, after, elapsed: after - before, missingDuration: after - before - 300000, missingSlots: (after - before) / 300000 - 1, classification: kind, reason });
  }
  return rows;
}
export function gapDuration(ms: number) {
  const seconds = ms / 1000;
  return `${Math.floor(seconds / 86400)} j ${Math.floor(seconds % 86400 / 3600)} h ${Math.floor(seconds % 3600 / 60)} min ${seconds % 60} s`;
}
