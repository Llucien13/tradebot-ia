import { defineConfig } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { createHash } from "node:crypto";
import { nitro } from "nitro/vite";
import { RELEASE } from "./src/release";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    dyadComponentTagger(),
    react(),
    {
      name: "tradebot-release-manifest",
      apply: "build",
      generateBundle(_options, bundle) {
        const assets = Object.entries(bundle).map(([file, item]) => ({
          file,
          sha256: createHash("sha256").update(item.type === "chunk" ? item.code : item.source).digest("hex"),
        }));
        this.emitFile({
          type: "asset",
          fileName: "tradebot-build.json",
          source: JSON.stringify({ release: RELEASE, builtAt: new Date().toISOString(), assets }, null, 2),
        });
      },
    },
    nitro(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
