import { readBacktestHistory } from "@/lib/backtest-history";
import type { BackupSnapshot } from "@/lib/backup";
import { V3_KEY, V3_VERSION, type V3Result } from "./m5-v3-model";
import { parseV3Source, resolveV3Profile, V3_RECOVERY_KEY, type V3ProfileSource } from "./m5-v3-profile";

export async function recoverV3Inputs(snapshots: BackupSnapshot[]) {
  // XAUUSD-ECN maximum explicitly confirmed by the user in MetaTrader 5.
  const sources: V3ProfileSource[] = [{ broker: { maxLot: 100 } }];
  const add = (s: V3ProfileSource | null) => { if (s) sources.push(s); };
  add(parseV3Source(localStorage.getItem(V3_RECOVERY_KEY)));
  add(parseV3Source(localStorage.getItem(V3_KEY)));
  for (const s of snapshots) add(parseV3Source(s.storage.find(v => v.key === V3_KEY)?.value ?? null));
  const records = (await readBacktestHistory()).records;
  for (const record of records) {
    if (record.result.engineVersion !== V3_VERSION) continue;
    const r = record.result as unknown as V3Result;
    if (r.v3) add({ config: r.v3.config, broker: r.v3.broker, calendar: r.calendar, costs: r.settings });
  }
  const costs = (raw: string | null) => {
    if (!raw) return;
    try { const parsed = JSON.parse(raw); add({ costs: parsed }); } catch { /* No invented cost. */ }
  };
  costs(localStorage.getItem("tradebot.scalping.m5.costs.v1"));
  for (const s of snapshots) costs(s.storage.find(v => v.key === "tradebot.scalping.m5.costs.v1")?.value ?? null);
  for (const r of records) if (r.strategy === "M5" && r.result.history.symbol === "XAUUSD-ECN") add({ costs: r.result.settings, calendar: r.result.calendar });
  return resolveV3Profile(sources);
}
