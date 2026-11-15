import { defineHandler } from "nitro";
import { readBody, setResponseHeader, createError } from "nitro/h3";
import { z } from "zod";
import { mt5DataAdapter } from "../../../utils/MT5DataAdapter";
import { assertLocalMT5Request } from "../../../utils/mt5-local-request";

export default defineHandler(async event => {
  assertLocalMT5Request(event);
  setResponseHeader(event, "Cache-Control", "no-store");
  const parsed = z.object({ confirm: z.literal(true) }).safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Confirmation explicite requise pour installer le package Python officiel gratuit MetaTrader5." });
  return mt5DataAdapter.installOfficialPackage();
});
