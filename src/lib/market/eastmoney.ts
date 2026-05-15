import { Quote } from "./types";

const QUOTE_URL = "https://push2.eastmoney.com/api/qt/stock/get";

const FIELDS = [
  "f43", "f44", "f45", "f46", "f47", "f48",
  "f57", "f58", "f60", "f168", "f162", "f169", "f170",
].join(",");

const INDEX_MAP: Record<string, string> = {
  "000001": "1.000001", // 上证指数
  "399001": "0.399001", // 深证成指
  "399006": "0.399006", // 创业板指
  "000300": "1.000300", // 沪深300
  "000905": "1.000905", // 中证500
  "000852": "1.000852", // 中证1000
};

function secid(symbol: string): string | null {
  if (INDEX_MAP[symbol]) return INDEX_MAP[symbol];
  if (/^[65]\d{5}$/.test(symbol)) return `1.${symbol}`;  // 沪市
  if (/^[03]\d{5}$/.test(symbol)) return `0.${symbol}`;   // 深市
  return null;
}

function num(v: unknown): number {
  if (v == null || v === "-" || v === "") return 0;
  return Number(v);
}

export async function getEastmoneyQuote(symbol: string): Promise<Quote | null> {
  const id = secid(symbol);
  if (!id) return null;

  const url = `${QUOTE_URL}?fltt=2&invt=2&fields=${FIELDS}&secid=${id}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://quote.eastmoney.com/",
    },
    signal: AbortSignal.timeout(8000),
  });

  const json = await res.json();
  if (json.rc !== 0) return null;

  const d = json.data;
  if (!d) return null;

  const price = num(d.f43);
  const prevClose = num(d.f60);

  return {
    symbol: String(d.f57 || symbol),
    name: String(d.f58 || symbol),
    market: "a_share",
    price,
    open: num(d.f46),
    high: num(d.f44),
    low: num(d.f45),
    prevClose,
    volume: num(d.f47),
    amount: num(d.f48),
    change: num(d.f169),
    changePct: num(d.f170),
    turnover: num(d.f168) || undefined,
    pe: num(d.f162) || undefined,
  };
}
