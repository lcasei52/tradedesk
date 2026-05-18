import crypto from "crypto";
import { ExchangeAdapter, ExchangeCredentials, SpotBalance, FuturesPosition } from "./types";

const SPOT_BASE = "https://api.binance.com";
const FUTURES_BASE = "https://fapi.binance.com";

function sign(params: Record<string, string>, secret: string): string {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac("sha256", secret).update(qs).digest("hex");
}

function signedHeaders(apiKey: string): Record<string, string> {
  return { "X-MBX-APIKEY": apiKey };
}

export class BinanceAdapter implements ExchangeAdapter {
  private apiKey: string;
  private apiSecret: string;

  constructor(credentials: ExchangeCredentials) {
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
  }

  async testConnection(): Promise<boolean> {
    try {
      const params: Record<string, string> = { timestamp: Date.now().toString() };
      params.signature = sign(params, this.apiSecret);
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`${SPOT_BASE}/api/v3/account?${qs}`, {
        headers: signedHeaders(this.apiKey),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getSpotBalances(): Promise<SpotBalance[]> {
    const params: Record<string, string> = { timestamp: Date.now().toString() };
    params.signature = sign(params, this.apiSecret);
    const qs = new URLSearchParams(params).toString();

    const res = await fetch(`${SPOT_BASE}/api/v3/account?${qs}`, {
      headers: signedHeaders(this.apiKey),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Binance spot error: ${res.status}`);
    const data = await res.json();

    return (data.balances as { asset: string; free: string; locked: string }[])
      .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
      .map((b) => ({
        asset: b.asset,
        quantity: parseFloat(b.free) + parseFloat(b.locked),
      }));
  }

  async getFuturesPositions(): Promise<FuturesPosition[]> {
    const params: Record<string, string> = { timestamp: Date.now().toString() };
    params.signature = sign(params, this.apiSecret);
    const qs = new URLSearchParams(params).toString();

    const res = await fetch(`${FUTURES_BASE}/fapi/v2/positionRisk?${qs}`, {
      headers: signedHeaders(this.apiKey),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Binance futures error: ${res.status}`);
    const data = await res.json();

    return (data as {
      symbol: string;
      positionAmt: string;
      entryPrice: string;
      leverage: string;
      liquidationPrice: string;
      unRealizedProfit: string;
      initialMargin: string;
    }[])
      .filter((p) => parseFloat(p.positionAmt) !== 0)
      .map((p) => {
        const qty = parseFloat(p.positionAmt);
        const baseAsset = p.symbol.replace(/USDT$/, "");
        const entryPrice = parseFloat(p.entryPrice);
        const leverage = parseInt(p.leverage);
        const quantity = Math.abs(qty);
        const initialMargin = parseFloat(p.initialMargin);
        // Fallback margin: if API returns 0, compute from entry/leverage
        const margin = initialMargin > 0 ? initialMargin : (entryPrice * quantity / leverage);

        return {
          symbol: p.symbol,
          baseAsset,
          direction: qty > 0 ? "long" as const : "short" as const,
          leverage,
          entryPrice,
          quantity,
          liquidationPrice: parseFloat(p.liquidationPrice),
          unrealizedPnl: parseFloat(p.unRealizedProfit),
          margin,
        };
      });
  }

  async getFuturesBalance(): Promise<number> {
    const params: Record<string, string> = { timestamp: Date.now().toString() };
    params.signature = sign(params, this.apiSecret);
    const qs = new URLSearchParams(params).toString();

    const res = await fetch(`${FUTURES_BASE}/fapi/v2/balance?${qs}`, {
      headers: signedHeaders(this.apiKey),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return 0;
    const data = await res.json() as { asset: string; balance: string; availableBalance: string }[];
    const usdt = data.find((b) => b.asset === "USDT");
    return usdt ? parseFloat(usdt.balance) : 0;
  }
}
