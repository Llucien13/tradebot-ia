import { runBacktest } from "./engine";
import type { Strategy } from "@/lib/strategies";
import type { BacktestSettings, HistoricalData } from "./types";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ strategy: Strategy; settings: BacktestSettings; history: HistoricalData }>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = event => {
  try {
    const { strategy, settings, history } = event.data;
    const result = runBacktest(strategy, settings, history, percent => scope.postMessage({ type: "progress", percent }));
    scope.postMessage({ type: "result", result });
  } catch (error) { scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Calcul du backtest impossible." }); }
};
