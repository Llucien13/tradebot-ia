import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = process.cwd();
const vite = await createServer({
  configFile: false,
  root,
  resolve: { alias: { "@": path.join(root, "src") } },
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const [paper, strategies, risk, cloudState, cloudApi] = await Promise.all([
    vite.ssrLoadModule("/src/lib/paper/model.ts"),
    vite.ssrLoadModule("/src/lib/strategies.ts"),
    vite.ssrLoadModule("/src/lib/paper/risk-manager.ts"),
    vite.ssrLoadModule("/server/utils/cloud-paper-state.ts"),
    vite.ssrLoadModule("/server/utils/cloud-paper.ts"),
  ]);
  let assertions = 0;
  const check = (condition, message) => {
    assert.ok(condition, message);
    assertions++;
  };
  const accountInput = {
    spread: 0.3,
    slippage: 0.1,
    commission: 0.2,
    contractSize: 100,
    minLot: 0.01,
    lotStep: 0.01,
    leverage: 20,
  };
  const strategy = strategies.defaultStrategy();
  strategy.enabled = true;
  const now = 1_800_000_000_000;
  const state = cloudState.createCloudPaperInitialState(accountInput, strategy, { rate: 1.1, timestamp: now }, now);

  check(paper.paperCapitalSchema.safeParse(20000).success && paper.paperCapitalSchema.safeParse(45000).success, "Only the primary and explicitly offered alternate capitals are selectable in Cloud setup.");
  check(!paper.paperCapitalSchema.safeParse(30000).success, "Cloud setup rejects unoffered capital choices.");
  check(state.account.initialCapital === 20000, "New cloud account defaults to EUR 20,000.");
  check(state.cash === 20000 && state.equity[0].equity === 20000, "Initial cash/equity must match the default capital.");
  check(state.running === false && state.position === null && state.pending === null, "Cloud account creation must leave the engine stopped.");
  check(paper.paperStateSchema.safeParse(state).success, "Initial cloud state must match the persisted PAPER schema.");
  assertions++;

  const alternateState = cloudState.createCloudPaperInitialState({ ...accountInput, initialCapital: 45000 }, strategy, { rate: 1.1, timestamp: now }, now);
  check(alternateState.account.initialCapital === 45000 && alternateState.cash === 45000, "EUR 45,000 remains selectable for a separate cloud account.");
  const size = risk.allocatePaperPosition(state.account, 20000, 2000, 5, 0.5);
  check(!size.error && size.riskMoney <= 100, "Position sizing uses the selected EUR 20,000 capital and caps risk at EUR 100.");
  const alternateSize = risk.allocatePaperPosition(alternateState.account, 45000, 2000, 5, 0.5);
  check(!alternateSize.error && alternateSize.riskMoney <= 225, "Alternate-account position sizing uses EUR 45,000 and caps risk at EUR 225.");

  const validRow = {
    user_id: "00000000-0000-4000-8000-000000000001",
    revision: 0,
    state,
    strategy,
    running: false,
    updated_at: new Date(now).toISOString(),
  };
  check(cloudApi.validateCloudPaperRow(validRow).state.account.initialCapital === 20000, "Cloud storage preserves existing EUR 20,000 accounts.");
  const alternateRow = { ...validRow, state: alternateState };
  check(cloudApi.validateCloudPaperRow(alternateRow).state.account.initialCapital === 45000, "Cloud storage preserves separately selected EUR 45,000 accounts.");

  const feed = { source: "TWELVE_DATA", fetchedAt: now, series: {
    "1h": [{ time: now - 60 * 60 * 1000, open: 1, high: 2, low: 0.5, close: 1.5 }],
    "4h": [{ time: now - 4 * 60 * 60 * 1000, open: 1, high: 2, low: 0.5, close: 1.5 }],
  } };
  check(cloudState.cloudPaperFeedFreshness(feed, now).fresh, "A recently closed hourly bar is accepted.");
  check(!cloudState.cloudPaperFeedFreshness(feed, now - 60 * 60 * 1000 - 1).fresh, "A future hourly close is rejected.");
  check(!cloudState.cloudPaperFeedFreshness(feed, now + 8 * 60 * 60 * 1000).fresh, "Stale market data is rejected.");

  const signal = {
    id: "signal-1",
    source: "TWELVE_DATA",
    version: strategy.id,
    timeframe: "1h",
    time: now - 60 * 60 * 1000,
    observedAt: now,
    direction: "WAIT",
    confidence: 0,
    buy: [],
    sell: [],
    buyConfidence: 0,
    sellConfidence: 0,
    reasons: [],
    execution: null,
  };
  const next = structuredClone(state);
  next.signals.push(signal);
  const events = cloudState.cloudPaperEventsForCycle(state, next);
  check(events.length === 1 && events[0].event_id === "signal:signal-1", "New signals produce one stable journal event.");
  check(cloudState.cloudPaperEventsForCycle(next, next).length === 0, "Committed signals are not journaled twice.");

  process.env.CRON_SECRET = "unit-test-cron-secret";
  process.env.SUPABASE_URL = "https://cloud-paper.test";
  process.env.SUPABASE_ANON_KEY = "unit-test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service";
  check((await cloudApi.verifyCronRequest("Bearer unit-test-cron-secret")).url === "https://cloud-paper.test", "Only the configured cron secret can authorize the worker.");
  let rejectedCron = false;
  try { await cloudApi.verifyCronRequest("Bearer wrong-secret"); } catch (error) { rejectedCron = error.statusCode === 401; }
  check(rejectedCron, "An invalid cron secret is rejected.");

  const migration = await readFile(path.join(root, "supabase/migrations/202611150001_cloud_paper.sql"), "utf8");
  check(migration.includes("enable row level security") && migration.includes("auth.uid() = user_id"), "Database migration enables per-user RLS.");
  check(migration.includes("for update") && migration.includes("on conflict (user_id, event_id) do nothing"), "Cycle persistence is revision-locked and idempotent.");

  const cloudSources = [
    "server/utils/cloud-paper.ts",
    "server/utils/cloud-paper-state.ts",
    "server/routes/api/cloud-paper/control.post.ts",
    "server/routes/api/cloud-paper/cycle.get.ts",
  ];
  const sourceText = (await Promise.all(cloudSources.map(file => readFile(path.join(root, file), "utf8")))).join("\n");
  check(!/\b(?:order_send|order_send_async|mt5\.order_send|trade\.buy|trade\.sell)\b/i.test(sourceText), "Cloud PAPER modules contain no order-submission API.");
  console.log(`Cloud PAPER checks passed: ${assertions} assertions.`);
} finally {
  await vite.close();
}
