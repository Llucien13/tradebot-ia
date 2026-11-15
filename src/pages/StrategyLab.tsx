import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MarketDataProvider } from "@/components/market-data/MarketDataProvider";

export default function StrategyLabRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/strategy-h1", { replace: true });
  }, [navigate]);
  return null;
}