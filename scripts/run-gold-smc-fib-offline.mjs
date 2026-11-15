import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildArchivedGoldSignals, buildHistoricalVariantCandidates, simulateHistoricalVariant, GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS } from "../src/lib/gold-smc-fib-historical.ts";
import { analyzeExperimentalGoldSmcFib } from "../src/lib/gold-smc-fib-experimental.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = path.join(root, "src", "ftmo", "reference", "TradeBot_FTMO_20K_EUR_Backtest_PAPER_2025_2026.zip");
const outputDirectory = path.join(root, "src", "ftmo", "reference", "resultats", "simulation-experimentale-20261113-final");

const extractPython = String.raw`
import csv, datetime, hashlib, io, json, pathlib, sys, zipfile
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
    for row in rows:
        dt = datetime.datetime.strptime(row["<DATE>"] + " " + row.get("<TIME>", "00:00:00"), "%Y.%m.%d %H:%M:%S")
        # Keep the source's naive wall clock as an integer axis; no timezone is inferred.
        stamp = int(dt.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
        o, h, l, c = (float(row[key]) for key in ("<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>"))
        if not all(map(__import__("math").isfinite, (o, h, l, c))) or o <= 0 or h < max(o, c) or l > min(o, c):
            raise RuntimeError("OHLC invalide dans " + name + " à " + dt.isoformat())
        if previous is not None and stamp <= previous:
            raise RuntimeError("Horodatages non croissants dans " + name)
        previous = stamp
        bars.append({"time": stamp, "open": o, "high": h, "low": l, "close": c})
    files[name] = {
        "sha256": hashlib.sha256(data).hexdigest(),
        "rows": len(bars),
        "first": rows[0]["<DATE>"] + " " + rows[0].get("<TIME>", "00:00:00"),
        "last": rows[-1]["<DATE>"] + " " + rows[-1].get("<TIME>", "00:00:00"),
        "bars": bars,
    }
print(json.dumps({
    "archiveSha256": hashlib.sha256(raw).hexdigest(),
    "archiveBytes": len(raw),
    "archiveCrc": "PASSED",
    "timeBasis": "horodatage natif sans fuseau; axe numérique traité comme naïf",
    "files": files,
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
const { m15, m30, h4, d1 } = Object.fromEntries(
  Object.entries(source.files).map(([name, file]) => [name.split("/").at(-1).split(".")[0], file.bars]),
);

const goldSignals = buildArchivedGoldSignals(m15, m30, h4, d1);
const experimental = analyzeExperimentalGoldSmcFib(m15);
if (!experimental) throw new Error("Analyse expérimentale impossible sur l’archive vérifiée.");
const candidates = buildHistoricalVariantCandidates(goldSignals, experimental);
const firstTimestamp = m15[0].time;
const lastCandle = m15[m15.length - 1];
const lastExclusive = lastCandle.time + 15 * 60 * 1000;
const yearRanges = [
  { year: 2025, start: Date.UTC(2025, 0, 1), end: Date.UTC(2026, 0, 1) },
  { year: 2026, start: Date.UTC(2026, 0, 1), end: lastExclusive },
];
const months = (year, endExclusive) => {
  const result = [];
  let cursor = Date.UTC(year, 0, 1);
  while (cursor < endExclusive) {
    const next = new Date(cursor);
    next.setUTCMonth(next.getUTCMonth() + 1);
    result.push({ start: cursor, end: Math.min(next.getTime(), endExclusive), key: new Date(cursor).toISOString().slice(0, 7) });
    cursor = next.getTime();
  }
  return result;
};
const periodFor = range => {
  let startIndex = m15.findIndex(bar => bar.time >= range.start);
  if (startIndex < 0) startIndex = m15.length;
  let endIndex = m15.findIndex(bar => bar.time >= range.end);
  if (endIndex < 0) endIndex = m15.length;
  return { year: range.year, startIndex, endIndex };
};
const rangeStats = (trades, start, end) => {
  const selected = trades.filter(trade => trade.exitTime >= start && trade.exitTime < end);
  return {
    trades: selected.length,
    wins: selected.filter(trade => trade.pnlUSDPerLot > 0).length,
    losses: selected.filter(trade => trade.pnlUSDPerLot < 0).length,
    netR: selected.reduce((sum, trade) => sum + trade.netR, 0),
    pnlUSDPerLot: selected.reduce((sum, trade) => sum + trade.pnlUSDPerLot, 0),
  };
};
const closedTradeDrawdownPercent = trades => {
  let equityFactor = 1;
  let peakFactor = 1;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equityFactor *= 1 + GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.riskPercent / 100 * trade.netR;
    peakFactor = Math.max(peakFactor, equityFactor);
    maxDrawdown = Math.max(maxDrawdown, (peakFactor - equityFactor) / peakFactor);
  }
  return maxDrawdown * 100;
};
const summaryResults = [];
const reports = [];
for (const range of yearRanges) {
  const period = periodFor(range);
  const variantReports = [];
  for (const candidate of candidates) {
    let excludedForIncompleteHorizon = 0;
    const periodCandidate = {
      ...candidate,
      signals: candidate.signals.map((signal, index) => {
        if (!signal || index < period.startIndex || index >= period.endIndex) return null;
        const entryIndex = index + 1;
        if (entryIndex + GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS.expiryBars - 1 >= period.endIndex) {
          excludedForIncompleteHorizon++;
          return null;
        }
        return signal;
      }),
    };
    const simulation = simulateHistoricalVariant(m15, periodCandidate, period, GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS);
    const maxClosedTradeDrawdownPercent = closedTradeDrawdownPercent(simulation.tradesDetail);
    const byMonth = months(range.year, range.end).map(month => ({ month: month.key, ...rangeStats(simulation.tradesDetail, month.start, month.end) }));
    const byDayMap = new Map();
    const byWeekMap = new Map();
    for (const trade of simulation.tradesDetail) {
      const date = new Date(trade.exitTime).toISOString().slice(0, 10);
      const day = byDayMap.get(date) ?? { date, trades: 0, netR: 0, pnlUSDPerLot: 0, wins: 0, losses: 0 };
      day.trades++;
      day.netR += trade.netR;
      day.pnlUSDPerLot += trade.pnlUSDPerLot;
      if (trade.pnlUSDPerLot > 0) day.wins++;
      if (trade.pnlUSDPerLot < 0) day.losses++;
      byDayMap.set(date, day);
      const weekStart = new Date(`${date}T00:00:00Z`);
      weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
      const week = weekStart.toISOString().slice(0, 10);
      const weekly = byWeekMap.get(week) ?? { week, trades: 0, netR: 0, pnlUSDPerLot: 0 };
      weekly.trades++;
      weekly.netR += trade.netR;
      weekly.pnlUSDPerLot += trade.pnlUSDPerLot;
      byWeekMap.set(week, weekly);
    }
    const variantReport = {
      ...simulation,
      maxCompoundDrawdownPercent: undefined,
      maxClosedTradeDrawdownPercent,
      grossWinsUSDPerLot: undefined,
      grossLossesUSDPerLot: undefined,
      netWinningUSDPerLot: simulation.grossWinsUSDPerLot,
      netLosingUSDPerLot: simulation.grossLossesUSDPerLot,
      excludedForIncompleteHorizon,
      capitalInterpretation: "capitalIndex est un indice de risque composé démarrant à 20 000 unités de référence, pas un solde EUR certifié; tailles de lots non calculées sans conversion horodatée.",
      period: { startIndex: period.startIndex, endIndexExclusive: period.endIndex, startNaive: new Date(range.start).toISOString(), endNaiveExclusive: new Date(range.end).toISOString() },
      monthly: byMonth,
      daily: [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      weekly: [...byWeekMap.values()].sort((a, b) => a.week.localeCompare(b.week)),
    };
    variantReports.push(variantReport);
    summaryResults.push({
      year: range.year,
      id: simulation.id,
      label: simulation.label,
      trades: simulation.trades,
      wins: simulation.wins,
      losses: simulation.losses,
      winRatePercent: simulation.winRatePercent,
      profitFactorUSDPerLot: simulation.profitFactorUSDPerLot,
      netR: simulation.netR,
      netUSDPerLot: simulation.netUSDPerLot,
      maxClosedTradeDrawdownPercent,
      capitalIndexChangePercent: simulation.capitalIndexChangePercent,
      excludedForIncompleteHorizon,
      conservativeAmbiguousBars: simulation.conservativeAmbiguousBars,
      dataEndExits: simulation.dataEndExits,
    });
  }
  reports.push({ year: range.year, variants: variantReports });
}

const digest = createHash("sha256").update(JSON.stringify({ source: source.archiveSha256, summaryResults })).digest("hex");
const report = {
  title: "SIMULATION HORS LIGNE — GOLD + SMC + Fibonacci expérimental",
  generatedAt: new Date().toISOString(),
  runId: digest,
  noLiveOrders: true,
  noPaperIntegration: true,
  noLegacyBacktestRerun: true,
  source: {
    archive: path.relative(root, archive).replaceAll("\\", "/"),
    archiveSha256: source.archiveSha256,
    archiveBytes: source.archiveBytes,
    crc: source.archiveCrc,
    timeBasis: source.timeBasis,
    files: Object.fromEntries(Object.entries(source.files).map(([name, item]) => [name, {
      sha256: item.sha256, rows: item.rows, first: item.first, last: item.last,
    }])),
    availableM15WallClock: { first: source.files["lab/donnees/m15.csv"].first, last: source.files["lab/donnees/m15.csv"].last },
    periods: yearRanges.map(range => ({ year: range.year, startWallClockInclusive: new Date(range.start).toISOString(), endWallClockExclusive: new Date(range.end).toISOString() })),
  },
  assumptions: {
    candidateRules: "GOLD reference entry expressions reconstructed from archived recherche_m15.py/run_filters.py; SMC/Fibonacci definitions are experimental.",
    execution: GOLD_ARCHIVE_EXECUTION_ASSUMPTIONS,
    spreadSource: "Hypothèse historique archivée fixe 0.30 USD/oz; colonne MT5 SPREAD non convertie en prix faute de _Point/contract metadata.",
    slippageAndCommission: "Hypothèses historiques archivées: 0.05 USD/oz par côté, commission 3 USD/lot par côté.",
    priceFill: "Bid/ask reconstruits par demi-spread + slippage adverse par côté; gaps SL remplis à l’open; si SL et TP sont touchés dans une M15, SL d’abord.",
    timeframe: "Signaux sur clôture M15, entrée au prochain open M15 contigu, un seul trade en portefeuille, expiration 48 bougies natives.",
    financialUnits: "USD/lot de 100 oz sous le contrat historique supposé et R normalisé. L’indice composé part de 20 000 unités avec risque relatif 0,5%; il ne constitue PAS un solde EUR ni une simulation de taille de lot FTMO.",
    eurFx: "Non utilisé: le FX 2025 n’existe pas dans l’archive et l’alignement FX 2026 à un timestamp sans fuseau ne peut être certifié.",
    timezone: "Aucun fuseau n’est inféré. Agrégations journalières/hebdomadaires basées sur le calendrier mural brut de l’archive; aucune conclusion de conformité journalière FTMO.",
    ftmo: "Aucun PASS/FAIL FTMO calculé. Conversion EUR/USD, fuseau CE(S)T, calendrier des limites quotidiennes et valorisation latente certifiée indisponibles.",
    robusteness: "2025 et 2026 sont séparés chronologiquement; référence GOLD déjà étudiée sur ces deux périodes, donc aucune n’est présentée comme hors-échantillon indépendant. Aucune variante n’est sélectionnée comme gagnante.",
  },
  experimentalDiagnostics: experimental.diagnostics,
  results: summaryResults,
  years: reports,
};
await mkdir(outputDirectory, { recursive: false });
await writeFile(path.join(outputDirectory, "gold-smc-fibonacci-results.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });

const metricTable = [
  "| Année | Variante | Trades | Win rate | PF | Net R | USD net/lot | DD clôture | Indice final | SL/TP ambigus |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...summaryResults.map(row =>
    `| ${row.year} | ${row.id} | ${row.trades} | ${row.winRatePercent?.toFixed(2) ?? "—"}% | ${row.profitFactorUSDPerLot?.toFixed(3) ?? "—"} | ${row.netR.toFixed(3)} | ${row.netUSDPerLot.toFixed(2)} | ${row.maxClosedTradeDrawdownPercent.toFixed(2)}% | ${(20_000 * (1 + row.capitalIndexChangePercent / 100)).toFixed(2)}* | ${row.conservativeAmbiguousBars} |`,
  ),
];
const monthlyLines = [];
for (const yearReport of reports) {
  for (const variant of yearReport.variants) {
    monthlyLines.push(`\n### ${yearReport.year} — ${variant.id} (${variant.label})\n`);
    monthlyLines.push("| Mois | Trades | Wins | Losses | Net R | USD net/lot |");
    monthlyLines.push("|---|---:|---:|---:|---:|---:|");
    for (const month of variant.monthly) {
      monthlyLines.push(`| ${month.month} | ${month.trades} | ${month.wins} | ${month.losses} | ${month.netR.toFixed(3)} | ${month.pnlUSDPerLot.toFixed(2)} |`);
    }
  }
}
const markdown = [
  "# SIMULATION HORS LIGNE — GOLD + SMC + Fibonacci expérimental",
  "",
  `Run ID: \`${digest}\``,
  "",
  "## Comparaison (ne pas interpréter USD net/lot comme P&L réel du compte)",
  "",
  ...metricTable,
  "",
  "* DD clôture: drawdown de l’indice composé après clôture des trades uniquement; les excursions intrabougie ne sont pas classées faute d’ordre connu entre high/low. Indice de capital composé sur 20 000 unités de référence, pas un solde EUR.",
  "",
  "## Source et périodes",
  "",
  `- Archive: \`${path.relative(root, archive).replaceAll("\\", "/")}\`, SHA-256 \`${source.archiveSha256}\`, CRC ${source.archiveCrc}.`,
  `- XAU/USD M15: ${source.files["lab/donnees/m15.csv"].rows} barres, ${source.files["lab/donnees/m15.csv"].first} — ${source.files["lab/donnees/m15.csv"].last}.`,
  `- Périodes: ${yearRanges.map(range => `${range.year} ${new Date(range.start).toISOString()} — ${new Date(range.end).toISOString()} exclus`).join("; ")}.`,
  "- Timeframes GOLD à fuseau inconnu; temps bruts traités comme un axe mural commun, sans conversion de fuseau.",
  "",
  "## Résultats mensuels",
  "",
  ...monthlyLines,
  "",
  "## Limites financières et FTMO",
  "",
  "- Le FX EUR/USD n’est pas appliqué: la couverture 2025 manque et l’alignement 2026 sans fuseau n’est pas certifiable. Le capital 20 000 est donc un indice de risque, et les montants USD sont exprimés **par lot de 100 oz** sous la convention contractuelle archivée.",
  "- Spread 0,30 USD/oz, slippage 0,05 USD/oz par côté et commission 3 USD/lot/côté sont les hypothèses du rapport archivé, pas des coûts observés pour chaque barre.",
  "- Sortie OHLC conservatrice: SL prioritaire si SL et TP apparaissent dans la même bougie; gap au stop rempli à l’ouverture. Aucun tick ou calendrier de session n’est reconstruit.",
  "- Aucun PASS/FAIL FTMO: il manque le FX applicable, le fuseau CE(S)T certifié pour le reset quotidien et la valorisation latente à minuit.",
  "- Les références GOLD ont déjà été étudiées sur 2025 et 2026; ces périodes ne sont pas un test hors-échantillon indépendant. Les règles SMC/Fibonacci sont expérimentales. Les variantes sont rapportées sans classement ni sélection gagnante.",
  "- Les signaux dont l’entrée ne dispose pas de 48 bougies M15 complètes avant la fin de l’année sont exclus par le runner (compte `excludedForIncompleteHorizon`); le moteur historique validé reste inchangé.",
  "- Les sorties dont SL/TP ne sont pas touchés avant l’expiration sont évaluées à la clôture de la 48e bougie; les sorties forcées par fin de données sont comptées séparément.",
  "",
  "Les anciens backtests n’ont pas été relancés. Les résultats décrivent seulement cette nouvelle simulation hors ligne, pas le journal PAPER ni une exécution réelle.",
  "",
].join("\n");
await writeFile(path.join(outputDirectory, "gold-smc-fibonacci-report.md"), markdown, { flag: "wx" });
console.log(JSON.stringify({
  outputDirectory: path.relative(root, outputDirectory).replaceAll("\\", "/"),
  runId: digest,
  periods: report.source.periods,
  archiveSha256: source.archiveSha256,
  diagnostics: experimental.diagnostics,
  variants: summaryResults.length,
  resultSummary: summaryResults,
}, null, 2));
