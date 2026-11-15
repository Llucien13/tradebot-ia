import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { DEMO_CANDLES } from "@/data/demo";
import { calculateMarketIndicators } from "@/lib/market-indicators";
import type { MarketDataSnapshot } from "@/types/market-data";

const responseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("LIVE"), fetchedAt: z.string().datetime(), volumeAvailable: z.boolean(),
    candles: z.array(z.object({
      time: z.number().finite(), open: z.number().finite().positive(), high: z.number().finite().positive(),
      low: z.number().finite().positive(), close: z.number().finite().positive(), volume: z.number().finite().nonnegative(),
    }).refine((candle) => candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close))).min(50).max(1000)
      .refine((candles) => candles.every((candle, index) => index === 0 || candle.time > candles[index - 1].time)),
  }),
  z.object({ status: z.literal("DEMO"), message: z.string() }),
  z.object({ status: z.literal("OFFLINE"), message: z.string() }),
  z.object({ status: z.literal("ERROR"), message: z.string() }),
]);

const demoSnapshot: MarketDataSnapshot = {
  status: "DEMO", source: "DEMO", message: "Vérification de la connexion. Données DEMO fictives utilisées.",
  candles: DEMO_CANDLES, indicators: calculateMarketIndicators(DEMO_CANDLES), fetchedAt: null, volumeAvailable: true,
};
interface MarketDataContextValue extends MarketDataSnapshot {
  refreshing: boolean;
  refresh: () => Promise<void>;
}
const MarketDataContext = createContext<MarketDataContextValue | null>(null);

export function MarketDataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(demoSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setSnapshot({ ...demoSnapshot, status: "OFFLINE", message: "Navigateur hors ligne. Données DEMO fictives utilisées." });
      return;
    }
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setRefreshing(true);
    const timeout = window.setTimeout(() => controller.abort("timeout"), 18000);
    try {
      const response = await fetch("/api/market-data", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Market API unavailable");
      const data = responseSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      if (data.status === "LIVE") {
        const candles = data.candles.map((candle) => ({
          time: candle.time, open: candle.open, high: candle.high,
          low: candle.low, close: candle.close, volume: candle.volume,
        }));
        setSnapshot({
          status: "LIVE", source: "TWELVE_DATA", candles,
          indicators: calculateMarketIndicators(candles), fetchedAt: data.fetchedAt,
          volumeAvailable: data.volumeAvailable,
          message: "Données XAU/USD réelles via Twelve Data. Bougies 1h, actualisation toutes les 5 minutes ; pas de flux tick par tick.",
        });
      } else {
        setSnapshot({ ...demoSnapshot, status: data.status, message: data.message });
      }
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
      const offline = !navigator.onLine || error instanceof TypeError || controller.signal.reason === "timeout";
      setSnapshot({ ...demoSnapshot, status: offline ? "OFFLINE" : "ERROR", message: offline
        ? "Connexion au serveur impossible ou délai dépassé. Données DEMO fictives utilisées."
        : "Service de données indisponible ou réponse invalide. Données DEMO fictives utilisées." });
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 300000);
    const offline = () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
      setRefreshing(false);
      setSnapshot({ ...demoSnapshot, status: "OFFLINE", message: "Navigateur hors ligne. Données DEMO fictives utilisées." });
    };
    const online = () => { void refresh(); };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [refresh]);

  return <MarketDataContext.Provider value={{ ...snapshot, refreshing, refresh }}>{children}</MarketDataContext.Provider>;
}

export function useMarketData() {
  const context = useContext(MarketDataContext);
  if (!context) throw new Error("useMarketData must be used inside MarketDataProvider");
  return context;
}
