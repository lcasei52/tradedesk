"use client";

import { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from "react";

interface Position {
  id: string;
  symbol: string;
  name: string;
  market: string;
  quantity: number;
  costPrice: number;
  direction: string | null;
  leverage: number | null;
  margin: number | null;
  liquidationPrice: number | null;
  unrealizedPnl: number | null;
  entryPrice: number | null;
  exchangeAccountId: string | null;
  exchangeAccount?: { name: string; exchange: string } | null;
}

interface Quote {
  price: number;
  changePct: number;
}

const MARKET_LABELS: Record<string, string> = {
  a_share: "A 股",
  hk_stock: "港股",
  us_stock: "美股",
  crypto: "加密",
};

const PortfolioPanel = forwardRef<{ reload: () => void }>(function PortfolioPanel(_, ref) {
  useImperativeHandle(ref, () => ({ reload: load }));
  const [positions, setPositions] = useState<Position[]>([]);
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [filter, setFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/positions")
      .then((r) => r.json())
      .then((data: Position[]) => {
        setPositions(data);
        const symbols = new Set(data.map((p) => p.symbol));
        symbols.forEach((symbol) => {
          const pos = data.find((p) => p.symbol === symbol)!;
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}&market=${pos.market}`)
            .then((r) => r.json())
            .then((q) => {
              if (q.price) {
                setQuotes((prev) => {
                  const next = new Map(prev);
                  next.set(symbol, { price: q.price, changePct: q.changePct });
                  return next;
                });
              }
            })
            .catch(() => {});
        });
      })
      .catch(() => {});
  }, []);

  useEffect(load, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/exchange/sync", { method: "POST" });
      load();
    } finally {
      setSyncing(false);
    }
  };

  const isFutures = (p: Position) => p.direction === "long" || p.direction === "short";
  const unit = (p: Position) => (p.market === "crypto" ? "枚" : "股");

  const filtered = filter === "all" ? positions : positions.filter((p) => p.market === filter);

  // Total value calculation
  const totalValue = positions.reduce((s, p) => {
    if (isFutures(p)) {
      // Futures: margin + unrealized PnL
      const pnl = p.unrealizedPnl ?? 0;
      return s + (p.margin ?? 0) + pnl;
    }
    const q = quotes.get(p.symbol);
    return s + (q ? q.price : p.costPrice) * p.quantity;
  }, 0);
  const totalCost = positions.reduce((s, p) => {
    if (isFutures(p)) return s + (p.margin ?? 0);
    return s + p.costPrice * p.quantity;
  }, 0);
  const totalProfit = totalValue - totalCost;
  const totalProfitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const handleDelete = async (pos: Position) => {
    if (pos.exchangeAccountId) {
      if (!confirm("该持仓来自交易所同步，删除后下次同步会恢复。确定删除？")) return;
    }
    await fetch(`/api/positions?symbol=${encodeURIComponent(pos.symbol)}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-muted">总资产</div>
          {positions.some((p) => p.market === "crypto") && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="text-xs text-muted hover:text-primary transition-colors disabled:opacity-40"
            >
              {syncing ? "同步中..." : "同步交易所"}
            </button>
          )}
        </div>
        <div className="text-2xl font-bold">
          ¥{totalValue.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className={`text-xs mt-1 ${totalProfit >= 0 ? "text-loss" : "text-profit"}`}>
          {totalProfit >= 0 ? "+" : ""}{totalProfit.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          ({totalProfitPct >= 0 ? "+" : ""}{totalProfitPct.toFixed(2)}%)
        </div>
        <div className="text-xs text-muted mt-0.5">
          成本 ¥{totalCost.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {positions.length} 只持仓
        </div>
      </div>

      <div className="flex gap-1 p-3 border-b border-border overflow-x-auto">
        {[["all", "全部"], ["a_share", "A 股"], ["hk_stock", "港股"], ["us_stock", "美股"], ["crypto", "加密"]].map(
          ([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-2.5 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
                filter === key ? "bg-primary text-white" : "bg-card-bg border border-border hover:bg-border"
              }`}
            >
              {label}
            </button>
          )
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted">暂无持仓</div>
        ) : (
          filtered.map((pos) => {
            const q = quotes.get(pos.symbol);
            const currentPrice = q?.price ?? pos.entryPrice ?? pos.costPrice;
            const changePct = q?.changePct ?? 0;
            const futures = isFutures(pos);

            let profit: number;
            let profitPct: number;
            let displayValue: number;

            if (futures) {
              profit = pos.unrealizedPnl ?? 0;
              const margin = pos.margin ?? 0;
              profitPct = margin > 0 ? (profit / margin) * 100 : 0;
              displayValue = margin + profit;
            } else {
              profit = (currentPrice - pos.costPrice) * pos.quantity;
              profitPct = pos.costPrice > 0 ? ((currentPrice - pos.costPrice) / pos.costPrice) * 100 : 0;
              displayValue = currentPrice * pos.quantity;
            }

            const directionLabel = pos.direction === "long" ? "多" : pos.direction === "short" ? "空" : null;

            return (
              <div key={pos.id} className="p-3 border-b border-border hover:bg-border/30 group relative">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm">{pos.name}</span>
                    {directionLabel && (
                      <span className={`text-xs px-1 py-0.5 rounded font-medium ${
                        pos.direction === "long" ? "bg-profit/20 text-profit" : "bg-loss/20 text-loss"
                      }`}>
                        {directionLabel}
                      </span>
                    )}
                    {pos.leverage && (
                      <span className="text-xs text-muted">{pos.leverage}x</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${changePct >= 0 ? "text-profit" : "text-loss"}`}>
                      {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
                    </span>
                    <button
                      onClick={() => handleDelete(pos)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-profit transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {pos.symbol} · {MARKET_LABELS[pos.market] || pos.market}
                  {pos.exchangeAccount && <span className="ml-1">({pos.exchangeAccount.name})</span>}
                </div>
                <div className="flex justify-between mt-1.5 text-xs">
                  <span className="text-muted">
                    {futures ? (
                      <>
                        {pos.quantity} {unit(pos)} · 开仓 {(pos.entryPrice ?? pos.costPrice).toFixed(4)} · 现价 {currentPrice.toFixed(4)}
                        {pos.liquidationPrice && pos.liquidationPrice > 0 && (
                          <span className="ml-1 text-loss">强平 {pos.liquidationPrice.toFixed(4)}</span>
                        )}
                      </>
                    ) : (
                      <>
                        {pos.quantity} {unit(pos)} · 成本 {pos.costPrice} · 现价 {currentPrice.toFixed(4)}
                      </>
                    )}
                  </span>
                  <span className={profit >= 0 ? "text-profit" : "text-loss"}>
                    {futures ? (
                      <>{profit >= 0 ? "+" : ""}{profit.toFixed(2)} USDT ({profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%)</>
                    ) : (
                      <>¥{displayValue.toFixed(2)} ({profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%)</>
                    )}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-border">
        <button
          onClick={() => {
            const input = prompt("格式: 代码 名称 市场(a_share/hk_stock/us_stock/crypto) 数量 成本价\n例: 510210 上证指数ETF a_share 41700 0.9684");
            if (!input) return;
            const [symbol, name, market, qty, cost] = input.split(" ");
            fetch("/api/positions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ symbol, name, market, quantity: Number(qty), costPrice: Number(cost) }),
            }).then(() => load());
          }}
          className="w-full py-2 text-sm rounded-md border border-dashed border-border text-muted hover:border-primary hover:text-primary transition-colors"
        >
          + 添加持仓
        </button>
      </div>
    </div>
  );
});

export default PortfolioPanel;
