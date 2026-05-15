import { Quote } from "./types";

// Convert symbol to Yahoo Finance format
function toYahooSymbol(symbol: string, market: string): string {
  if (market === "a_share") {
    if (/^[65]/.test(symbol)) return `${symbol}.SS`;
    if (/^[03]/.test(symbol)) return `${symbol}.SZ`;
    return `${symbol}.SS`;
  }
  if (market === "hk_stock") return `${symbol}.HK`;
  // US stocks: use as-is (e.g. AAPL, GOOGL)
  return symbol;
}

export async function getYahooQuote(symbol: string, market: string = "us_stock"): Promise<Quote | null> {
  const yahooSymbol = toYahooSymbol(symbol, market);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];

    const price = meta.regularMarketPrice ?? 0;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? 0;

    return {
      symbol,
      name: meta.shortName ?? symbol,
      market,
      price,
      open: quote?.open?.[0] ?? 0,
      high: quote?.high?.[0] ?? 0,
      low: quote?.low?.[0] ?? 0,
      prevClose,
      volume: quote?.volume?.[0] ?? 0,
      amount: 0,
      change: prevClose ? price - prevClose : 0,
      changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    };
  } catch {
    return null;
  }
}
