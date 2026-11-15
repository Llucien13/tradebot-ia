import { z } from "zod";
import { availableResults, encodeBackup, listBackups, readBackup } from "@/lib/backup";
import type { MT5History } from "@/lib/mt5-data";

export const recordedScalpingSchema = z.object({
  settings: z.object({ initialCapital: z.number().finite().positive(), start: z.number().finite(), end: z.number().finite(), spread: z.number().finite().nonnegative(), slippage: z.number().finite().nonnegative(), commission: z.number().finite().nonnegative() }).passthrough(),
  stats: z.object({ finalCapital: z.number().finite(), netPnl: z.number().finite() }).passthrough(),
  history: z.object({ source: z.enum(["MT5", "TWELVE_DATA"]) }).passthrough(),
  controls: z.object({ buySignals: z.number().int().nonnegative(), sellSignals: z.number().int().nonnegative() }).passthrough(),
  trades: z.array(z.object({ direction: z.enum(["BUY", "SELL"]), entry: z.number().finite().positive(), exit: z.number().finite().positive(), initialSL: z.number().finite().positive(), initialTP: z.number().finite().positive(), entryTime: z.number().finite(), exitTime: z.number().finite(), signalTime: z.number().finite(), quantity: z.number().finite().positive(), commission: z.number().finite().nonnegative(), pnl: z.number().finite(), riskMoney: z.number().finite().positive() }).passthrough()),
  bursts: z.array(z.object({ committedRisk: z.number().finite().nonnegative(), budget: z.number().finite().nonnegative(), positions: z.number().int().positive() }).passthrough()),
  scalping: z.record(z.unknown()), engineVersion: z.string().optional(),
}).passthrough();
export type RecordedScalping = z.infer<typeof recordedScalpingSchema>;

export function auditRecordedScalping(result: RecordedScalping): string[] {
  const errors: string[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  let pnl = 0;
  for (const trade of result.trades) {
    const sign = trade.direction === "BUY" ? 1 : -1;
    pnl += trade.pnl;
    if (!near(trade.pnl, sign * (trade.exit - trade.entry) * trade.quantity - trade.commission)) errors.push("PnL/frais incohérents");
    if (sign * (trade.entry - trade.initialSL) <= 0 || sign * (trade.initialTP - trade.entry) <= 0) errors.push("SL/TP du mauvais côté");
    if (trade.entryTime !== trade.signalTime || trade.exitTime < trade.entryTime) errors.push("Horodatage d’entrée/sortie incohérent");
    if (!near(trade.commission, 2 * trade.quantity * result.settings.commission)) errors.push("Commission aller-retour incohérente");
    const stopRisk = trade.quantity * (Math.abs(trade.entry - trade.initialSL) + result.settings.slippage + 2 * result.settings.commission);
    if (!near(stopRisk, trade.riskMoney)) errors.push("Risque au stop incohérent");
  }
  if (!near(pnl, result.stats.netPnl) || !near(result.settings.initialCapital + pnl, result.stats.finalCapital)) errors.push("Capital final/PnL incohérents");
  if (result.bursts.some(b => b.committedRisk > b.budget + 1e-6)) errors.push("Risque cumulé supérieur au budget de salve");
  return [...new Set(errors)];
}

export async function readScalpingEvidence() {
  const captures = availableResults();
  let history: MT5History | null = null;
  const warnings: string[] = [];
  const seen = new Set(captures.map(c => `${c.kind}:${encodeBackup(c.payload)}`));
  for (const entry of await listBackups()) {
    try {
      const snapshot = await readBackup(entry.id);
      if (!history && snapshot.mt5) history = snapshot.mt5;
      for (const capture of snapshot.results) {
        const key = `${capture.kind}:${encodeBackup(capture.payload)}`;
        if (!seen.has(key)) { seen.add(key); captures.push(capture); }
      }
    } catch { warnings.push("Une copie de sauvegarde est illisible : elle n’a pas été utilisée."); }
  }
  const results = captures.filter(c => c.kind === "backtest-scalping").map(c => {
    const parsed = recordedScalpingSchema.safeParse(c.payload);
    if (!parsed.success) { warnings.push("Un résultat Scalping est incomplet : Non disponible."); return null; }
    return { capturedAt: c.capturedAt, result: parsed.data, issues: auditRecordedScalping(parsed.data) };
  }).filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return { results, history, captures, warnings: [...new Set(warnings)] };
}

function runSignature(settings: object, config: object | undefined) {
  return JSON.stringify({ settings, config }, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}
const runSchema = z.object({ kind: z.enum(["backtest-scalping", "optimization"]), source: z.enum(["MT5", "TWELVE_DATA"]), start: z.number().finite(), end: z.number().finite(), signature: z.string() });
const RUN_KEY = "tradebot.scalping.runs.v2";
export async function reserveScalpingRun(kind: "backtest-scalping" | "optimization", source: "MT5" | "TWELVE_DATA", settings: { start: number; end: number }, config: object) {
  if (!navigator.locks) throw new Error("Verrouillage indisponible : calcul bloqué pour éviter une répétition entre onglets.");
  return navigator.locks.request("tradebot-scalping-runs", { mode: "exclusive" }, async () => {
    const evidence = await readScalpingEvidence();
    if (evidence.warnings.length) throw new Error("Inventaire des anciens calculs incomplet : nouveau calcul bloqué par prudence.");
    const signature = runSignature(settings, config);
    const legacySignature = encodeBackup({ settings, config });
    const raw = localStorage.getItem(RUN_KEY);
    const runs = raw ? z.array(runSchema).parse(JSON.parse(raw)) : [];
    const overlap = (start: number, end: number) => start < settings.end && end > settings.start;
    const recorded = evidence.captures.some(c => {
      if (c.kind !== kind) return false;
      const parsed = z.object({ settings: z.object({ start: z.number(), end: z.number() }).passthrough(), source: z.string().optional(), history: z.object({ source: z.string() }).passthrough().optional(), scalping: z.record(z.unknown()).optional() }).passthrough().safeParse(c.payload);
      if (!parsed.success) throw new Error("Ancien calcul illisible : répétition impossible à exclure.");
      const p = parsed.data;
      if ((p.source ?? p.history?.source) !== source) return false;
      return kind === "optimization" ? overlap(p.settings.start, p.settings.end)
        : runSignature(p.settings, p.scalping) === signature;
    });
    if (recorded || runs.some(r => r.kind === kind && r.source === source && (kind === "optimization" ? overlap(r.start, r.end) : r.signature === signature || r.signature === legacySignature))) {
      throw new Error(kind === "optimization" ? "Historique déjà utilisé pour une optimisation. Nouvelle recherche bloquée : validation indépendante nécessaire." : "Ce backtest a déjà été effectué ou réservé. Consultez le résultat enregistré ; aucune relance.");
    }
    // A cancelled/failed reservation remains used: repeated searches cannot masquerade as fresh evidence.
    localStorage.setItem(RUN_KEY, JSON.stringify([...runs, { kind, source, start: settings.start, end: settings.end, signature }]));
  });
}
