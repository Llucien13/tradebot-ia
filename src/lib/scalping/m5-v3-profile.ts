import { v3ConfigSchema, v3BrokerSchema, V3_KEY, v3Fingerprint, type V3Config, type V3Broker } from "./m5-v3-model";
import { validateM5Calendar, type M5Calendar } from "./m5-calendar";
import { V3_JULY_PLAN } from "./m5-v3-period";

export const V3_RECOVERY_KEY = "tradebot.scalping.m5.v3.recovered-inputs";
export type V3MissingField = "spread" | "slippage" | "maxLot" | "calendar";
export class V3MissingInputs extends Error {
  constructor(public fields: V3MissingField[]) {
    const labels = { spread: "spread", slippage: "slippage", maxLot: "volume maximal MT5 (lots)", calendar: "calendrier enregistré compatible" };
    super(`Seules ces données sont introuvables ou invalides : ${fields.map(f => labels[f]).join(", ")}. Complétez-les ci-dessous ; tout le reste sera récupéré automatiquement.`);
  }
}
export interface V3ProfileSource { config?: unknown; broker?: { maxLot?: unknown }; costs?: { spread?: unknown; slippage?: unknown }; calendar?: unknown }
export function resolveV3Profile(sources: V3ProfileSource[]) {
  const primaryConfig = sources.find(s => s.config !== undefined)?.config;
  const parsed = v3ConfigSchema.safeParse(primaryConfig ?? {});
  if (!parsed.success) throw new Error("Le profil de stratégie V3 existant est invalide. Restaurez sa sauvegarde valide ; aucun réglage de stratégie n’est remplacé.");
  const config = parsed.data as V3Config;
  const finite = (value: unknown, min: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min;
  const spread = sources.map(s => s.costs?.spread).find(n => finite(n, 0));
  const slippage = sources.map(s => s.costs?.slippage).find(n => finite(n, 0));
  const maxLot = sources.map(s => s.broker?.maxLot).find(n => finite(n, 0.01));
  const calendars: M5Calendar[] = [];
  for (const source of sources) {
    if (!source.calendar) continue;
    try { const c = validateM5Calendar(source.calendar, "XAUUSD-ECN"); if (!calendars.some(v => JSON.stringify(v) === JSON.stringify(c))) calendars.push(c); } catch { /* Invalid stored calendar is never used. */ }
  }
  const missing: V3MissingField[] = [];
  if (spread === undefined) missing.push("spread");
  if (slippage === undefined) missing.push("slippage");
  if (maxLot === undefined) missing.push("maxLot");
  if (!calendars.length) missing.push("calendar");
  if (missing.length) throw new V3MissingInputs(missing);
  const broker = v3BrokerSchema.parse({ symbol: "XAUUSD-ECN", accountCurrency: "USD", contractSize: 100, minLot: 0.01, maxLot, lotStep: 0.01, marginPerLotUSD: 840,
    provenance: "Contraintes fournies par l’utilisateur pour le parcours un clic ; volume maximal enregistré", confirmed: true }) as V3Broker;
  return { config, broker, costs: { spread: spread as number, slippage: slippage as number, commission: 0.03 }, calendars };
}
export async function persistV3Profile(value: { config: V3Config; broker: V3Broker; costs: { spread: number; slippage: number; commission: number }; calendar: M5Calendar }, storage: Pick<Storage, "setItem" | "getItem"> = localStorage) {
  const plan = V3_JULY_PLAN;
  const fingerprint = await v3Fingerprint({ config: value.config, broker: value.broker, calendar: value.calendar, plan, costs: value.costs });
  const profile = { ...value, dates: ["2026-07-01", "2026-07-21", "2026-07-21", "2026-08-01"], fingerprint };
  const encoded = JSON.stringify(profile);
  storage.setItem(V3_KEY, encoded);
  if (storage.getItem(V3_KEY) !== encoded) throw new Error("Enregistrement du profil V3 impossible. Autorisez le stockage local du navigateur puis réessayez.");
  // Reparse from storage, not the in-memory object, to verify the normal restoration path.
  const restored = JSON.parse(storage.getItem(V3_KEY)!);
  resolveV3Profile([restored]);
  const restoredFingerprint = await v3Fingerprint({ config: restored.config, broker: restored.broker, calendar: restored.calendar, plan, costs: restored.costs });
  if (restored.fingerprint !== restoredFingerprint || restoredFingerprint !== fingerprint) throw new Error("Le profil V3 relu ne correspond pas au profil enregistré. Aucun backtest lancé ; vérifiez le stockage local puis réessayez.");
  console.info("V3_PROFILE_PERSISTENCE_VERIFIED", { maxLot: restored.broker.maxLot, profileStored: true, fingerprintVerified: true });
  return profile;
}
export function parseV3Source(value: string | null): V3ProfileSource | null {
  if (!value) return null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : null; } catch { return null; }
}
