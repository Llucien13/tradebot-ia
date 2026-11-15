import type { Candle, IndicatorValues } from "@/types";

export type MarketConnectionStatus = "LIVE" | "DEMO" | "OFFLINE" | "ERROR";
export type MarketDataSource = "TWELVE_DATA" | "DEMO";

export type MarketDataResponse = {
  status: "LIVE";
  candles: Candle[];
  fetchedAt: string;
  volumeAvailable: boolean;
} | {
  status: "DEMO" | "OFFLINE" | "ERROR";
  message: string;
};

export interface MarketDataSnapshot {
  status: MarketConnectionStatus;
  source: MarketDataSource;
  message: string;
  candles: Candle[];
  indicators: IndicatorValues;
  fetchedAt: string | null;
  volumeAvailable: boolean;
}
