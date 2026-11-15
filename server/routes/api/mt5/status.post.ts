import { defineHandler } from "nitro";
import { readBody, setResponseHeader, createError } from "nitro/h3";
import { mt5ConnectionSchema } from "../../../../src/lib/mt5-data";
import { mt5DataAdapter } from "../../../utils/MT5DataAdapter";
import { assertLocalMT5Request } from "../../../utils/mt5-local-request";

export default defineHandler(async event => {
  assertLocalMT5Request(event);
  setResponseHeader(event, "Cache-Control", "no-store");
  const parsed = mt5ConnectionSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Paramètres de connexion locale MT5 invalides." });
  return mt5DataAdapter.inspect(parsed.data);
});
