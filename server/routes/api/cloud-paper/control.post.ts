import { defineHandler } from "nitro";
import { createError, readBody, setResponseHeader } from "nitro/h3";
import { z } from "zod";
import { commitCloudPaperCycle, getCloudPaperAccount, requireCloudPaperUser, type CloudPaperEvent } from "../../../utils/cloud-paper";

const controlSchema = z.object({ running: z.boolean(), expectedRevision: z.number().int().nonnegative() }).strict();

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const { id, settings } = await requireCloudPaperUser(event);
  const parsed = controlSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: "Commande Cloud PAPER invalide." });
  const account = await getCloudPaperAccount(settings, id);
  if (!account) throw createError({ statusCode: 404, statusMessage: "Compte Cloud PAPER non configuré." });
  if (account.revision !== parsed.data.expectedRevision) {
    throw createError({ statusCode: 409, statusMessage: "L’état Cloud PAPER a changé. Rechargez avant de commander." });
  }
  if (parsed.data.running && !account.strategy.enabled) {
    throw createError({ statusCode: 409, statusMessage: "La stratégie enregistrée est désactivée; démarrage refusé." });
  }
  if (parsed.data.running && !account.state.account) {
    throw createError({ statusCode: 409, statusMessage: "Compte ou paramètres de risque absents; démarrage refusé." });
  }
  const next = structuredClone(account.state);
  const events: CloudPaperEvent[] = [];
  if (next.pending && (!parsed.data.running || !account.running)) {
    const signal = next.signals.find(item => item.id === next.pending?.signalId);
    if (!signal) throw createError({ statusCode: 503, statusMessage: "Entrée en attente sans signal associé; commande refusée pour préserver l’état." });
    signal.execution = "Entrée annulée par la pause du PAPER Cloud.";
    events.push({
      event_id: `entry-cancelled:${signal.id}`,
      event_type: "ENTRY_CANCELLED",
      occurred_at: new Date(next.pending.time).toISOString(),
      payload: { signalId: signal.id, reason: signal.execution },
    });
    next.pending = null;
  }
  next.running = parsed.data.running;
  if (parsed.data.running && next.startedAt === null) next.startedAt = Date.now();
  const updated = await commitCloudPaperCycle(settings, account, next, events);
  if (!updated) throw createError({ statusCode: 409, statusMessage: "Conflit de révision Cloud PAPER. Rechargez l’état." });
  const latest = await getCloudPaperAccount(settings, id);
  if (!latest) throw createError({ statusCode: 503, statusMessage: "Compte Cloud PAPER introuvable après commande." });
  return { configured: true, revision: latest.revision, running: latest.running, state: latest.state };
});
