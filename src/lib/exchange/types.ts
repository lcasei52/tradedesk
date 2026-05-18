export interface SpotBalance {
  asset: string;
  quantity: number;
  price?: number; // USD price
}

export interface FuturesPosition {
  symbol: string;
  baseAsset: string; // "BTC", "ETH"
  direction: "long" | "short";
  leverage: number;
  entryPrice: number;
  quantity: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  margin: number;
}

export interface ExchangeAdapter {
  testConnection(): Promise<boolean>;
  getSpotBalances(): Promise<SpotBalance[]>;
  getFuturesPositions(): Promise<FuturesPosition[]>;
  getFuturesBalance(): Promise<number>;
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
}
