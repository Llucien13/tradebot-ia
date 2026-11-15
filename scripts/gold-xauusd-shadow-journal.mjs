import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

export function journalEventId(key) {
  return createHash("sha256").update(key).digest("hex");
}

export async function acquireShadowLock(lockPath) {
  const handle = await open(lockPath, "wx");
  await handle.writeFile(`${JSON.stringify({ mode: "SHADOW", pid: process.pid, startedAt: Date.now() })}\n`);
  await handle.sync();
  return handle;
}

export async function loadShadowJournal(journalPath) {
  let contents;
  try {
    contents = await readFile(journalPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const events = [];
  const ids = new Set();
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Ligne ${index + 1} invalide dans le journal Shadow; reprise refusée.`, { cause: error });
    }
    if (event.version !== 1 || event.mode !== "SHADOW"
      || typeof event.eventId !== "string" || !event.eventId
      || typeof event.eventType !== "string"
      || !Number.isFinite(event.recordedAt)
      || ids.has(event.eventId)) {
      throw new Error(`Événement invalide ou dupliqué à la ligne ${index + 1}; reprise refusée.`);
    }
    ids.add(event.eventId);
    events.push(event);
  }
  return events;
}

export async function appendShadowEvent(journalPath, knownIds, event) {
  if (knownIds.has(event.eventId)) return false;
  const handle = await open(journalPath, "a");
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  knownIds.add(event.eventId);
  return true;
}

export function createShadowEvent(runId, eventType, recordedAt, detail, eventKey, decisionAt = null) {
  return {
    version: 1,
    mode: "SHADOW",
    eventId: journalEventId(eventKey),
    runId,
    eventType,
    recordedAt,
    decisionAt,
    symbol: "XAUUSD",
    timeframe: "M15",
    detail,
  };
}

export function resolveShadowPaths(repositoryRoot, configuredJournalPath) {
  const directory = path.resolve(repositoryRoot, "src", "ftmo", "reference", "resultats", "shadow-xauusd-live");
  const journalPath = configuredJournalPath ? path.resolve(configuredJournalPath) : path.join(directory, "shadow-journal.jsonl");
  if (!journalPath.toLowerCase().startsWith(`${directory.toLowerCase()}${path.sep}`)) {
    throw new Error(`Le journal doit rester sous le dossier isolé ${directory}.`);
  }
  return { directory, journalPath, lockPath: `${journalPath}.lock` };
}
