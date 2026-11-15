import { defineHandler } from "nitro";
import { createError, readBody, setResponseHeader } from "nitro/h3";
import { z } from "zod";
import { accountInputSchema, PAPER_DEFAULT_CAPITAL, paperCapitalSchema } from "../../../../src/lib/paper/model";
import { strategySchema } from "../../../../src/lib/strategies";
import {
  createCloudPaperAccount,
  fetchPaperFxRate,
  requireCloudPaperUser,
} from "../../../utils/cloud-paper";
import { createCloudPaperInitialState } from "../../../utils/cloud-paper-state";
import { getTwelveDataApiKey } from "../../../utils/paper-market-feed";

const setupSchema = z.object({
  account: accountInputSchema.extend({
    initialCapital: paperCapitalSchema.default(PAPER_DEFAULT_CAPITAL),
  }),
  strategy: strategySchema,
}).strict();

export default defineHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const { id, settings } = await requireCloudPaperUser(event);
  const raw: unknown = await readBody(event);
  const parsed = setupSchema.safeParse(raw);
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: "Paramètres Cloud PAPER invalides. Aucun compte n’a été créé." });
  const { account: input, strategy } = parsed.data;
  const fx = await fetchPaperFxRate(getTwelveDataApiKey());
  const state = createCloudPaperInitialState(input, strategy, fx);
  await createCloudPaperAccount(settings, id, state, strategy);
  return { configured: true, running: false, initialCapital: state.account!.initialCapital, currency: state.account!.currency };
});
