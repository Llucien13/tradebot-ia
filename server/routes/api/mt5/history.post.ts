import { defineHandler } from "nitro";
import { readBody, setResponseHeader, createError } from "nitro/h3";
import { mt5HistoryRequestSchema } from "../../../../src/lib/mt5-data";
import { mt5DataAdapter } from "../../../utils/MT5DataAdapter";
import { assertLocalMT5Request } from "../../../utils/mt5-local-request";

export default defineHandler(async event => {
  assertLocalMT5Request(event);
  setResponseHeader(event, "Cache-Control", "no-store");
  const parsed = mt5HistoryRequestSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Symbole, dates ISO UTC, préchauffage ou timeframe MT5 invalides." });
  return mt5DataAdapter.fetchRange(parsed.data);
});