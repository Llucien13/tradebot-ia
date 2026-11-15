import { useSyncExternalStore } from "react";
import type { MT5History, MT5Status } from "./mt5-data";

interface MT5DataSession {
  terminalPath: string;
  symbol: string;
  status: MT5Status | null;
  history: MT5History | null;
  startDate: string;
  endDate: string;
  warmup: number;
}

// In-memory only: survives page-component remounts, not a browser reload.
let session: MT5DataSession = {
  terminalPath: "", symbol: "", status: null, history: null,
  startDate: "05/10/2026", endDate: "05/10/2026", warmup: 202,
};
let m5Session: MT5DataSession = { ...session };
const listeners = new Set<() => void>();
const m5Listeners = new Set<() => void>();
const getSnapshot = () => session;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function updateMT5DataSession(update: Partial<MT5DataSession>, scope?: "M5") {
  if (scope === "M5") {
    m5Session = { ...m5Session, ...update };
    m5Listeners.forEach(listener => listener());
  } else {
    session = { ...session, ...update };
    listeners.forEach(listener => listener());
    if (update.history?.interval === "5m") { m5Session = { ...m5Session, ...update }; m5Listeners.forEach(listener => listener()); }
  }
}

const getM5Snapshot = () => m5Session;
const subscribeM5 = (listener: () => void) => { m5Listeners.add(listener); return () => { m5Listeners.delete(listener); }; };
export function useMT5DataSession(scope?: "M5") {
  return useSyncExternalStore(scope === "M5" ? subscribeM5 : subscribe, scope === "M5" ? getM5Snapshot : getSnapshot, scope === "M5" ? getM5Snapshot : getSnapshot);
}
