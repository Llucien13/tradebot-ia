import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireShadowLock,
  appendShadowEvent,
  createShadowEvent,
  loadShadowJournal,
  resolveShadowPaths,
} from "./gold-xauusd-shadow-journal.mjs";

test("journal append-only reprend les événements une fois et refuse les doublons", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gold-shadow-journal-"));
  try {
    const journalPath = path.join(directory, "shadow.jsonl");
    const ids = new Set();
    const event = createShadowEvent("test-run", "BAR_COMPARISON", 1_000, { signal: null }, "bar:1", 900);
    assert.equal(await appendShadowEvent(journalPath, ids, event), true);
    assert.equal(await appendShadowEvent(journalPath, ids, event), false);
    const restored = await loadShadowJournal(journalPath);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].mode, "SHADOW");
    assert.equal(restored[0].detail.signal, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("journal refuse une ligne corrompue", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gold-shadow-journal-"));
  try {
    const journalPath = path.join(directory, "shadow.jsonl");
    await appendShadowEvent(journalPath, new Set(), createShadowEvent("run", "INTERRUPTION", 1, { message: "x" }, "e1"));
    const { appendFile } = await import("node:fs/promises");
    await appendFile(journalPath, "{broken}\n");
    await assert.rejects(loadShadowJournal(journalPath), /Ligne 2 invalide/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verrou interdit les instances concurrentes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gold-shadow-lock-"));
  const lockPath = path.join(directory, "shadow.lock");
  let handle;
  try {
    handle = await acquireShadowLock(lockPath);
    await assert.rejects(acquireShadowLock(lockPath), { code: "EEXIST" });
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("chemin de journal maintenu dans le dossier dédié", () => {
  const root = path.resolve("C:\\tradebot");
  const paths = resolveShadowPaths(root);
  assert.ok(paths.journalPath.startsWith(paths.directory));
  assert.throws(() => resolveShadowPaths(root, path.join(root, "other.jsonl")), /dossier isolé/);
});
