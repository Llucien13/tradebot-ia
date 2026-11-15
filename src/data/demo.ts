// Bougies de présentation héritées du provider marché.
// Ne jamais importer ce module dans le moteur de signaux ou de paper trading.
import type { Candle } from "@/types";

// Valeur de départ XAU/USD (or / dollar)
const INITIAL_PRICE = 2654.30;

/**
 * Génération de bougies aléatoires (algorithme de type random walk avec volatilité)
 */
function generateCandles(count: number, startPrice: number, volatility: number = 0.0012): Candle[] {
  const candles: Candle[] = [];
  let currentPrice = startPrice;
  const now = Date.now();
  const interval = 60 * 60 * 1000; // 1h

  for (let i = count; i >= 0; i--) {
    const change = (Math.random() - 0.5) * 2 * volatility * currentPrice;
    const open = currentPrice;
    const close = currentPrice + change;
    const high = Math.max(open, close) + Math.random() * volatility * currentPrice * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * currentPrice * 0.5;
    const volume = Math.floor(Math.random() * 10000) + 1000;

    candles.push({
      time: now - i * interval,
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
  }
  return candles;
}

export const DEMO_CANDLES = generateCandles(200, INITIAL_PRICE);
