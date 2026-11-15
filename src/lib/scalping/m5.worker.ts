import { executeM5 } from "./m5-execution";

self.onmessage = (event: MessageEvent<Parameters<typeof executeM5>[0]>) => {
  const runId = event.data.runId;
  try {
    const result = executeM5(event.data, percent => self.postMessage({ type: "progress", percent, runId }));
    self.postMessage({ type: "result", result, runId });
  } catch (error) {
    self.postMessage({ type: "error", runId, message: error instanceof Error ? error.message : "Backtest M5 impossible." });
  }
};
