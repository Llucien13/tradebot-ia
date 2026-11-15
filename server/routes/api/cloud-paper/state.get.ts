import { defineHandler } from "nitro";
import { setResponseHeader } from "nitro/h3";
import { getCloudPaperAccount, requireCloudPaperUser } from "../../../utils/cloud-paper";

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const { id, settings } = await requireCloudPaperUser(event);
  const account = await getCloudPaperAccount(settings, id);
  return account
    ? { configured: true, revision: account.revision, running: account.running, lastCycleAt: account.updated_at, state: account.state, strategy: account.strategy }
    : { configured: false, revision: null, running: false, state: null, strategy: null };
});
