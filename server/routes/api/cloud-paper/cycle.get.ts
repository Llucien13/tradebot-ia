import { defineHandler } from "nitro";
import { createError, getHeader, setResponseHeader } from "nitro/h3";
import { advancePaper } from "../../../../src/lib/paper/engine";
import {
  commitCloudPaperCycle,
  listCloudPaperAccounts,
  verifyCronRequest,
} from "../../../utils/cloud-paper";
import { cloudPaperEventsForCycle, cloudPaperFeedFreshness } from "../../../utils/cloud-paper-state";
import { getPaperMarketFeed, getTwelveDataApiKey } from "../../../utils/paper-market-feed";

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const settings = await verifyCronRequest(getHeader(event, "authorization"));
  const accounts = await listCloudPaperAccounts(settings);
  const active = accounts.filter(account => account.running || account.state.position !== null || account.state.pending !== null);
  if (!active.length) return { processed: 0, message: "Aucun compte Cloud PAPER actif." };

  const feed = await getPaperMarketFeed(getTwelveDataApiKey());
  const freshness = cloudPaperFeedFreshness(feed);
  if (!freshness.fresh) {
    return {
      processed: 0,
      waitingForFreshMarketData: true,
      lastClosedHour: freshness.closedAt,
      ageMinutes: Math.round(freshness.ageMs / 60000),
    };
  }
  let committed = 0;
  let conflicts = 0;
  for (const account of active) {
    const strategy = account.running ? account.strategy : null;
    const next = advancePaper(account.state, strategy, feed);
    const saved = await commitCloudPaperCycle(settings, account, next, cloudPaperEventsForCycle(account.state, next));
    if (saved) committed++;
    else conflicts++;
  }
  return { processed: active.length, committed, conflicts, feedFetchedAt: feed.fetchedAt };
});
