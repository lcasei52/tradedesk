import { Quote } from "./types";
import { getEastmoneyQuote } from "./eastmoney";
import { getYahooQuote } from "./yahoo";
import { getBinanceQuote } from "./binance";
import { getCoinGeckoQuote } from "./coingecko";

// Simple in-memory cache: symbol -> { quote, timestamp }
const cache = new Map<string, { quote: Quote; ts: number }>();
const CACHE_TTL = 10_000; // 10s

// USD/CNY rate cache
let usdCnyRate = 7.25;
let usdCnyTs = 0;
const FOREX_TTL = 300_000; // 5 minutes

export async function getUsdCny(): Promise<number> {
  if (Date.now() - usdCnyTs < FOREX_TTL) return usdCnyRate;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/USDCNY=X?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json = await res.json();
      const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) {
        usdCnyRate = price;
        usdCnyTs = Date.now();
      }
    }
  } catch {}
  return usdCnyRate;
}

export async function getQuote(symbol: string, market?: string): Promise<Quote | null> {
  if (market === "forex" || symbol === "USDCNY") {
    const rate = await getUsdCny();
    return {
      symbol: "USDCNY",
      name: "USD/CNY",
      market: "forex",
      price: rate,
      open: rate,
      high: rate,
      low: rate,
      prevClose: rate,
      volume: 0,
      amount: 0,
      change: 0,
      changePct: 0,
    };
  }

  const cacheKey = `${symbol}:${market ?? "auto"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.quote;

  const quote = await fetchQuote(symbol, market);
  if (quote) cache.set(cacheKey, { quote, ts: Date.now() });
  return quote;
}

async function fetchQuote(symbol: string, market?: string): Promise<Quote | null> {
  const m = detectMarket(symbol, market);

  switch (m) {
    case "a_share":
      return getEastmoneyQuote(symbol);
    case "crypto":
      // Binance first (more precise), CoinGecko fallback (works from China)
      return (await getBinanceQuote(symbol)) || (await getCoinGeckoQuote(symbol));
    case "hk_stock":
    case "us_stock":
      // Try Yahoo first, fallback not available for these markets
      return getYahooQuote(symbol, m);
    default:
      // Unknown: try Eastmoney then Yahoo
      return (await getEastmoneyQuote(symbol)) || (await getYahooQuote(symbol, "us_stock"));
  }
}

function detectMarket(symbol: string, market?: string): string {
  if (market && market !== "auto") return market;

  // Crypto: ends with USDT or is a known crypto ticker
  if (symbol.includes("USDT") || /^[A-Z]{2,5}$/.test(symbol) && !/^\d+$/.test(symbol)) {
    // Could be crypto or US stock — check if it's all digits
    return /^\d{5,6}$/.test(symbol) ? "a_share" : "crypto";
  }

  // A-share: 6-digit number
  if (/^\d{6}$/.test(symbol)) return "a_share";

  // HK: 5-digit number
  if (/^\d{5}$/.test(symbol)) return "hk_stock";

  // US stock: letters (e.g. AAPL)
  return "us_stock";
}

// Get quotes for all positions (used for portfolio display)
export async function getQuotesForSymbols(
  items: { symbol: string; market: string }[]
): Promise<Map<string, Quote>> {
  const results = new Map<string, Quote>();
  const promises = items.map(async ({ symbol, market }) => {
    const quote = await getQuote(symbol, market);
    if (quote) results.set(symbol, quote);
  });
  await Promise.allSettled(promises);
  return results;
}
