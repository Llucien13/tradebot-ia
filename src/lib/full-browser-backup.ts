import { availableResults, collectStorage, decodeBackup, encodeBackup } from "./backup";

const DATABASES = ["tradebot-backtest-history", "tradebot-safety-backups"];
interface StoreCopy {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
  keys: IDBValidKey[];
  values: unknown[];
}
interface DatabaseCopy { name: string; exists: boolean; version: number; stores: StoreCopy[] }

async function openExisting(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => { request.transaction?.abort(); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`Lecture de ${name} impossible. Export interrompu, aucune base remplacée.`));
    request.onblocked = () => reject(new Error(`Base ${name} bloquée : fermez les autres onglets de l’application.`));
  });
}

async function copyDatabases(): Promise<DatabaseCopy[]> {
  if (!indexedDB.databases) throw new Error("Ce navigateur ne permet pas l’inventaire IndexedDB. Utilisez l’aperçu local Chromium de Dyad.");
  const inventory = await indexedDB.databases();
  const unknown = inventory.filter(d => d.name?.startsWith("tradebot") && !DATABASES.includes(d.name) && !d.name.startsWith("tradebot-backup-verification-"));
  if (unknown.length) throw new Error(`Bases TradeBot supplémentaires non couvertes : ${unknown.map(d => d.name).join(", ")}. Aucun export présenté comme complet.`);
  const copies: DatabaseCopy[] = [];
  for (const name of DATABASES) {
    if (!inventory.some(d => d.name === name)) { copies.push({ name, exists: false, version: 0, stores: [] }); continue; }
    const db = await openExisting(name);
    try {
      const stores: StoreCopy[] = [];
      const names = Array.from(db.objectStoreNames);
      if (names.length) await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(names, "readonly");
        for (const name of names) {
          const store = transaction.objectStore(name);
          const copy: StoreCopy = { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
            indexes: Array.from(store.indexNames).map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; }), keys: [], values: [] };
          stores.push(copy);
          const keys = store.getAllKeys(), values = store.getAll();
          keys.onsuccess = () => { copy.keys = keys.result; };
          values.onsuccess = () => { copy.values = values.result; };
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error(`Export ${name} incomplet.`));
        transaction.onabort = () => reject(new Error(`Lecture ${name} interrompue.`));
      });
      copies.push({ name, exists: true, version: db.version, stores });
    } finally { db.close(); }
  }
  return copies;
}

function requirePortable(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return;
  if (Array.isArray(value)) { value.forEach(requirePortable); return; }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) { Object.values(value).forEach(requirePortable); return; }
  throw new Error("Une valeur IndexedDB ne peut pas être restaurée fidèlement en JSON. Export interrompu, aucune donnée ignorée.");
}

async function verifyCopy(copies: DatabaseCopy[]) {
  const name = `tradebot-backup-verification-${crypto.randomUUID()}`;
  let db: IDBDatabase | null = null;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        for (const database of copies) for (const store of database.stores) {
          const target = request.result.createObjectStore(`${database.name}::${store.name}`, { keyPath: store.keyPath, autoIncrement: store.autoIncrement });
          for (const index of store.indexes) target.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Création de la copie de vérification impossible."));
    });
    for (const database of copies) for (const store of database.stores) {
      const storeName = `${database.name}::${store.name}`;
      await new Promise<void>((resolve, reject) => {
        const transaction = db!.transaction(storeName, "readwrite");
        const target = transaction.objectStore(storeName);
        store.values.forEach((value, i) => { if (store.keyPath === null) target.add(value, store.keys[i]); else target.add(value); });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error("Restauration de copie interrompue."));
        transaction.onabort = () => reject(new Error("Restauration de copie annulée."));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db!.transaction(storeName, "readonly");
        const target = transaction.objectStore(storeName), keys = target.getAllKeys(), values = target.getAll();
        transaction.oncomplete = () => {
          if (encodeBackup(keys.result) !== encodeBackup(store.keys) || encodeBackup(values.result) !== encodeBackup(store.values)) reject(new Error("La restauration des données diffère de l’original. Export interdit."));
          else resolve();
        };
        transaction.onerror = () => reject(new Error("Relecture de copie impossible."));
      });
    }
  } finally {
    db?.close();
    // Only this newly created scratch copy is removed, never a user database.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error("La copie temporaire n’a pas pu être nettoyée."));
      request.onblocked = () => reject(new Error("Copie temporaire bloquée. Aucun effacement des données originales."));
    });
  }
}

export async function exportFullBrowserBackup(sessions: unknown) {
  const storage = collectStorage();
  const databases = await copyDatabases();
  requirePortable(databases);
  const restored = decodeBackup(encodeBackup(databases)) as DatabaseCopy[];
  await verifyCopy(restored);
  if (encodeBackup(await copyDatabases()) !== encodeBackup(databases) || encodeBackup(collectStorage()) !== encodeBackup(storage)) throw new Error("Les données ont changé pendant la copie. Fermez les autres onglets, laissez les bots arrêtés puis réessayez.");
  const payload = { format: "tradebot-browser-full", version: 1, createdAt: new Date().toISOString(), origin: location.origin,
    cloneVerified: true, storage, databases, sessions, accessibleResults: availableResults(),
    limitations: ["Les résultats jamais enregistrés et déjà perdus ne sont pas récupérables.", "Le registre FTMO Windows et les sources doivent être ajoutés par l’utilitaire de sauvegarde externe."] };
  const text = encodeBackup(payload);
  if (encodeBackup(decodeBackup(text)) !== text) throw new Error("L’export JSON ne se restaure pas à l’identique.");
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `TradeBot-navigateur-complet-${payload.createdAt.replace(/[:.]/g, "-")}.json`; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
