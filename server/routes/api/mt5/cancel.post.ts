import { defineHandler } from "nitro";
import { readBody, setResponseHeader, createError } from "nitro/h3";
import { z } from "zod";
import { assertLocalMT5Request } from "../../../utils/mt5-local-request";
import { mt5DataAdapter } from "../../../utils/MT5DataAdapter";

export default defineHandler(async event => {
  assertLocalMT5Request(event);
  setResponseHeader(event, "Cache-Control", "no-store");
  const parsed = z.object({ token: z.string().uuid() }).safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Token MT5 invalide." });
  return { cancelled: mt5DataAdapter.cancelOperation(parsed.data.token) };
});
