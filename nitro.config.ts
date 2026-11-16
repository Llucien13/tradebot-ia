import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  preset: process.env.VERCEL ? "vercel" : undefined,
  ...(process.env.TRADEBOT_STAGE_DIR ? {
    output: {
      dir: process.env.TRADEBOT_STAGE_DIR,
      publicDir: `${process.env.TRADEBOT_STAGE_DIR}/public`,
      serverDir: `${process.env.TRADEBOT_STAGE_DIR}/server`,
    },
  } : {}),
  runtimeConfig: {
    twelveDataApiKey: "",
  },
});
