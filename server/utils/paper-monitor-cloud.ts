import { createError } from "nitro/h3";
import { cloudMonitorJournalSchema, cloudMonitorSnapshotSchema, type CloudMonitorSnapshot, type CloudMonitorTrade } from "../../src/lib/cloud-monitor-model";
import { requireCloudPaperUser, serviceRequest } from "./cloud-paper";

type CloudSettings = Awaited<ReturnType<typeof requireCloudPaperUser>>["settings"];

export function validateCloudMonitorSnapshot(value: unknown): CloudMonitorSnapshot {
  const parsed = cloudMonitorSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw createError({ statusCode: 422, statusMessage: "Observation PAPER invalide ou non autorisée; aucune donnée n’a été synchronisée." });
  }
  return parsed.data;
}

export async function saveCloudMonitorBatch(
  settings: CloudSettings,
  userId: string,
  snapshot: CloudMonitorSnapshot,
  trades: CloudMonitorTrade[],
): Promise<string> {
  const syncedAt = await serviceRequest<unknown>(settings, "rpc/cloud_paper_monitor_sync", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: userId,
      p_snapshot: snapshot,
      p_trades: trades.map(item => ({
        trade_id: item.id,
        occurred_at: new Date((item.trade.exitTime ?? item.trade.entryTime) * 1000).toISOString(),
        payload: item,
      })),
    }),
  });
  if (typeof syncedAt !== "string" || !Number.isFinite(Date.parse(syncedAt))) {
    throw createError({ statusCode: 502, statusMessage: "Horodatage de synchronisation Cloud invalide." });
  }
  return syncedAt;
}

export async function readCloudMonitorSnapshot(settings: CloudSettings, userId: string) {
  const rows = await serviceRequest<unknown>(
    settings,
    `paper_monitor_snapshots?select=snapshot,synced_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  if (!Array.isArray(rows) || rows.length > 1) {
    throw createError({ statusCode: 502, statusMessage: "État de monitoring Cloud invalide." });
  }
  if (!rows.length) return { configured: false as const, snapshot: null, syncedAt: null };
  const row = rows[0] as { snapshot?: unknown; synced_at?: unknown };
  const snapshot = validateCloudMonitorSnapshot(row.snapshot);
  if (typeof row.synced_at !== "string" || !Number.isFinite(Date.parse(row.synced_at))) {
    throw createError({ statusCode: 502, statusMessage: "Horodatage de monitoring Cloud invalide." });
  }
  return { configured: true as const, snapshot, syncedAt: row.synced_at };
}

export async function readCloudMonitorJournal(
  settings: CloudSettings,
  userId: string,
  limit: number,
  offset: number,
) {
  const result = await serviceRequest<unknown>(settings, "rpc/cloud_paper_monitor_journal", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_limit: limit, p_offset: offset }),
  });
  const parsed = cloudMonitorJournalSchema.safeParse(result);
  if (!parsed.success) throw createError({ statusCode: 502, statusMessage: "Journal de monitoring Cloud invalide." });
  return parsed.data;
}
