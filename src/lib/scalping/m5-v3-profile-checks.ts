import { resolveV3Profile, persistV3Profile, V3MissingInputs } from "./m5-v3-profile";
import { OBSERVED_ECN_CALENDAR } from "./m5-calendar";
import { V3_KEY } from "./m5-v3-model";

export async function checkV3ProfileRecovery() {
  let assertions = 0;
  const check = (ok: boolean, label: string) => { if (!ok) throw new Error(`Profil V3 : ${label}`); assertions++; };
  const source = { costs: { spread: 0.4, slippage: 0.06 }, broker: { maxLot: 50 }, calendar: OBSERVED_ECN_CALENDAR };
  const resolved = resolveV3Profile([source]);
  check(resolved.config.riskPercent === 1 && resolved.config.pivotBars === 2, "profil absent initialisé avec règles V3 existantes");
  check(resolved.costs.spread === 0.4 && resolved.costs.slippage === 0.06, "hypothèses reprises sans valeurs fictives");
  check(resolved.costs.commission === 0.03 && resolved.broker.contractSize === 100 && resolved.broker.marginPerLotUSD === 840, "contraintes fournies et conversion commission");
  check(resolved.broker.maxLot === 50 && resolved.broker.minLot === 0.01 && resolved.broker.lotStep === 0.01, "volume maximal enregistré conservé");
  const existing = resolveV3Profile([{ config: { ...resolved.config, zoneAtr: 0.4 }, ...source }]);
  check(existing.config.zoneAtr === 0.4, "règles V3 déjà enregistrées non remplacées");
  const recovered = resolveV3Profile([{ costs: { spread: 0.7 } }, source]);
  check(recovered.costs.spread === 0.7 && recovered.costs.slippage === 0.06, "complément ciblé sans perte des autres valeurs");
  let fields: string[] = [];
  try { resolveV3Profile([{ costs: source.costs, calendar: source.calendar }]); } catch (e) { if (e instanceof V3MissingInputs) fields = e.fields; }
  check(fields.length === 1 && fields[0] === "maxLot", "seul le volume maximal perdu demandé");
  fields = [];
  try { resolveV3Profile([{ costs: { spread: 0.4 }, broker: source.broker, calendar: source.calendar }]); } catch (e) { if (e instanceof V3MissingInputs) fields = e.fields; }
  check(fields.length === 1 && fields[0] === "slippage", "seul le slippage perdu demandé");
  fields = [];
  try { resolveV3Profile([]); } catch (e) { if (e instanceof V3MissingInputs) fields = e.fields; }
  check(fields.length === 4 && !fields.includes("config"), "pas de demande de configuration complète");
  const persisted = new Map<string, string>();
  const storage = { getItem: (key: string) => persisted.get(key) ?? null, setItem: (key: string, value: string) => { persisted.set(key, value); } };
  const profile = await persistV3Profile({ config: resolved.config, broker: resolved.broker, costs: resolved.costs, calendar: resolved.calendars[0] }, storage);
  check(persisted.has(V3_KEY), "profil effectivement écrit sous la clé V3");
  const restored = resolveV3Profile([JSON.parse(storage.getItem(V3_KEY)!)]);
  check(JSON.stringify(restored.config) === JSON.stringify(resolved.config) && restored.costs.spread === 0.4 && restored.broker.maxLot === 50, "nouvelle lecture indépendante du profil persistant");
  const again = await persistV3Profile({ config: restored.config, broker: restored.broker, costs: restored.costs, calendar: restored.calendars[0] }, storage);
  check(again.fingerprint === profile.fingerprint, "empreinte stable après restauration");
  let rejected = false;
  try { await persistV3Profile({ config: resolved.config, broker: resolved.broker, costs: resolved.costs, calendar: resolved.calendars[0] }, { getItem: () => null, setItem: () => {} }); } catch { rejected = true; }
  check(rejected, "échec de persistance détecté");
  return { passed: true, assertions, noBacktestExecuted: true, storageTest: "isolated" };
}
