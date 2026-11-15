import { defineHandler } from "nitro";
import { getQuery, setResponseHeader } from "nitro/h3";
import { readCloudPaperEvents, requireCloudPaperUser } from "../../../utils/cloud-paper";

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const { id, settings } = await requireCloudPaperUser(event);
  const query = getQuery(event);
  const rawLimit = typeof query.limit === "string" ? Number(query.limit) : 100;
  const limit = Number.isInteger(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 100;
  return { events: await readCloudPaperEvents(settings, id, limit) };
});
