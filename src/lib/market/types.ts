export interface Quote {
  symbol: string;
  name: string;
  market: string;
  price: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  amount: number;
  change: number;
  changePct: number;
  turnover?: number;
  pe?: number;
}
