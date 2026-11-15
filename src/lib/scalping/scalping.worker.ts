import { runScalpingBacktest } from "./engine";
import type { ScalpingConfig } from "./model";
import type { BacktestSettings } from "@/lib/backtest/types";
import type { ScalpingHistory } from "./history";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ config: ScalpingConfig; settings: BacktestSettings; history: ScalpingHistory }>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = event => {
  try {
    const { config, settings, history } = event.data;
    const result = runScalpingBacktest(config, settings, history, percent => scope.postMessage({ type: "progress", percent }));
    scope.postMessage({ type: "result", result });
  } catch (e) { scope.postMessage({ type: "error", message: e instanceof Error ? e.message : "Backtest scalping impossible." }); }
};
