import { defineHandler } from "nitro";
import { useRuntimeConfig } from "nitro/runtime-config";
import { setResponseHeader } from "nitro/h3";
import { getPaperMarketFeed, getTwelveDataApiKey } from "../../utils/paper-market-feed";

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const config = useRuntimeConfig();
  return getPaperMarketFeed(getTwelveDataApiKey(config.twelveDataApiKey));
});
