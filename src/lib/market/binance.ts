import { Quote } from "./types";

export async function getBinanceQuote(symbol: string): Promise<Quote | null> {
  // Normalize: BTC -> BTCUSDT, ETH -> ETHUSDT
  const pair = symbol.includes("USDT") ? symbol : `${symbol}USDT`;

  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) return null;

    const d = await res.json();
    const price = parseFloat(d.lastPrice);
    const prevClose = parseFloat(d.prevClosePrice);

    return {
      symbol,
      name: pair,
      market: "crypto",
      price,
      open: parseFloat(d.openPrice),
      high: parseFloat(d.highPrice),
      low: parseFloat(d.lowPrice),
      prevClose,
      volume: parseFloat(d.volume),
      amount: parseFloat(d.quoteVolume),
      change: price - prevClose,
      changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    };
  } catch {
    return null;
  }
}
