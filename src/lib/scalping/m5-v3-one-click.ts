import { listBackups, readBackup } from "@/lib/backup";
import { readBacktestHistory, saveBacktest } from "@/lib/backtest-history";
import { V3_VERSION, v3Fingerprint, type V3Result } from "./m5-v3-model";
import { sliceV3Period, V3_JULY_PLAN } from "./m5-v3-period";
import { reserveScalpingRun } from "./evidence";
import { recoverV3Inputs } from "./m5-v3-recovery";
import { persistV3Profile, V3MissingInputs } from "./m5-v3-profile";

export async function prepareV3OneClick(activeHistory: unknown) {
  const snapshots: Awaited<ReturnType<typeof readBackup>>[] = [];
  let entries;
  try { entries = await listBackups(); } catch { throw new Error("Stockage des sauvegardes inaccessible. Action : ouvrez cette application dans le navigateur où les historiques ont été sauvegardés, puis réessayez."); }
  for (const entry of entries) {
    try { snapshots.push(await readBackup(entry.id)); } catch { /* An unreadable copy is never used. */ }
  }
  const { config, broker, costs, calendars } = await recoverV3Inputs(snapshots);
  const candidates: unknown[] = [activeHistory, ...snapshots.map(s => s.mt5)].filter(Boolean);
  let development, validation, calendar, lastError = "";
  for (const chosen of calendars) {
  for (const candidate of candidates) {
    const h = candidate as { symbol?: string; interval?: string; coverage?: { requestedStart?: string; requestedEnd?: string } };
    if (h.symbol !== "XAUUSD-ECN" || h.interval !== "5m") continue;
    if (Date.parse(h.coverage?.requestedStart ?? "") > V3_JULY_PLAN.developmentStart || Date.parse(h.coverage?.requestedEnd ?? "") < V3_JULY_PLAN.validationEnd) continue;
    try {
      const d = sliceV3Period(candidate, V3_JULY_PLAN.developmentStart, V3_JULY_PLAN.developmentEnd, chosen);
      const v = sliceV3Period(candidate, V3_JULY_PLAN.validationStart, V3_JULY_PLAN.validationEnd, chosen);
      development = d; validation = v;
      calendar = chosen; break;
    } catch (e) { lastError = e instanceof Error ? e.message : "Historique incompatible."; }
  }
    if (development && validation) break;
  }
  if (!development || !validation || !calendar) {
    if (lastError.includes("Calendrier")) throw new V3MissingInputs(["calendar"]);
    throw new Error(lastError ? `${lastError} Action : dans Voir les détails, chargez une sauvegarde de juillet compatible avec le calendrier enregistré, avec au moins 202 bougies réelles avant le 1er juillet.` : "Historique XAUUSD-ECN M5 de juillet complet introuvable. Dans Voir les détails, importez ou sauvegardez le lot du 1er juillet au 1er août 2026 avec au moins 202 bougies antérieures ; les prochains clics le retrouveront automatiquement.");
  }
  const fingerprint = await v3Fingerprint({ config, broker, calendar, plan: V3_JULY_PLAN, costs });
  const locks: { start: number; end: number; fingerprint: string }[] = JSON.parse(localStorage.getItem("tradebot.scalping.m5.v3.validation-locks") ?? "[]");
  const records = (await readBacktestHistory()).records;
  if (locks.some(l => l.start < V3_JULY_PLAN.validationEnd && l.end > V3_JULY_PLAN.validationStart && l.fingerprint !== fingerprint)
    || records.some(r => { const v = (r.result as unknown as V3Result).v3; return r.result.engineVersion === V3_VERSION && v?.phase === "validation" && v.plan.validationStart < V3_JULY_PLAN.validationEnd && v.plan.validationEnd > V3_JULY_PLAN.validationStart && v.profileFingerprint !== fingerprint; })) throw new Error("La validation de juillet est déjà utilisée avec un autre profil. Profil conservé sans modification ; utilisez une nouvelle période hors échantillon dans le parcours avancé.");
  await persistV3Profile({ config, broker, costs, calendar });
  return { config, broker, calendar, costs, plan: V3_JULY_PLAN, fingerprint, development, validation };
}
export type V3Prepared = Awaited<ReturnType<typeof prepareV3OneClick>>;
export interface V3PhaseResult { result: V3Result; reused: boolean }

export async function runV3OneClick(prepared: V3Prepared, run: (request: object, progress: (n: number) => void) => Promise<V3Result>, report: (percent: number, stage: string) => void, cancelled: () => boolean, onDevelopment: (value: V3PhaseResult) => void) {
  const { config, broker, calendar, costs, plan, fingerprint } = prepared;
  const records = (await readBacktestHistory()).records;
  const locksKey = "tradebot.scalping.m5.v3.validation-locks";
  const locks: { start: number; end: number; fingerprint: string }[] = JSON.parse(localStorage.getItem(locksKey) ?? "[]");
  if (locks.some(l => l.start < plan.validationEnd && l.end > plan.validationStart && l.fingerprint !== fingerprint)
    || records.some(r => {
      const v = (r.result as unknown as V3Result).v3;
      return r.result.engineVersion === V3_VERSION && v?.phase === "validation" && v.plan.validationStart < plan.validationEnd && v.plan.validationEnd > plan.validationStart && v.profileFingerprint !== fingerprint;
    })) throw new Error("La validation de juillet a déjà été utilisée avec un autre profil. Elle ne peut plus servir de validation indépendante de ces paramètres. Action : utilisez le parcours avancé avec une nouvelle période hors échantillon, sans effacer les historiques.");
  const results: V3PhaseResult[] = [];
  for (const [index, phase] of (["development", "validation"] as const).entries()) {
    if (cancelled()) throw new Error("Backtest annulé. Les résultats déjà enregistrés restent conservés.");
    const history = prepared[phase];
    const settings = { ...costs, initialCapital: 300, timeframe: "5m" as const, start: Date.parse(history.coverage.requestedStart), end: Date.parse(history.coverage.requestedEnd) };
    const dataFingerprint = await v3Fingerprint(history.candles);
    const stored = records.find(r => {
      const v = (r.result as unknown as V3Result).v3;
      return r.result.engineVersion === V3_VERSION && v?.phase === phase && v.profileFingerprint === fingerprint && v.dataFingerprint === dataFingerprint && r.result.settings.start === settings.start && r.result.settings.end === settings.end;
    });
    let value: V3PhaseResult;
    if (stored) value = { result: stored.result as unknown as V3Result, reused: true };
    else {
      report(10 + index * 45, phase === "development" ? "Développement · 1–20 juillet" : "Validation indépendante · 21–31 juillet");
      await reserveScalpingRun("backtest-scalping", "MT5", settings, { engineVersion: V3_VERSION, config, broker, calendar, plan, costs, fingerprint, phase, dataFingerprint });
      if (cancelled()) throw new Error("Backtest annulé. Réservation conservée pour éviter une répétition.");
      if (phase === "validation") localStorage.setItem(locksKey, JSON.stringify([...locks, { start: plan.validationStart, end: plan.validationEnd, fingerprint }]));
      const result = await run({ mode: "PAPER", approved: true, runId: crypto.randomUUID(), config, broker, calendar, plan, phase, settings, history, profileFingerprint: fingerprint }, n => report(10 + index * 45 + n * 0.45, phase === "development" ? "Développement · 1–20 juillet" : "Validation indépendante · 21–31 juillet"));
      if (cancelled()) throw new Error("Backtest annulé.");
      if (result.engineVersion !== V3_VERSION || result.v3?.phase !== phase || result.v3.profileFingerprint !== fingerprint || result.v3.dataFingerprint !== dataFingerprint || result.settings.start !== settings.start || result.settings.end !== settings.end) throw new Error("Résultat du moteur V3 incompatible avec la demande : refusé. Action : conservez les données et consultez le diagnostic avancé.");
      await saveBacktest(result, `V3 un clic · juillet 2026 · ${phase === "development" ? "développement" : "validation hors échantillon"}`);
      value = { result, reused: false };
    }
    results.push(value);
    if (phase === "development") onDevelopment(value);
  }
  report(100, "Développement et validation terminés");
  return { development: results[0], validation: results[1] };
}
