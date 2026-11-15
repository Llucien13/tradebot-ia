import {
  buildGoldShadowComparisons,
  detectM15Gaps,
  validateGoldShadowFeed,
  type GoldShadowCandle,
} from "./gold-xauusd-shadow-tracker.ts";
import { FIB_M15_INTERVAL_MS } from "./fibonacci-shadow.ts";

function makeBars(count: number, interval: number, start: number, step = 0.1): GoldShadowCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const open = 2_000 + index * step;
    const close = open + step;
    return {
      time: start + index * interval,
      open,
      high: close + 0.5,
      low: open - 0.5,
      close,
      spreadPoints: 30,
    };
  });
}

export function checkGoldXauusdShadowTracker() {
  let assertions = 0;
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(`Contrôles tracker XAUUSD SHADOW : ${label}`);
    assertions++;
  };
  const expectThrow = (fn: () => unknown, label: string) => {
    let thrown = false;
    try {
      fn();
    } catch {
      thrown = true;
    }
    check(thrown, label);
  };

  const now = 2_000_000_000_000;
  const start = now - 60 * FIB_M15_INTERVAL_MS;
  const bars = makeBars(3, FIB_M15_INTERVAL_MS, start);
  const feed = {
    source: "MT5",
    readOnly: true,
    symbol: "XAUUSD",
    timeframe: "M15",
    closedBarsOnly: true,
    fetchedAt: new Date(now).toISOString(),
    candles: bars,
  };
  check(validateGoldShadowFeed(feed, "M15", now, 60 * FIB_M15_INTERVAL_MS).candles.length === 3, "accepte les bougies clôturées XAUUSD locales");
  const priorDailyBars = makeBars(3, 24 * 60 * 60_000, now - 5 * 24 * 60 * 60_000);
  const dailyFeed = {
    ...feed,
    timeframe: "D1",
    candles: priorDailyBars,
  };
  check(
    validateGoldShadowFeed(dailyFeed, "D1", now, null).candles.length === 3,
    "accepte l'historique D1 clôturé malgré la fermeture hebdomadaire si sa réponse est récente",
  );
  expectThrow(
    () => validateGoldShadowFeed({ ...feed, symbol: "XAUUSD-ECN" }, "M15", now, 60 * FIB_M15_INTERVAL_MS),
    "refuse le symbole ECN",
  );
  expectThrow(
    () => validateGoldShadowFeed({ ...feed, readOnly: false }, "M15", now, 60 * FIB_M15_INTERVAL_MS),
    "refuse un flux non marqué lecture seule",
  );
  expectThrow(
    () => validateGoldShadowFeed({
      ...feed,
      candles: [bars[0], bars[0]],
    }, "M15", now, 60 * FIB_M15_INTERVAL_MS),
    "refuse les timestamps dupliqués",
  );
  expectThrow(
    () => validateGoldShadowFeed(feed, "M15", now + 10 * FIB_M15_INTERVAL_MS, FIB_M15_INTERVAL_MS),
    "refuse une dernière bougie périmée",
  );
  check(detectM15Gaps([bars[0], { ...bars[1], time: bars[1].time + FIB_M15_INTERVAL_MS }]).length === 1, "détecte et expose un trou M15");

  const m15 = makeBars(242, FIB_M15_INTERVAL_MS, start - 242 * FIB_M15_INTERVAL_MS);
  const triggerIndex = m15.length - 3;
  const previous = m15[triggerIndex - 1];
  const triggerOpen = previous.close;
  const triggerClose = Math.max(...m15.slice(triggerIndex - 8, triggerIndex).map(bar => bar.high)) + 2;
  m15[triggerIndex] = {
    time: m15[triggerIndex].time,
    open: triggerOpen,
    high: triggerClose + 0.5,
    low: triggerOpen - 0.5,
    close: triggerClose,
    spreadPoints: 32,
  };
  m15[triggerIndex + 1] = {
    time: m15[triggerIndex].time + FIB_M15_INTERVAL_MS,
    open: triggerClose + 0.25,
    high: triggerClose + 0.75,
    low: triggerClose - 0.25,
    close: triggerClose + 0.5,
    spreadPoints: 35,
  };
  const makeHigherBars = (interval: number, count: number) => makeBars(
    count,
    interval,
    m15[0].time - count * interval,
    1,
  );
  const m30 = makeHigherBars(30 * 60_000, 20);
  const h4 = makeHigherBars(4 * 60 * 60_000, 10);
  const d1 = makeHigherBars(24 * 60 * 60_000, 10);
  const comparisons = buildGoldShadowComparisons(m15, m30, h4, d1);
  const latest = comparisons.find(item => item.signalBarTime === m15[triggerIndex].time);
  if (!latest) throw new Error("Contrôles tracker XAUUSD SHADOW : comparaison de référence absente.");
  check(latest.gold?.direction === "BUY", "reconnaît la confirmation GOLD clôturée");
  check(latest.gold?.entryAt === m15[triggerIndex + 1].time, "attend l'ouverture de la bougie suivante");
  check(latest.gold?.entryPrice === m15[triggerIndex + 1].open, "utilise l'ouverture suivante comme entrée théorique");
  check(latest.gold?.decisionAt === m15[triggerIndex].time + FIB_M15_INTERVAL_MS, "date la décision à la clôture du signal");
  check(latest.goldSmc === null || latest.goldSmc.entryAt === latest.executionBarTime, "aligne GOLD + SMC sur la même bougie d'exécution");
  check(
    latest.experimentalCandidates.map(candidate => candidate.strategy).join(",") === "GOLD_FIBONACCI,GOLD_SMC_FIBONACCI",
    "compare les variantes expérimentales Fibonacci seul et SMC + Fibonacci",
  );
  check(
    latest.experimentalCandidates.every(candidate =>
      candidate.ruleset === "EXPERIMENTAL_NOT_HISTORICAL"
      && (candidate.signal === null || candidate.signal.entryAt === latest.executionBarTime)),
    "garde les filtres facultatifs expérimentaux sur la même bougie d'exécution",
  );
  check(latest.sizingDecision === "REFUSED_UNVERIFIED_SYMBOL_SPECIFICATIONS", "refuse un volume sans contrat vérifié");
  check(latest.simulatedResult === null, "n'invente aucun résultat financier sans volume et coûts");
  check(comparisons.every(item => item.smcRuleset === "EXPERIMENTAL_NOT_HISTORICAL"), "étiquette les règles SMC comme expérimentales");
  const futureChanged = m15.map(bar => ({ ...bar }));
  const futureBar = futureChanged[triggerIndex + 2];
  futureChanged[triggerIndex + 2] = {
    ...futureBar,
    high: futureBar.high + 100,
    close: futureBar.close + 50,
  };
  const comparisonAfterFutureChange = buildGoldShadowComparisons(futureChanged, m30, h4, d1)
    .find(item => item.signalBarTime === m15[triggerIndex].time);
  check(
    comparisonAfterFutureChange?.gold?.direction === latest.gold?.direction
      && comparisonAfterFutureChange?.goldSmc?.direction === latest.goldSmc?.direction
      && comparisonAfterFutureChange?.experimentalCandidates.map(candidate => candidate.signal?.direction ?? null)
        .join(",") === latest.experimentalCandidates.map(candidate => candidate.signal?.direction ?? null).join(","),
    "une bougie future modifiée ne change aucune direction déjà décidée",
  );
  const appendFutureBars = (history: GoldShadowCandle[], interval: number) => {
    const extended = history.map(bar => ({ ...bar }));
    let time = Math.max(
      extended[extended.length - 1].time + interval,
      Math.floor(latest.decisionAt / interval) * interval + interval,
    );
    while (time <= latest.decisionAt + interval * 4) {
      const open = extended[extended.length - 1].close;
      const close = open - 1;
      extended.push({ time, open, high: open + 0.1, low: close - 0.1, close });
      time += interval;
    }
    return extended;
  };
  const comparisonWithFutureHigherTimeframes = buildGoldShadowComparisons(
    m15,
    appendFutureBars(m30, 30 * 60_000),
    appendFutureBars(h4, 4 * 60 * 60_000),
    appendFutureBars(d1, 24 * 60 * 60_000),
  ).find(item => item.signalBarTime === m15[triggerIndex].time);
  check(
    !!comparisonWithFutureHigherTimeframes
      && comparisonWithFutureHigherTimeframes.gold?.direction === latest.gold?.direction
      && comparisonWithFutureHigherTimeframes.goldSmc?.direction === latest.goldSmc?.direction
      && comparisonWithFutureHigherTimeframes.experimentalCandidates.map(candidate => candidate.signal?.direction ?? null)
        .join(",") === latest.experimentalCandidates.map(candidate => candidate.signal?.direction ?? null).join(","),
    "les bougies M30/H4/D1 postérieures à la décision ne modifient aucune variante",
  );

  return { passed: true, assertions };
}
