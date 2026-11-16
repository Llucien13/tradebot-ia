import { defineHandler } from "nitro";
import { getQuery, setResponseHeader } from "nitro/h3";
import { requireCloudPaperUser } from "../../../utils/cloud-paper";
import { readCloudMonitorJournal } from "../../../utils/paper-monitor-cloud";

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const { id, settings } = await requireCloudPaperUser(event);
  const query = getQuery(event);
  const rawLimit = typeof query.limit === "string" ? Number(query.limit) : 50;
  const rawOffset = typeof query.offset === "string" ? Number(query.offset) : 0;
  const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50;
  const offset = Number.isInteger(rawOffset) ? Math.min(1_000_000, Math.max(0, rawOffset)) : 0;
  return readCloudMonitorJournal(settings, id, limit, offset);
});
