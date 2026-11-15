import { availableResults, decodeBackup, encodeBackup, listBackupSummaries, readBackup, type CaptureKind } from "./backup";
import type { BacktestResult } from "./backtest/types";
import type { M5Calendar } from "./scalping/m5-calendar";

export type StoredResult = Omit<BacktestResult, "history"> & { engineVersion?: string; calendar?: M5Calendar; history: Omit<BacktestResult["history"], "source"> & { source: "TWELVE_DATA" | "MT5"; symbol?: string }; scalping?: { timeframe: string; m5Profile?: Record<string, unknown> } };
export interface HistoryRecord { id: string; strategy: "M1" | "M5" | "H1" | "Autre"; label: string; savedAt: string; result: StoredResult; origin: string }
interface Entry { id: string; encoded: string }

export function isStoredResult(value: unknown): value is StoredResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<StoredResult>;
  return !!r.settings && !!r.stats && !!r.strategy && !!r.history && !!r.controls && Array.isArray(r.trades) && Array.isArray(r.equity)
    && typeof r.settings.start === "number" && typeof r.settings.end === "number" && typeof r.settings.timeframe === "string"
    && typeof r.stats.netPnl === "number" && typeof r.stats.finalCapital === "number";
}
export function strategyOf(result: StoredResult): HistoryRecord["strategy"] {
  if (result.scalping) return result.settings.timeframe === "5m" ? "M5" : result.settings.timeframe === "1m" ? "M1" : "Autre";
  return result.settings.timeframe === "1h" ? "H1" : "Autre";
}
async function access<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("tradebot-backtest-history", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("results", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Historique durable inaccessible."));
    request.onblocked = () => reject(new Error("Historique bloqué par un autre onglet."));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("results", mode);
      const request = operation(transaction.objectStore("results"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(new Error("Écriture ou lecture de l’historique impossible."));
      transaction.onabort = () => reject(new Error("Opération d’historique interrompue."));
    });
  } finally { db.close(); }
}
export async function saveBacktest(result: StoredResult, label: string) {
  const record: HistoryRecord = { id: crypto.randomUUID(), strategy: strategyOf(result), label: label.trim() || result.strategy.name, savedAt: new Date().toISOString(), result: structuredClone(result), origin: "Enregistrement explicite" };
  await access("readwrite", store => store.add({ id: record.id, encoded: encodeBackup(record) }));
  const entry = await access("readonly", store => store.get(record.id)) as Entry;
  if (!entry || entry.encoded !== encodeBackup(record)) throw new Error("Vérification de l’enregistrement impossible.");
  return record;
}
export async function readBacktestHistory(): Promise<{ records: HistoryRecord[]; warnings: string[] }> {
  const records: HistoryRecord[] = [], warnings: string[] = [];
  const seen = new Set<string>();
  const add = (record: HistoryRecord) => {
    const key = encodeBackup(record.result);
    if (!seen.has(key)) { seen.add(key); records.push(record); }
  };
  try {
    const entries = await access("readonly", store => store.getAll()) as Entry[];
    for (const entry of entries) {
      try { const record = decodeBackup(entry.encoded) as HistoryRecord; if (!isStoredResult(record.result)) throw new Error(); add(record); }
      catch { warnings.push(`Résultat conservé mais illisible : ${entry.id}. Aucun remplacement.`); }
    }
  } catch { warnings.push("Les enregistrements durables ne sont pas accessibles dans ce navigateur."); }
  const addCapture = (kind: CaptureKind, label: string, capturedAt: string, payload: unknown, id: string, origin: string) => {
    if (kind === "optimization") return;
    if (isStoredResult(payload)) add({ id, strategy: strategyOf(payload), label, savedAt: capturedAt, result: payload, origin });
    else warnings.push(`${label} : contenu conservé mais non compatible avec cette vue.`);
  };
  try {
    for (const entry of await listBackupSummaries()) {
      try {
        const snapshot = await readBackup(entry.id);
        snapshot.results.forEach((result, index) => addCapture(result.kind, result.label, result.capturedAt, result.payload, `${entry.id}:${index}`, "Sauvegarde existante"));
      } catch { warnings.push(`Sauvegarde ${entry.id.slice(0, 8)} inaccessible ; elle n’a pas été supprimée.`); }
    }
  } catch { warnings.push("Sauvegardes IndexedDB inaccessibles. Aucune récupération inventée."); }
  availableResults().forEach((result, index) => addCapture(result.kind, result.label, result.capturedAt, result.payload, `session:${index}`, "Session actuelle · exporter ou enregistrer"));
  warnings.push("Les anciens résultats non sauvegardés avant fermeture ne sont plus accessibles. Les rapports d’optimisation restent dans les sauvegardes ; aucun test n’est relancé.");
  return { records: records.sort((a, b) => b.savedAt.localeCompare(a.savedAt)), warnings };
}
