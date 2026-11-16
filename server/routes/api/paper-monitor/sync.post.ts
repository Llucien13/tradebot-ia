import { defineHandler } from "nitro";
import { createError, readBody, setResponseHeader } from "nitro/h3";
import { z } from "zod";
import { cloudMonitorJournalSchema } from "../../../../src/lib/cloud-monitor-model";
import { requireCloudPaperUser } from "../../../utils/cloud-paper";
import { saveCloudMonitorBatch, validateCloudMonitorSnapshot } from "../../../utils/paper-monitor-cloud";

const syncBodySchema = z.object({
  snapshot: z.unknown(),
  journal: cloudMonitorJournalSchema,
}).strict();

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const { id, settings } = await requireCloudPaperUser(event);
  const raw: unknown = await readBody(event);
  const parsed = syncBodySchema.safeParse(raw);
  if (!parsed.success || parsed.data.journal.items.length > 100) {
    throw createError({ statusCode: 422, statusMessage: "Lot de synchronisation PAPER invalide." });
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > 512_000) {
    throw createError({ statusCode: 413, statusMessage: "Lot de monitoring trop volumineux." });
  }
  const snapshot = validateCloudMonitorSnapshot(parsed.data.snapshot);
  const syncedAt = await saveCloudMonitorBatch(settings, id, snapshot, parsed.data.journal.items);
  return { syncedAt, receivedTrades: parsed.data.journal.items.length };
});
