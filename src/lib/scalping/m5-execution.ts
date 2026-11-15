import { runM5Backtest, validateM5History } from "./m5-engine";
import { runM5SessionBacktest } from "./m5-session-engine";
import { m5EligibilityDiagnostics } from "./m5-diagnostics";
import type { M5EngineVersion } from "./m5-sessions";
import type { M5Config } from "./m5-model";
import type { MT5History } from "@/lib/mt5-data";
import type { BacktestSettings } from "@/lib/backtest/types";
import { validateM5Calendar, type M5Calendar } from "./m5-calendar";

export function selectM5Runner(version: M5EngineVersion) {
  if (version === "m5-independent-1") return runM5Backtest;
  if (version === "m5-session-continuity-2") return runM5SessionBacktest;
  throw new Error("Version M5 absente ou inconnue. Aucun calcul lancé.");
}
export function executeM5(request: { config: M5Config; settings: BacktestSettings; history: MT5History; engineVersion: M5EngineVersion; runId: string; calendar?: M5Calendar; mode?: "PAPER" }, progress: (n: number) => void) {
  const { config, settings, history, engineVersion, runId } = request;
  if (typeof runId !== "string" || !runId) throw new Error("Identifiant d’exécution M5 absent.");
  const run = selectM5Runner(engineVersion);
  const calendar = engineVersion === "m5-session-continuity-2" ? validateM5Calendar(request.calendar, history.symbol) : undefined;
  if (calendar && request.mode !== "PAPER") throw new Error("Le calendrier V2 est réservé au mode PAPER.");
  if (!calendar && request.calendar) throw new Error("Aucun calendrier configurable n’est autorisé pour V1.");
  const startedAt = new Date().toISOString();
  const result = run(config, settings, history, progress, calendar);
  if (result.engineVersion !== engineVersion) throw new Error("Le moteur exécuté ne correspond pas au moteur demandé.");
  return { ...result, calendar, eligibility: m5EligibilityDiagnostics(validateM5History(history).candles, settings.start, result.scalping.m5Profile, engineVersion, calendar), execution: { runId, engineVersion, startedAt, completedAt: new Date().toISOString() } };
}
