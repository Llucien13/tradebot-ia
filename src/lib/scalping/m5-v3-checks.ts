import type { Candle } from "@/types";
import { v3ConfigSchema, v3BrokerSchema, validateV3Plan, type V3Config, type V3Broker } from "./m5-v3-model";
import { v3Patterns, v3ConfirmedPivots, v3AddReaction, v3InvalidateZones, v3Structure, v3Rebound, v3M15, type V3Zone, type V3Pivot } from "./m5-v3-price-action";
import { v3Size } from "./m5-v3-risk";

export function checkM5V3Units() {
  let assertions = 0;
  const check = (ok: boolean, label: string) => { if (!ok) throw new Error(`V3 : ${label}`); assertions++; };
  const config = v3ConfigSchema.parse({}) as V3Config;
  const candle = (time: number, open: number, high: number, low: number, close: number): Candle => ({ time, open, high, low, close, volume: 1 });
  const hammer = candle(300000, 101, 102.2, 96, 102), star = candle(300000, 102, 107, 100.8, 101);
  check(v3Patterns(hammer, null, config).some(p => p.name === "Marteau"), "marteau numérique");
  check(v3Patterns(star, null, config).some(p => p.name === "Étoile filante"), "étoile numérique");
  check(v3Patterns(candle(300000, 99, 103, 98, 102), candle(0, 101, 102, 99, 100), config).some(p => p.name === "Englobante haussière"), "englobante haussière");
  check(v3Patterns(candle(300000, 102, 103, 98, 99), candle(0, 100, 102, 99, 101), config).some(p => p.name === "Englobante baissière"), "englobante baissière");
  check(v3Patterns(candle(0, 100, 101, 99, 100), null, config).length === 0, "doji rejeté");
  check(v3Patterns(candle(600000, 99, 103, 98, 102), candle(0, 101, 102, 99, 100), config).every(p => !p.name.includes("Englobante")), "englobante ne traverse pas un gap");
  const pivotBars = [1, 2, 5, 2, 1].map((h, i) => candle(i * 300000, 10, 10 + h, 9, 10));
  check(v3ConfirmedPivots(pivotBars, 3, 0, 2, 300000).length === 0, "pivot non confirmé avant deux bougies droites");
  check(v3ConfirmedPivots(pivotBars, 4, 0, 2, 300000)[0]?.confirmedAt === 1500000, "pivot connu seulement à la clôture");
  check(v3ConfirmedPivots(pivotBars, 4, 2, 2, 300000).length === 0, "pivot ne traverse pas une interruption");
  const zones: V3Zone[] = [];
  const p: V3Pivot = { side: "support", price: 100, time: 0, confirmedAt: 600000 };
  v3AddReaction(zones, p, 4, config, "M5");
  v3AddReaction(zones, { ...p, time: 300000 }, 4, config, "M15");
  check(zones[0].reactions === 1, "double comptage même réaction évité M5/M15");
  v3AddReaction(zones, { ...p, price: 100.5, time: 1500000 }, 4, config, "M15");
  check(zones.length === 1 && zones[0].reactions === 2 && zones[0].sources.length === 2, "deux réactions distinctes regroupées ATR");
  check(v3InvalidateZones(zones, 97, 4, config).length === 0, "support cassé invalidé");
  const support = { ...zones[0], low: 100, high: 100, reactions: 2 };
  const resistance: V3Zone = { id: 2, side: "resistance", low: 125, high: 125, reactions: 2, lastReaction: 1500000, sources: ["M15"] };
  check(v3Rebound(hammer, null, [], "haussière", 4, config) === null, "chandelier seul ne déclenche rien");
  check(v3Rebound(hammer, null, [{ ...support, reactions: 1 }, resistance], "haussière", 4, config) === null, "une réaction insuffisante");
  check(v3Rebound(hammer, null, [support, resistance], "baissière", 4, config) === null, "tendance contraire rejetée");
  check(v3Rebound(hammer, null, [support, resistance], "indisponible", 4, config) === null, "structure absente rejetée");
  check(v3Rebound(hammer, null, [support, resistance], "neutre", 4, config)?.time === 600000, "signal clôturé pour prochain open uniquement");
  check(v3Rebound(hammer, null, [support], "haussière", 4, config) === null, "zone cible opposée obligatoire");
  const lows = [p, { ...p, price: 101 }], highs = [{ ...p, side: "resistance" as const, price: 110 }, { ...p, side: "resistance" as const, price: 112 }];
  check(v3Structure(highs, lows) === "haussière", "structure HH HL");
  check(v3Structure([...highs].reverse(), [...lows].reverse()) === "baissière", "structure LH LL");
  check(v3Structure(highs, [...lows].reverse()) === "neutre", "structure mixte neutre");
  const triples = [0, 300000, 600000, 900000, 1500000].map(t => candle(t, 100, 101, 99, 100));
  check(v3M15(triples).length === 1, "aucune M15 incomplète fabriquée");
  const broker = v3BrokerSchema.parse({ symbol: "XAUUSD-ECN", accountCurrency: "USD", contractSize: 100, minLot: 0.01, maxLot: 10, lotStep: 0.01, marginPerLotUSD: 1000, provenance: "fixture de test", confirmed: true }) as V3Broker;
  const costs = { initialCapital: 300, start: 0, end: 300000, timeframe: "5m" as const, spread: 0.3, slippage: 0.05, commission: 0.01 };
  const size = v3Size(100, 1, 99, 110, 300, config, broker, costs);
  check(size.reason === "ok", "volume possible");
  if (size.reason === "ok") {
    check(size.risk <= 3 && size.lots >= broker.minLot, "risque 1 % frais inclus");
    check(Math.abs((size.lots - broker.minLot) / broker.lotStep - Math.round((size.lots - broker.minLot) / broker.lotStep)) < 1e-8, "pas de lot respecté");
  }
  check(v3Size(100, 1, 90, 140, 300, config, broker, costs).reason === "risk", "lot minimum trop risqué rejeté");
  check(v3Size(100, 1, 99, 101, 300, config, broker, costs).reason === "RR", "RR net prix inférieur à 2 rejeté");
  check(v3Size(100, 1, 99, 110, 300, config, { ...broker, marginPerLotUSD: 100000 }, costs).reason === "margin", "marge insuffisante rejetée");
  check(v3Size(110, 1, 99, 110, 300, config, broker, costs).reason === "RR", "gap au-delà du TP interdit l’entrée");
  check(v3Size(98, 1, 99, 110, 300, config, broker, costs).reason === "RR", "gap au-delà du SL interdit l’entrée");
  const plan = { developmentStart: 0, developmentEnd: 900000, validationStart: 900000, validationEnd: 1800000 };
  validateV3Plan(plan, costs, "development"); assertions++;
  let rejected = false;
  try { validateV3Plan({ ...plan, validationStart: 300000 }, costs, "development"); } catch { rejected = true; }
  check(rejected, "périodes chevauchantes rejetées");
  rejected = false;
  try { v3BrokerSchema.parse({ ...broker, confirmed: false }); } catch { rejected = true; }
  check(rejected, "spécifications non confirmées rejetées");
  return { passed: true, assertions, noBacktestExecuted: true };
}
