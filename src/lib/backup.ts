import { z } from "zod";
import { mt5HistorySchema } from "@/lib/mt5-data";
import { strategySchema, STRATEGY_STORAGE_KEY, BACKTEST_STORAGE_KEY } from "@/lib/strategies";
import { scalpingSchema, SCALPING_KEY } from "@/lib/scalping/model";

export type CaptureKind = "backtest-h1" | "backtest-scalping" | "optimization";
const captureSchema = z.object({ kind: z.enum(["backtest-h1", "backtest-scalping", "optimization"]), label: z.string(), capturedAt: z.string().datetime(), payload: z.record(z.unknown()) });
export const backupSchema = z.object({
  format: z.literal("tradebot-backup"), version: z.literal(1), id: z.string().uuid(), createdAt: z.string().datetime(),
  codeRevision: z.string(), storage: z.array(z.object({ key: z.string().startsWith("tradebot."), value: z.string() })),
  mt5: mt5HistorySchema.nullable(),
  connection: z.object({ terminalPath: z.string().max(500), symbol: z.string().max(100), startDate: z.string(), endDate: z.string(), warmup: z.union([z.number(), z.nan()]) }),
  results: z.array(captureSchema), limitations: z.array(z.string()),
});
export type BackupSnapshot = z.infer<typeof backupSchema>;
export interface BackupEntry { id: string; createdAt: string; encoded: string }

// JSON normally turns Infinity into null. Preserve it without changing any statistics.
export function encodeBackup(value: unknown): string {
  return JSON.stringify(value, (_key, v) => typeof v === "number" && !Number.isFinite(v)
    ? { $tradebotNumber: Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity" } : v);
}
export function decodeBackup(text: string): unknown {
  return JSON.parse(text, (_key, v) => {
    if (v && typeof v === "object" && Object.keys(v).length === 1 && "$tradebotNumber" in v) {
      if (v.$tradebotNumber === "Infinity") return Infinity;
      if (v.$tradebotNumber === "-Infinity") return -Infinity;
      if (v.$tradebotNumber === "NaN") return NaN;
      throw new Error("Encodage numérique de sauvegarde invalide.");
    }
    return v;
  });
}
const captures = new Map<string, z.infer<typeof captureSchema>>();
const listeners = new Set<() => void>();
let captureVersion = 0;
export const subscribeCaptures = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getCaptureVersion = () => captureVersion;
export const availableResults = () => Array.from(captures.values()).map(v => structuredClone(v));
export function captureResult(kind: CaptureKind, label: string, payload: object) {
  const key = `${kind}:${encodeBackup(payload)}`;
  if (captures.has(key)) return;
  captures.set(key, { kind, label, capturedAt: new Date().toISOString(), payload: structuredClone(payload) as Record<string, unknown> });
  captureVersion++; listeners.forEach(listener => listener());
}
export function collectStorage() {
  const entries: { key: string; value: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("tradebot.")) continue;
    const value = localStorage.getItem(key);
    if (value !== null) entries.push({ key, value });
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("tradebot-safety-backups", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Sauvegarde durable indisponible."));
    request.onblocked = () => reject(new Error("Stockage bloqué par un autre onglet."));
  });
}
async function store<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("snapshots", mode);
      const request = action(transaction.objectStore("snapshots"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || request.error || new Error("Écriture de sauvegarde interrompue."));
      transaction.onerror = () => reject(transaction.error || new Error("Stockage de sauvegarde inaccessible."));
    });
  } finally { db.close(); }
}
export async function listBackups(): Promise<BackupEntry[]> {
  const rows = await store("readonly", s => s.getAll()) as BackupEntry[];
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export type BackupSummary = Pick<BackupEntry, "id" | "createdAt">;
export async function listBackupSummaries(): Promise<BackupSummary[]> {
  const db = await database();
  try {
    const rows = await new Promise<BackupSummary[]>((resolve, reject) => {
      const summaries: BackupSummary[] = [];
      const transaction = db.transaction("snapshots", "readonly");
      const request = transaction.objectStore("snapshots").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as BackupEntry;
        summaries.push({ id: entry.id, createdAt: entry.createdAt });
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(summaries);
      transaction.onerror = () => reject(new Error("Liste des sauvegardes inaccessible. Aucune copie modifiée."));
      transaction.onabort = () => reject(new Error("Lecture des sauvegardes interrompue."));
    });
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally { db.close(); }
}
export async function readBackup(id: string): Promise<BackupSnapshot> {
  const entry = await store("readonly", s => s.get(id)) as BackupEntry | undefined;
  if (!entry) throw new Error("Sauvegarde non disponible.");
  const snapshot = backupSchema.parse(decodeBackup(entry.encoded));
  if (encodeBackup(snapshot) !== entry.encoded) throw new Error("La sauvegarde ne se restaure pas à l’identique.");
  return snapshot;
}
export async function saveBackup(input: BackupSnapshot): Promise<BackupSnapshot> {
  const snapshot = backupSchema.parse(input);
  const encoded = encodeBackup(snapshot);
  await store("readwrite", s => s.add({ id: snapshot.id, createdAt: snapshot.createdAt, encoded }));
  const restored = await readBackup(snapshot.id);
  if (encodeBackup(restored) !== encoded) throw new Error("La relecture diffère des données écrites. Nettoyage interdit.");
  return restored;
}
export async function testRestoration(id: string) {
  const original = await readBackup(id);
  const copy = { ...original, id: crypto.randomUUID() };
  const restored = await saveBackup(copy);
  if (encodeBackup({ ...restored, id: original.id }) !== encodeBackup(original)) throw new Error("Le test de restauration a échoué.");
  // Only the temporary verification copy is deleted, never a user's backup or history.
  await store("readwrite", s => s.delete(copy.id));
  return original;
}
export function restoreConfigurations(snapshot: BackupSnapshot) {
  const keys = [STRATEGY_STORAGE_KEY, BACKTEST_STORAGE_KEY, SCALPING_KEY];
  const entries = snapshot.storage.filter(e => keys.includes(e.key));
  for (const entry of entries) {
    const value: unknown = JSON.parse(entry.value);
    if (entry.key === STRATEGY_STORAGE_KEY) z.array(strategySchema).min(1).parse(value);
    if (entry.key === BACKTEST_STORAGE_KEY) strategySchema.parse(value);
    if (entry.key === SCALPING_KEY) scalpingSchema.parse(value);
  }
  const previous = entries.map(e => ({ key: e.key, value: localStorage.getItem(e.key) }));
  try {
    for (const entry of entries) {
      localStorage.setItem(entry.key, entry.value);
      if (localStorage.getItem(entry.key) !== entry.value) throw new Error("La configuration restaurée diffère de la sauvegarde.");
    }
  } catch (error) {
    for (const entry of previous) { if (entry.value === null) localStorage.removeItem(entry.key); else localStorage.setItem(entry.key, entry.value); }
    throw error;
  }
  return entries.length;
}
export function downloadBackup(snapshot: BackupSnapshot) {
  const url = URL.createObjectURL(new Blob([encodeBackup(snapshot)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `TradeBot-sauvegarde-${snapshot.createdAt.replace(/[:.]/g, "-")}.json`;
  link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
