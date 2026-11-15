import { runM5V3, type V3Request } from "./m5-v3-engine";

self.onmessage = async (event: MessageEvent<V3Request>) => {
  const runId = event.data.runId;
  try {
    const result = await runM5V3(event.data, percent => self.postMessage({ type: "progress", percent, runId }));
    self.postMessage({ type: "result", runId, result });
  } catch (error) {
    self.postMessage({ type: "error", runId, message: error instanceof Error ? error.message : "Calcul V3 impossible." });
  }
};
