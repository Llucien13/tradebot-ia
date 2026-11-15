import type { Dispatch, SetStateAction } from "react";
import { useOutletContext } from "react-router-dom";
import type { FTMOSnapshot } from "@/lib/ftmo-api";

export interface FTMOCosts {
  swapLongUSD: string;
  swapShortUSD: string;
  swapHourUTC: string;
  commissionUSD: string;
  slippageUSD: string;
}
export interface FTMOWorkspace {
  data: FTMOSnapshot | null;
  busy: boolean;
  costs: FTMOCosts;
  setCosts: Dispatch<SetStateAction<FTMOCosts>>;
  action: (path: "feed" | "verify" | "start" | "stop" | "reset") => Promise<void>;
}
export const useFTMOWorkspace = () => useOutletContext<FTMOWorkspace>();
