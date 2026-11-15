import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildArchivedGoldSignals,
  buildHistoricalVariantCandidates,
  GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS,
} from "../src/lib/gold-smc-fib-historical.ts";
import { analyzeExperimentalGoldSmcFib } from "../src/lib/gold-smc-fib-experimental.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = path.join(root, "src", "ftmo", "reference", "TradeBot_FTMO_20K_EUR_Backtest_PAPER_2025_2026.zip");
const priorResultsPath = path.join(
  root,
  "src",
  "ftmo",
  "reference",
  "resultats",
  "simulation-experimentale-20261113",
  "gold-smc-fibonacci-results.json",
);
const outputDirectory = path.join(
  root,
  "src",
  "ftmo",
  "reference",
  "resultats",
  "simulation-reconciliation-20261114",
);
const intervalMs = 15 * 60 * 1000;
const lotStep = 0.01;
const initialBalanceEUR = 20_000;
const leverageScenario = 20;

const extractPython = String.raw`
import csv, datetime, hashlib, io, json, math, pathlib, sys, zipfile
archive = pathlib.Path(sys.argv[1])
raw = archive.read_bytes()
z = zipfile.ZipFile(io.BytesIO(raw))
bad = z.testzip()
if bad:
    raise RuntimeError("Archive CRC invalide: " + bad)
files = {}
for name in ("lab/donnees/m15.csv", "lab/donnees/m30.csv", "lab/donnees/h4.csv", "lab/donnees/d1.csv"):
    data = z.read(name)
    rows = list(csv.DictReader(io.TextIOWrapper(io.BytesIO(data), encoding="utf-8-sig"), delimiter="\t"))
    bars = []
    previous = None
    gap_minutes = []
    invalid = 0
    for row in rows:
        dt = datetime.datetime.strptime(row["<DATE>"] + " " + row.get("<TIME>", "00:00:00"), "%Y.%m.%d %H:%M:%S")
        stamp = int(dt.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
        try:
            o, h, l, c = (float(row[key]) for key in ("<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>"))
            if not all(map(math.isfinite, (o, h, l, c))) or o <= 0 or h < max(o, c) or l > min(o, c):
                raise ValueError("invalid OHLC")
        except Exception:
            invalid += 1
            raise RuntimeError("OHLC invalide dans " + name + " à " + dt.isoformat())
        if previous is not None:
            if stamp <= previous:
                raise RuntimeError("Horodatages non croissants dans " + name)
            gap_minutes.append((stamp - previous) // 60000)
        previous = stamp
        bars.append({"time": stamp, "open": o, "high": h, "low": l, "close": c})
    files[name] = {
        "sha256": hashlib.sha256(data).hexdigest(),
        "rows": len(bars),
        "first": rows[0]["<DATE>"] + " " + rows[0].get("<TIME>", "00:00:00"),
        "last": rows[-1]["<DATE>"] + " " + rows[-1].get("<TIME>", "00:00:00"),
        "invalidOHLC": invalid,
        "gapIntervals": gap_minutes,
        "bars": bars,
    }

fx_name = "EURUSD_M5_202512010000_202610092355.csv"
fx_raw = z.read(fx_name)
fx_rows = list(csv.DictReader(io.TextIOWrapper(io.BytesIO(fx_raw), encoding="utf-8-sig"), delimiter="\t"))
fx = []
for row in fx_rows:
    dt = datetime.datetime.strptime(row["<DATE>"] + " " + row["<TIME>"], "%Y.%m.%d %H:%M:%S")
    fx.append({
        "time": int(dt.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000),
        "rate": (float(row["<OPEN>"]) + float(row["<CLOSE>"])) / 2,
    })

old_trades = {}
old_summaries = {}
for year in (2025, 2026):
    trade_name = "resultats/ftmo_20k_" + str(year) + "_tp2p5_trades.csv"
    trade_rows = list(csv.DictReader(io.TextIOWrapper(io.BytesIO(z.read(trade_name)), encoding="utf-8-sig")))
    old_trades[str(year)] = trade_rows
    summary_name = "resultats/ftmo_20k_" + str(year) + "_tp2p5.json"
    old_summaries[str(year)] = json.loads(z.read(summary_name).decode("utf-8-sig"))

print(json.dumps({
    "archiveSha256": hashlib.sha256(raw).hexdigest(),
    "archiveBytes": len(raw),
    "archiveCrc": "PASSED",
    "timeBasis": "horodatage natif sans fuseau; axe numérique traité comme naïf",
    "files": files,
    "fx": {"sha256": hashlib.sha256(fx_raw).hexdigest(), "rows": len(fx), "first": fx_rows[0]["<DATE>"] + " " + fx_rows[0]["<TIME>"], "last": fx_rows[-1]["<DATE>"] + " " + fx_rows[-1]["<TIME>"], "bars": fx},
    "oldTrades": old_trades,
    "oldSummaries": old_summaries,
}, separators=(",", ":")))
`;

const extracted = spawnSync("python", ["-c", extractPython, archive], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
if (extracted.error) throw extracted.error;
if (extracted.status !== 0) throw new Error(extracted.stderr || `Extraction Python échouée (${extracted.status}).`);

const source = JSON.parse(extracted.stdout);
const m15 = source.files["lab/donnees/m15.csv"].bars;
const m30 = source.files["lab/donnees/m30.csv"].bars;
const h4 = source.files["lab/donnees/h4.csv"].bars;
const d1 = source.files["lab/donnees/d1.csv"].bars;
const fxBars = source.fx.bars;
const oldReport = JSON.parse(await readFile(priorResultsPath, "utf8"));
const goldSignals = buildArchivedGoldSignals(m15, m30, h4, d1);
const analysis = analyzeExperimentalGoldSmcFib(m15);
if (!analysis) throw new Error("Analyse SMC/Fibonacci indisponible sur l’archive vérifiée.");
const candidates = buildHistoricalVariantCandidates(goldSignals, analysis);
const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));

const periods = [
  { year: 2025, start: Date.UTC(2025, 0, 1), end: Date.UTC(2026, 0, 1) },
  { year: 2026, start: Date.UTC(2026, 0, 1), end: m15[m15.length - 1].time + intervalMs },
];
const variants = [
  { id: "gold-archived-reference", candidateId: "gold", label: "GOLD référence archivée — signaux reconstruits" },
  { id: "gold-experimental", candidateId: "gold", label: "GOLD du rapport expérimental — mêmes signaux reconstruits" },
  { id: "gold-smc", candidateId: "gold-smc", label: "GOLD + SMC" },
  { id: "gold-fibonacci", candidateId: "gold-fibonacci", label: "GOLD + Fibonacci" },
  { id: "gold-smc-fibonacci", candidateId: "gold-smc-fibonacci", label: "GOLD + SMC + Fibonacci" },
];
const sizingPolicies = [
  { id: "fixed-100-eur", label: "Risque fixe 100 EUR", fixedRiskEUR: 100 },
  { id: "equity-0p5-percent", label: "0,5 % du capital courant", fixedRiskEUR: null },
];

const fxAt = (time, year) => {
  if (year === 2025) return { rate: 1.15, ageMinutes: null, hypothetical: true };
  let low = 0;
  let high = fxBars.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (fxBars[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  if (index < 0) return null;
  return {
    rate: fxBars[index].rate,
    ageMinutes: (time - fxBars[index].time) / 60_000,
    hypothetical: true,
  };
};

const monthlyKeys = period => {
  const keys = [];
  let cursor = new Date(period.start);
  while (cursor.getTime() < period.end) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
};

function floorLots(value) {
  return Math.floor((value + 1e-10) / lotStep) * lotStep;
}

function simulateAccount(candidate, period, policy) {
  const startIndex = m15.findIndex(bar => bar.time >= period.start);
  const foundEndIndex = m15.findIndex(bar => bar.time >= period.end);
  const endIndex = foundEndIndex < 0 ? m15.length : foundEndIndex;
  let balance = initialBalanceEUR;
  let peak = balance;
  let maxClosedDrawdownEUR = 0;
  let maxClosedDrawdownPercent = 0;
  let nextEntryAvailableIndex = startIndex;
  let blockedByPosition = 0;
  let rejectedRisk = 0;
  let rejectedMargin = 0;
  let excludedIncompleteHorizon = 0;
  let staleFxEntryQuotes = 0;
  let staleFxExitQuotes = 0;
  let ambiguousBars = 0;
  let trades = [];
  const maxHoldBars = GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.expiryBars;
  const contractOunces = GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.contractOunces;
  const spread = GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.spreadUSDPerOunce;
  const slippage = GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.slippageUSDPerOuncePerSide;
  const commissionRoundTurn = 2 * GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.commissionUSDPerLotPerSide;
  const executionCostPerSide = spread / 2 + slippage;
  const feesPerLot = spread * contractOunces + 2 * slippage * contractOunces + commissionRoundTurn;

  for (let signalIndex = startIndex; signalIndex < endIndex - 1; signalIndex++) {
    const signal = candidate.signals[signalIndex];
    if (!signal) continue;
    const entryIndex = signalIndex + 1;
    if (entryIndex < nextEntryAvailableIndex) {
      blockedByPosition++;
      continue;
    }
    if (entryIndex >= endIndex || m15[entryIndex].time - m15[signalIndex].time !== intervalMs) continue;
    const expiryIndex = entryIndex + maxHoldBars - 1;
    if (expiryIndex >= endIndex) {
      excludedIncompleteHorizon++;
      continue;
    }
    const entryFx = fxAt(m15[entryIndex].time, period.year);
    if (!entryFx || !Number.isFinite(entryFx.rate) || entryFx.rate <= 0) {
      rejectedRisk++;
      continue;
    }
    if (entryFx.ageMinutes !== null && entryFx.ageMinutes > 60) staleFxEntryQuotes++;

    const riskBudgetEUR = policy.fixedRiskEUR ?? balance * 0.005;
    const direction = signal.direction === "BUY" ? 1 : -1;
    const referenceEntry = m15[entryIndex].open;
    const stopDistance = GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.stopATRMultiple * signal.atr14;
    const riskUSDPerLot = stopDistance * contractOunces + feesPerLot;
    if (!Number.isFinite(riskUSDPerLot) || riskUSDPerLot <= 0) {
      rejectedRisk++;
      continue;
    }
    const rawLots = riskBudgetEUR * entryFx.rate / riskUSDPerLot;
    const marginLimitedLots = balance * leverageScenario * entryFx.rate / (referenceEntry * contractOunces);
    const volume = floorLots(Math.min(rawLots, marginLimitedLots));
    if (volume < lotStep) {
      if (rawLots < lotStep) rejectedRisk++;
      else rejectedMargin++;
      continue;
    }
    const actualRiskEUR = riskUSDPerLot * volume / entryFx.rate;
    const marginEUR = referenceEntry * contractOunces * volume / (leverageScenario * entryFx.rate);
    if (actualRiskEUR > riskBudgetEUR + 1e-7) {
      rejectedRisk++;
      continue;
    }
    if (marginEUR > balance + 1e-7) {
      rejectedMargin++;
      continue;
    }

    const stop = referenceEntry - direction * stopDistance;
    const target = referenceEntry + direction * stopDistance * GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.takeProfitR;
    const executedEntry = referenceEntry + direction * executionCostPerSide;
    let exitIndex = expiryIndex;
    let exitReference = m15[expiryIndex].close;
    let exitReason = "TIME";
    let ambiguous = false;
    let inTradeGaps = 0;

    for (let cursor = entryIndex; cursor <= expiryIndex; cursor++) {
      const candle = m15[cursor];
      if (cursor > entryIndex && candle.time - m15[cursor - 1].time !== intervalMs) inTradeGaps++;
      const stopTouched = direction === 1 ? candle.low <= stop : candle.high >= stop;
      const targetTouched = direction === 1 ? candle.high >= target : candle.low <= target;
      if (stopTouched && targetTouched) ambiguous = true;

      if (cursor > entryIndex && (direction === 1 ? candle.open <= stop : candle.open >= stop)) {
        exitReference = candle.open;
        exitReason = "SL_GAP";
      } else if (cursor > entryIndex && (direction === 1 ? candle.open >= target : candle.open <= target)) {
        exitReference = target;
        exitReason = "TP_GAP";
      } else if (stopTouched) {
        exitReference = stop;
        exitReason = "SL";
      } else if (targetTouched) {
        exitReference = target;
        exitReason = "TP";
      } else if (cursor === expiryIndex) {
        exitReference = candle.close;
        exitReason = "TIME";
      } else {
        continue;
      }
      exitIndex = cursor;
      break;
    }

    const executedExit = exitReference - direction * executionCostPerSide;
    const pnlUSDPerLot = (executedExit - executedEntry) * direction * contractOunces - commissionRoundTurn;
    const pnlUSD = pnlUSDPerLot * volume;
    const exitFx = fxAt(m15[exitIndex].time, period.year);
    const exitRate = exitFx?.rate ?? entryFx.rate;
    if (!exitFx || !Number.isFinite(exitRate) || exitRate <= 0) staleFxExitQuotes++;
    if (exitFx?.ageMinutes !== null && exitFx?.ageMinutes > 60) staleFxExitQuotes++;
    const pnlEUR = pnlUSD / exitRate;
    const netR = pnlEUR / actualRiskEUR;
    const previousBalance = balance;
    balance += pnlEUR;
    peak = Math.max(peak, balance);
    maxClosedDrawdownEUR = Math.max(maxClosedDrawdownEUR, peak - balance);
    maxClosedDrawdownPercent = Math.max(maxClosedDrawdownPercent, peak ? (peak - balance) / peak * 100 : 0);
    if (ambiguous) ambiguousBars++;

    trades.push({
      signalTime: signal.time,
      entryTime: m15[entryIndex].time,
      exitTime: m15[exitIndex].time + (exitReason === "TIME" ? intervalMs : 0),
      year: period.year,
      direction: signal.direction,
      referenceEntry,
      executedEntry,
      executedExit,
      stop,
      target,
      stopDistance,
      volumeLots: volume,
      fxEntryUsdPerEur: entryFx.rate,
      fxExitUsdPerEur: exitRate,
      fxEntryAgeMinutes: entryFx.ageMinutes,
      fxExitAgeMinutes: exitFx?.ageMinutes ?? null,
      plannedRiskEUR: actualRiskEUR,
      riskBudgetEUR,
      pnlUSD,
      pnlEUR,
      netR,
      feesUSD: feesPerLot * volume,
      feesEUR: feesPerLot * volume / exitRate,
      balanceBeforeEUR: previousBalance,
      balanceAfterEUR: balance,
      exitReason,
      conservativeAmbiguousBar: ambiguous,
      interveningM15Gaps: inTradeGaps,
    });
    nextEntryAvailableIndex = exitIndex + 1;
  }

  const winners = trades.filter(trade => trade.pnlEUR > 0);
  const losers = trades.filter(trade => trade.pnlEUR < 0);
  let worstLossStreak = 0;
  let currentLossStreak = 0;
  for (const trade of trades) {
    currentLossStreak = trade.pnlEUR < 0 ? currentLossStreak + 1 : 0;
    worstLossStreak = Math.max(worstLossStreak, currentLossStreak);
  }
  const grossWinsEUR = winners.reduce((sum, trade) => sum + trade.pnlEUR, 0);
  const grossLossesEUR = losers.reduce((sum, trade) => sum + trade.pnlEUR, 0);
  const totalNetEUR = trades.reduce((sum, trade) => sum + trade.pnlEUR, 0);
  const byMonth = new Map(monthlyKeys(period).map(month => [month, {
    month, trades: 0, wins: 0, losses: 0, netEUR: 0, netR: 0, pnlUSD: 0,
  }]));
  for (const trade of trades) {
    const monthKey = new Date(trade.exitTime).toISOString().slice(0, 7);
    const item = byMonth.get(monthKey);
    if (!item) continue;
    item.trades++;
    item.wins += trade.pnlEUR > 0 ? 1 : 0;
    item.losses += trade.pnlEUR < 0 ? 1 : 0;
    item.netEUR += trade.pnlEUR;
    item.netR += trade.netR;
    item.pnlUSD += trade.pnlUSD;
  }
  return {
    year: period.year,
    policy: policy.id,
    initialBalanceEUR,
    finalBalanceEUR: balance,
    trades: trades.length,
    wins: winners.length,
    losses: losers.length,
    winRatePercent: trades.length ? winners.length / trades.length * 100 : null,
    grossWinsEUR,
    grossLossesEUR,
    netEUR: totalNetEUR,
    netUSD: trades.reduce((sum, trade) => sum + trade.pnlUSD, 0),
    profitFactor: grossLossesEUR ? grossWinsEUR / Math.abs(grossLossesEUR) : null,
    expectancyEUR: trades.length ? totalNetEUR / trades.length : 0,
    expectancyR: trades.length ? trades.reduce((sum, trade) => sum + trade.netR, 0) / trades.length : 0,
    netR: trades.reduce((sum, trade) => sum + trade.netR, 0),
    realizedMaxDrawdownEUR: maxClosedDrawdownEUR,
    realizedMaxDrawdownPercent: maxClosedDrawdownPercent,
    maxConsecutiveLosses: worstLossStreak,
    totalFeesEUR: trades.reduce((sum, trade) => sum + trade.feesEUR, 0),
    blockedByPosition,
    rejectedRisk,
    rejectedMargin,
    excludedIncompleteHorizon,
    staleFxEntryQuotes,
    staleFxExitQuotes,
    conservativeAmbiguousBars: ambiguousBars,
    tradesDetail: trades,
    monthly: [...byMonth.values()],
  };
}

const oldResults = [];
for (const year of [2025, 2026]) {
  const legacyRows = source.oldTrades[String(year)];
  const oldJsonSummary = source.oldSummaries[String(year)].summary;
  const previousVariant = oldReport.years.find(item => item.year === year).variants.find(item => item.id === "gold");
  const toMs = text => Date.parse(`${text.replace(" ", "T")}Z`);
  const startTime = toMs(legacyRows[0].entry);
  const endTime = toMs(legacyRows[legacyRows.length - 1].exit);
  const legacyByEntry = new Map(legacyRows.map(row => [toMs(row.entry), row]));
  const currentWindowTrades = previousVariant.tradesDetail.filter(trade => trade.entryTime >= startTime && trade.entryTime <= endTime);
  const currentByEntry = new Map(currentWindowTrades.map(trade => [trade.entryTime, trade]));
  const commonEntries = [...legacyByEntry.keys()].filter(time => currentByEntry.has(time));
  const oldOnly = [...legacyByEntry.keys()].filter(time => !currentByEntry.has(time));
  const currentOnly = [...currentByEntry.keys()].filter(time => !legacyByEntry.has(time));
  const overlap = (time, trades) => trades.some(trade => trade.entryTime <= time && time <= trade.exitTime);
  const common = commonEntries.map(time => ({
    old: legacyByEntry.get(time),
    current: currentByEntry.get(time),
  }));
  oldResults.push({
    year,
    legacy: {
      trades: legacyRows.length,
      firstEntry: legacyRows[0].entry,
      lastEntry: legacyRows[legacyRows.length - 1].entry,
      lastExit: legacyRows[legacyRows.length - 1].exit,
      netEUR: oldJsonSummary.net,
      finalBalanceEUR: oldJsonSummary.end_balance,
      phase1Status: oldJsonSummary.phase1_status,
      phase1End: oldJsonSummary.phase1_end,
      phase2Status: oldJsonSummary.phase2_status,
      phase2End: oldJsonSummary.phase2_end,
    },
    previousExperimentalReportFullPeriod: {
      trades: previousVariant.trades,
      netR: previousVariant.netR,
      netUSDPerLot: previousVariant.netUSDPerLot,
    },
    sameEntryWindow: {
      start: legacyRows[0].entry,
      end: legacyRows[legacyRows.length - 1].exit,
      legacyTrades: legacyRows.length,
      experimentalTradesInWindow: currentWindowTrades.length,
      commonEntryTimes: commonEntries.length,
      legacyOnlyEntryTimes: oldOnly.length,
      experimentalOnlyEntryTimes: currentOnly.length,
      legacyOnlyWhileExperimentalPositionOpen: oldOnly.filter(time => overlap(time, currentWindowTrades)).length,
      experimentalOnlyWhileLegacyPositionOpen: currentOnly.filter(time => legacyRows.some(row => toMs(row.entry) <= time && time <= toMs(row.exit))).length,
      commonEntriesSameExitReason: common.filter(pair => pair.old.exit_reason === pair.current.exitReason).length,
      commonEntriesDifferentExitReason: common.filter(pair => pair.old.exit_reason !== pair.current.exitReason).length,
      commonEntriesSameExitTimestamp: common.filter(pair => toMs(pair.old.exit) === pair.current.exitTime).length,
      maxCommonEntryPriceDelta: Math.max(0, ...common.map(pair => Math.abs(Number(pair.old.entry_price) - pair.current.referenceEntry))),
      maxCommonStopPriceDelta: Math.max(0, ...common.map(pair => Math.abs(Number(pair.old.stop_price) - pair.current.stop))),
      legacyExitReasons: Object.fromEntries([...new Set(legacyRows.map(row => row.exit_reason))].map(reason => [reason, legacyRows.filter(row => row.exit_reason === reason).length])),
      experimentalExitReasons: Object.fromEntries([...new Set(currentWindowTrades.map(trade => trade.exitReason))].map(reason => [reason, currentWindowTrades.filter(trade => trade.exitReason === reason).length])),
    },
  });
}

const accountResults = [];
for (const period of periods) {
  for (const variant of variants) {
    const candidate = candidateById.get(variant.candidateId);
    if (!candidate) throw new Error(`Candidat historique absent: ${variant.candidateId}`);
    for (const policy of sizingPolicies) {
      const result = simulateAccount(candidate, period, policy);
      accountResults.push({ variantId: variant.id, variantLabel: variant.label, ...result });
    }
  }
}

const gapCounts = new Map();
for (const minutes of source.files["lab/donnees/m15.csv"].gapIntervals) {
  if (minutes > 15) gapCounts.set(minutes, (gapCounts.get(minutes) ?? 0) + 1);
}
const report = {
  title: "Backtests GOLD — réconciliation et simulation de compte en scénarios hypothétiques",
  generatedAt: new Date().toISOString(),
  runId: createHash("sha256").update(JSON.stringify({
    archive: source.archiveSha256,
    accountResults: accountResults.map(result => ({
      year: result.year, policy: result.policy, variantId: result.variantId,
      trades: result.trades, netEUR: result.netEUR, realizedMaxDrawdownPercent: result.realizedMaxDrawdownPercent,
    })),
  })).digest("hex"),
  safety: { offlineOnly: true, noOrders: true, noPaperIntegration: true, activeEnginesModified: false },
  source: {
    archiveSha256: source.archiveSha256,
    archiveCrc: source.archiveCrc,
    m15: {
      ...Object.fromEntries(Object.entries(source.files["lab/donnees/m15.csv"]).filter(([key]) => !["bars", "gapIntervals"].includes(key))),
      gapIntervalsOver15Minutes: [...gapCounts.entries()].sort((a, b) => a[0] - b[0]).map(([minutes, count]) => ({ minutes, count })),
    },
    fx: { ...Object.fromEntries(Object.entries(source.fx).filter(([key]) => key !== "bars")), first: source.fx.first, last: source.fx.last },
    timeBasis: source.timeBasis,
    periods: periods.map(period => ({
      year: period.year,
      startInclusive: new Date(period.start).toISOString(),
      endExclusive: new Date(period.end).toISOString(),
    })),
  },
  assumptions: {
    entries: "Reconstructed archived GOLD: breakout of prior 8 completed M15 highs/lows; closed trigger candle direction; EMA50/EMA200 and aligned M30/H4/D1 3-bar momentum; entry at next contiguous M15 open.",
    experimentalRules: "SMC and Fibonacci filters are experimental; not a verified reproduction of historic SMC rules.",
    execution: {
      stopATRMultiple: GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.stopATRMultiple,
      takeProfitR: GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.takeProfitR,
      expiryBars: GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.expiryBars,
      onePositionMaximum: true,
      contractOuncesHypothesis: GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.contractOunces,
      volumeMinimumAndStepHypothesis: lotStep,
      leverageHypothesis: leverageScenario,
      spreadUSDPerOunce: GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.spreadUSDPerOunce,
      slippageUSDPerOuncePerSide: GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.slippageUSDPerOuncePerSide,
      commissionUSDPerLotPerSide: GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.commissionUSDPerLotPerSide,
      costsIncludedInStopRisk: true,
      ambiguousBar: "SL prioritaire si SL et TP sont touchés dans la même M15; gap après l’entrée rempli à l’open.",
      periodEnd: "Signaux exclus si l’horizon complet de 48 bougies ne tient pas dans la période; aucune sortie artificielle à fin d’année.",
    },
    sizing: {
      fixed: "100 EUR nominal par trade; le volume est arrondi vers le bas au pas hypothétique 0,01.",
      floating: "0,5 % du solde courant avant l’entrée; les coûts sont inclus dans le risque prévu.",
      eurFx2025: "Taux fixe 1 EUR = 1,15 USD, scénario hypothétique repris de l’ancien rapport, non taux historique observé.",
      eurFx2026: "Dernier cours EUR/USD M5 disponible au plus tard à l’horodatage brut, sous alignement sans fuseau certifié; résultats hypothétiques.",
      margin: "Levier 1:20 et contrat 100 oz hypothétiques; aucune spécification FTMO/symbole vérifiée.",
    },
    drawdown: "Drawdown réalisé calculé sur le solde après chaque trade clôturé. Pas de drawdown flottant exact: l'ordre intrabougie des extrêmes OHLC est inconnu.",
    ftmo: "Aucun statut FTMO calculé/certifié; fuseau Europe/Paris, règles quotidiennes et mark-to-market non vérifiables.",
  },
  reconciliation: oldResults,
  accountResults,
};

await mkdir(outputDirectory, { recursive: false });
const jsonPath = path.join(outputDirectory, "gold-reconciliation-account-results.json");
const reportPath = path.join(outputDirectory, "gold-reconciliation-account-report.md");
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });

const fmt = value => value === null || value === undefined ? "—" : Number(value).toFixed(2);
const summaryRows = accountResults.map(result =>
  `| ${result.year} | ${result.variantId} | ${result.policy} | ${result.trades} (${result.wins}/${result.losses}) | ${fmt(result.winRatePercent)}% | ${fmt(result.profitFactor)} | ${fmt(result.netR)} | ${fmt(result.netUSD)} $ | ${fmt(result.netEUR)} € | ${fmt(result.finalBalanceEUR)} € | ${fmt(result.realizedMaxDrawdownEUR)} € (${fmt(result.realizedMaxDrawdownPercent)}%) | ${result.maxConsecutiveLosses} |`,
);
const monthRows = [];
for (const result of accountResults) {
  monthRows.push(`\n### ${result.year} — ${result.variantId} — ${result.policy}\n`);
  monthRows.push("| Mois | Trades (G/P) | Net EUR hypothétique | Net R |");
  monthRows.push("|---|---:|---:|---:|");
  for (const month of result.monthly) {
    monthRows.push(`| ${month.month} | ${month.trades} (${month.wins}/${month.losses}) | ${fmt(month.netEUR)} € | ${fmt(month.netR)} |`);
  }
}
const reconciliationRows = oldResults.map(item =>
  `| ${item.year} | ${item.legacy.trades} | ${item.previousExperimentalReportFullPeriod.trades} | ${item.sameEntryWindow.experimentalTradesInWindow} | ${item.sameEntryWindow.commonEntryTimes} | ${item.sameEntryWindow.legacyOnlyEntryTimes} | ${item.sameEntryWindow.experimentalOnlyEntryTimes} | ${item.sameEntryWindow.legacyOnlyWhileExperimentalPositionOpen} | ${item.sameEntryWindow.commonEntriesDifferentExitReason} |`,
);
const markdown = [
  "# Réconciliation et simulation comparative GOLD — hors ligne",
  "",
  `Run ID : \`${report.runId}\``,
  "",
  "## Réconciliation des anciens résultats",
  "",
  "Les anciens rapports FTMO s’arrêtent dès que les deux phases du challenge atteignent leur cible; ils ne couvrent donc pas l’année complète. La comparaison ci-dessous borne les transactions expérimentales à l’intervalle réellement couvert par les transactions archivées.",
  "",
  "| Année | Trades anciens | Trades du rapport expérimental complet | Trades expérimentaux dans fenêtre ancienne | Entrées communes | Anciennes seulement | Expérimentales seulement | Anciennes seulement pendant position expérimentale | Raisons de sortie différentes parmi entrées communes |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...reconciliationRows,
  "",
  "Les prix d’entrée et stops des entrées communes sont quasi identiques (précision float32 de l’ancien CSV contre float64 du nouveau). Les différences restantes sont principalement compatibles avec les changements de disponibilité des positions dus à M5/M15 et aux horizons 32/48; les comptes de lignes ne suffisent pas à attribuer chaque écart à une cause unique.",
  "",
  "## Campagne de compte",
  "",
  "Les variantes « GOLD référence archivée » et « GOLD expérimental » utilisent volontairement le même signal GOLD reconstruit, sous une exécution commune M15; elles ne constituent pas deux stratégies indépendantes. Les colonnes EUR sont des scénarios, pas des performances certifiées.",
  "",
  "| Année | Variante | Risque | Trades (G/P) | Win rate | PF | Net R | Net USD | Net EUR hypothétique | Solde final EUR hypothétique | DD réalisé EUR (%) | Pire série de pertes |",
  "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...summaryRows,
  "",
  "## Résultats mensuels",
  "",
  ...monthRows,
  "",
  "## Données, hypothèses et limites",
  "",
  `- Archive CRC : ${source.archiveCrc}; SHA-256 : \`${source.archiveSha256}\`. XAU/USD M15 : ${source.files["lab/donnees/m15.csv"].rows} bougies, ${source.files["lab/donnees/m15.csv"].first} — ${source.files["lab/donnees/m15.csv"].last}.`,
  `- Intervalles >15 min : ${[...gapCounts.entries()].sort((a, b) => a[0] - b[0]).map(([minutes, count]) => `${count} de ${minutes} min`).join(", ")}. Les 75 min et 2955 min sont récurrents; les autres coïncident en partie avec des jours fériés, mais faute de calendrier de session/fuseau certifié, ils ne sont pas déclarés tous « normaux » ou « manquants ». OHLC invalides : ${source.files["lab/donnees/m15.csv"].invalidOHLC}; doublons/non-chronologie rejetés à l’extraction.`,
  `- EUR/USD M5 : ${source.fx.rows} cours du ${source.fx.first} au ${source.fx.last}. Le taux fixe 2025 de 1,15 et les conversions 2026 alignées sur des temps sans fuseau sont des scénarios hypothétiques.`,
  "- Contrat 100 oz, pas de lot 0,01, levier 1:20 et coûts de spread/slippage/commission sont des hypothèses de calcul faute de spécifications vérifiées du symbole/compte.",
  "- Entrée au prochain open M15 contigu; 48 bougies maximum; une position simultanée; SL prioritaire en cas de bougie ambigüe; gaps de stop au prix d’ouverture; sorties à la clôture après expiration.",
  "- Drawdown affiché = drawdown réalisé après clôtures. Le drawdown flottant, les pertes quotidiennes FTMO à minuit Europe/Paris et un PASS/FAIL FTMO ne sont pas certifiables.",
  "- Les chiffres 2025/2026 sont des simulations historiques, sur des périodes déjà étudiées et non hors-échantillon. Ils ne représentent ni le journal PAPER ni une rentabilité future.",
  "",
].join("\n");
await writeFile(reportPath, markdown, { flag: "wx" });

console.log(JSON.stringify({
  outputDirectory: path.relative(root, outputDirectory).replaceAll("\\", "/"),
  runId: report.runId,
  reconciliation: oldResults.map(item => ({
    year: item.year,
    legacy: item.legacy.trades,
    experimentalFull: item.previousExperimentalReportFullPeriod.trades,
    experimentalInLegacyWindow: item.sameEntryWindow.experimentalTradesInWindow,
    commonEntries: item.sameEntryWindow.commonEntryTimes,
    legacyOnly: item.sameEntryWindow.legacyOnlyEntryTimes,
    experimentalOnly: item.sameEntryWindow.experimentalOnlyEntryTimes,
  })),
  results: accountResults.map(result => ({
    year: result.year,
    variant: result.variantId,
    policy: result.policy,
    trades: result.trades,
    wins: result.wins,
    losses: result.losses,
    netR: result.netR,
    netUSD: result.netUSD,
    netEUR: result.netEUR,
    realizedDDPercent: result.realizedMaxDrawdownPercent,
    maxLossStreak: result.maxConsecutiveLosses,
  })),
}, null, 2));
