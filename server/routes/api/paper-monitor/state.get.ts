import { defineHandler } from "nitro";
import { setResponseHeader } from "nitro/h3";
import { requireCloudPaperUser } from "../../../utils/cloud-paper";
import { readCloudMonitorSnapshot } from "../../../utils/paper-monitor-cloud";

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const { id, settings } = await requireCloudPaperUser(event);
  return readCloudMonitorSnapshot(settings, id);
});
