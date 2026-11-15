import { defineHandler } from "nitro";
import { createError, getRequestURL, setResponseHeader } from "nitro/h3";
import { RELEASE } from "../../../src/release";

export default defineHandler((event) => {
  if (!["127.0.0.1", "localhost"].includes(getRequestURL(event).hostname)) {
    throw createError({ statusCode: 403, statusMessage: "Local access only" });
  }
  setResponseHeader(event, "Cache-Control", "no-store");
  return {
    release: RELEASE,
    pid: process.pid,
    nodeVersion: process.version,
    processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    observedAt: new Date().toISOString(),
    mode: "PAPER",
    liveEnabled: false,
    scope: "Web server identity only; not MT5 connection evidence",
  };
});
