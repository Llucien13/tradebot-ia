import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGoldShadowComparisons,
  detectCandleGaps,
  validateGoldShadowFeed,
  GOLD_SHADOW_TIMEFRAMES,
} from "../src/lib/gold-xauusd-shadow-tracker.ts";
import {
  acquireShadowLock,
  appendShadowEvent,
  createShadowEvent,
  loadShadowJournal,
  resolveShadowPaths,
} from "./gold-xauusd-shadow-journal.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = new URL(process.env.GOLD_SHADOW_BRIDGE_URL ?? "http://127.0.0.1:8765");
const pollMs = Number(process.env.GOLD_SHADOW_POLL_MS ?? 60_000);
const requestTimeoutMs = 10_000;
const count = 2_000;
const maxM15AgeMs = 40 * 60_000;
const configuredJournal = process.env.GOLD_SHADOW_JOURNAL;
const { directory, journalPath, lockPath } = resolveShadowPaths(root, configuredJournal);

if (baseUrl.protocol !== "http:"
  || !["127.0.0.1", "localhost"].includes(baseUrl.hostname)
  || baseUrl.pathname !== "/"
  || baseUrl.search
  || baseUrl.username
  || baseUrl.password) {
  throw new Error("La source Shadow doit être la passerelle HTTP locale; aucun hôte distant n'est autorisé.");
}
if (!Number.isInteger(pollMs) || pollMs < 5_000) {
  throw new Error("GOLD_SHADOW_POLL_MS doit être un entier d'au moins 5000 ms.");
}

await mkdir(directory, { recursive: true });
let lockHandle;
try {
  lockHandle = await acquireShadowLock(lockPath);
} catch (error) {
  if (error?.code === "EEXIST") throw new Error(`Un suivi Shadow détient déjà le verrou ${lockPath}.`);
  throw error;
}

const runId = randomUUID();
let events;
try {
  events = await loadShadowJournal(journalPath);
} catch (error) {
  await lockHandle.close();
  await unlink(lockPath);
  throw error;
}
const knownIds = new Set(events.map(event => event.eventId));
const priorBars = events.filter(event => event.eventType === "BAR_COMPARISON" && Number.isFinite(event.decisionAt));
const priorBaselines = events
  .filter(event => event.eventType === "RECOVERY"
    && event.detail?.action === "INITIAL_BASELINE"
    && Number.isFinite(event.detail?.baselineDecisionAt))
  .map(event => event.detail.baselineDecisionAt);
const persistedDecisionTimes = [...priorBars.map(event => event.decisionAt), ...priorBaselines];
let lastDecisionAt = persistedDecisionTimes.length
  ? persistedDecisionTimes.reduce((latest, time) => Math.max(latest, time), -Infinity)
  : null;
let incidentMessage = null;
let incidentStartedAt = null;
const lastStoredEvent = events[events.length - 1];
if (lastStoredEvent?.eventType === "INTERRUPTION") {
  incidentMessage = String(lastStoredEvent.detail?.message ?? "Incident précédent");
  incidentStartedAt = lastStoredEvent.recordedAt;
}

let stopping = false;
const activeControllers = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    for (const controller of activeControllers) controller.abort();
  });
}

function log(message) {
  process.stdout.write(`${new Date().toISOString()} SHADOW ${message}\n`);
}

async function fetchClosedBars(timeframe) {
  const url = new URL("/candles", baseUrl);
  url.searchParams.set("symbol", "XAUUSD");
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("count", String(count));
  const controller = new AbortController();
  activeControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`GET /candles ${timeframe} a répondu HTTP ${response.status}.`);
    return validateGoldShadowFeed(
      await response.json(),
      timeframe,
      Date.now(),
      timeframe === "M15" ? maxM15AgeMs : null,
    );
  } finally {
    clearTimeout(timeout);
    activeControllers.delete(controller);
  }
}

async function record(type, detail, key, decisionAt = null) {
  const event = createShadowEvent(runId, type, Date.now(), detail, key, decisionAt);
  await appendShadowEvent(journalPath, knownIds, event);
}

async function poll() {
  const feeds = await Promise.all(GOLD_SHADOW_TIMEFRAMES.map(fetchClosedBars));
  const byTimeframe = Object.fromEntries(GOLD_SHADOW_TIMEFRAMES.map((timeframe, index) => [timeframe, feeds[index]]));
  const m15 = byTimeframe.M15.candles;
  if (m15.length < 201 || byTimeframe.M30.candles.length < 5
    || byTimeframe.H4.candles.length < 5 || byTimeframe.D1.candles.length < 5) {
    throw new Error("Historique clôturé insuffisant pour initialiser GOLD M15 et ses confirmations M30/H4/D1.");
  }

  const comparisons = buildGoldShadowComparisons(
    m15,
    byTimeframe.M30.candles,
    byTimeframe.H4.candles,
    byTimeframe.D1.candles,
  );
  const dataHash = createHash("sha256")
    .update(JSON.stringify(GOLD_SHADOW_TIMEFRAMES.map(timeframe => [
      timeframe,
      byTimeframe[timeframe].candles.map(({ time, open, high, low, close }) => [time, open, high, low, close]),
    ])))
    .digest("hex");
  let pending = comparisons.filter(comparison => lastDecisionAt === null || comparison.decisionAt > lastDecisionAt);
  if (lastDecisionAt === null && pending.length > 0) {
    const skipped = pending.length;
    const baselineDecisionAt = pending[pending.length - 1].decisionAt;
    pending = [];
    await record("RECOVERY", {
      action: "INITIAL_BASELINE",
      skippedHistoricalClosedBars: skipped,
      baselineDecisionAt,
      note: "L'historique sert à l'échauffement; les décisions antérieures au démarrage ne sont pas déclarées observées en direct.",
    }, `INITIAL_BASELINE:${baselineDecisionAt}:${dataHash}`);
    lastDecisionAt = baselineDecisionAt;
    log(`amorçage sur la clôture ${new Date(baselineDecisionAt).toISOString()}; anciens signaux ignorés`);
  } else if (lastDecisionAt !== null && pending.length > 0) {
    const first = pending[0].decisionAt;
    if (first - lastDecisionAt > 2 * 15 * 60_000) {
      await record("RECOVERY", {
        action: "RESUME_AFTER_GAP",
        lastPersistedDecisionAt: lastDecisionAt,
        firstAvailableDecisionAt: first,
        elapsedMs: first - lastDecisionAt,
        note: "La disponibilité de toutes les bougies pendant l'interruption n'est pas garantie.",
      }, `RECOVERY:${lastDecisionAt}:${first}`);
    }
  }

  for (const timeframe of GOLD_SHADOW_TIMEFRAMES) {
    for (const gap of detectCandleGaps(byTimeframe[timeframe].candles, timeframe)) {
      if (lastDecisionAt !== null && gap.nextTime < lastDecisionAt) continue;
      const key = `DATA_GAP:XAUUSD:${timeframe}:${gap.previousTime}:${gap.nextTime}`;
      if (!knownIds.has(createShadowEvent(runId, "DATA_GAP", 0, {}, key).eventId)) {
        await record("DATA_GAP", {
          timeframe,
          previousBarTime: gap.previousTime,
          nextBarTime: gap.nextTime,
          elapsedMs: gap.elapsedMs,
          classification: "UNCLASSIFIED_MARKET_CLOSURE_OR_MISSING_QUOTES",
        }, key);
      }
    }
  }

  for (const comparison of pending) {
    const key = `BAR_COMPARISON:XAUUSD:M15:${comparison.decisionAt}`;
    const event = createShadowEvent(runId, "BAR_COMPARISON", Date.now(), {
      datasetSha256: dataHash,
      comparison,
      observationDelayMs: Math.max(0, Date.now() - comparison.decisionAt),
      note: "Le flux expose les bougies clôturées seulement; l'ouverture suivante est donc observée après la clôture de cette bougie.",
      orderTransmission: false,
      paperEngineNotification: false,
    }, key, comparison.decisionAt);
    await appendShadowEvent(journalPath, knownIds, event);
    lastDecisionAt = comparison.decisionAt;
    log(`${new Date(comparison.decisionAt).toISOString()} GOLD=${comparison.gold?.direction ?? "NONE"} GOLD+SMC=${comparison.goldSmc?.direction ?? "NONE"} sizing=${comparison.sizingDecision}`);
  }
}

log(`démarrage run=${runId}; source GET /candles XAUUSD uniquement; journal=${journalPath}`);
try {
  while (!stopping) {
    try {
      await poll();
      if (incidentMessage !== null) {
        await record("RECOVERY", {
          action: "SOURCE_RESTORED",
          previousError: incidentMessage,
          interruptionStartedAt: incidentStartedAt,
        }, `RECOVERY:SOURCE:${incidentStartedAt}:${Date.now()}`);
        log("source restaurée après interruption");
        incidentMessage = null;
        incidentStartedAt = null;
      }
    } catch (error) {
      if (stopping && error?.name === "AbortError") break;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${new Date().toISOString()} SHADOW interruption: ${message}\n`);
      if (message !== incidentMessage) {
        incidentMessage = message;
        incidentStartedAt = Date.now();
        await record("INTERRUPTION", { message }, `INTERRUPTION:${incidentStartedAt}:${message}`);
      }
    }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, pollMs));
  }
} finally {
  await lockHandle.close();
  await unlink(lockPath);
  log("arrêt du suivi SHADOW; aucun changement au processus passerelle.");
}
