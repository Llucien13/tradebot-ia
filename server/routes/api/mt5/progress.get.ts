import { defineHandler } from "nitro";
import { getQuery, setResponseHeader, createError } from "nitro/h3";
import { z } from "zod";
import { mt5DataAdapter } from "../../../utils/MT5DataAdapter";
import { assertLocalMT5Request } from "../../../utils/mt5-local-request";

export default defineHandler(event => {
  assertLocalMT5Request(event);
  setResponseHeader(event, "Cache-Control", "no-store");
  const parsed = z.string().uuid().safeParse(getQuery(event).token);
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Token MT5 invalide." });
  return mt5DataAdapter.getOperation(parsed.data);
});
