import { Quote } from "./types";

const BASE_URL = "https://api.coingecko.com/api/v3";

// Cache coin list to avoid repeated lookups
let coinMap: Map<string, string> | null = null;

async function getCoinId(symbol: string): Promise<string | null> {
  if (!coinMap) {
    try {
      const res = await fetch(`${BASE_URL}/coins/list`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const list: { id: string; symbol: string }[] = await res.json();
      coinMap = new Map(list.map((c) => [c.symbol.toUpperCase(), c.id]));
    } catch {
      return null;
    }
  }
  return coinMap!.get(symbol.toUpperCase()) ?? null;
}

export async function getCoinGeckoQuote(symbol: string): Promise<Quote | null> {
  // Strip USDT suffix if present
  const clean = symbol.replace(/USDT$/i, "");
  const coinId = await getCoinId(clean);
  if (!coinId) return null;

  try {
    const res = await fetch(
      `${BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return null;

    const json = await res.json();
    const data = json[coinId];
    if (!data?.usd) return null;

    const price = data.usd;
    const changePct = data.usd_24h_change ?? 0;

    return {
      symbol,
      name: clean.toUpperCase(),
      market: "crypto",
      price,
      open: 0, // CoinGecko simple API doesn't return open
      high: 0,
      low: 0,
      prevClose: changePct ? price / (1 + changePct / 100) : price,
      volume: data.usd_24h_vol ?? 0,
      amount: 0,
      change: changePct ? price * (changePct / 100) : 0,
      changePct,
    };
  } catch {
    return null;
  }
}
