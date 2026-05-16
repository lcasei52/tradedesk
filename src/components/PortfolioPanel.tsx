"use client";

import { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from "react";

interface Position {
  symbol: string;
  name: string;
  market: string;
  quantity: number;
  costPrice: number;
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

  const load = useCallback(() => {
    fetch("/api/positions")
      .then((r) => r.json())
      .then((data: Position[]) => {
        setPositions(data);
        // Fetch quotes for all positions
        data.forEach((pos) => {
          fetch(`/api/quote?symbol=${encodeURIComponent(pos.symbol)}&market=${pos.market}`)
            .then((r) => r.json())
            .then((q) => {
              if (q.price) {
                setQuotes((prev) => {
                  const next = new Map(prev);
                  next.set(pos.symbol, { price: q.price, changePct: q.changePct });
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

  const filtered = filter === "all" ? positions : positions.filter((p) => p.market === filter);
  const totalCost = positions.reduce((s, p) => s + p.costPrice * p.quantity, 0);
  const totalValue = positions.reduce((s, p) => {
    const q = quotes.get(p.symbol);
    return s + (q ? q.price : p.costPrice) * p.quantity;
  }, 0);
  const totalProfit = totalValue - totalCost;
  const totalProfitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const handleDelete = async (symbol: string) => {
    await fetch(`/api/positions?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="text-xs text-muted mb-1">总资产</div>
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
            const currentPrice = q?.price ?? pos.costPrice;
            const changePct = q?.changePct ?? 0;
            const profit = (currentPrice - pos.costPrice) * pos.quantity;
            const profitPct = pos.costPrice > 0 ? ((currentPrice - pos.costPrice) / pos.costPrice) * 100 : 0;
            const marketValue = currentPrice * pos.quantity;

            return (
              <div key={pos.symbol} className="p-3 border-b border-border hover:bg-border/30 group relative">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-sm">{pos.name}</div>
                    <div className="text-xs text-muted">
                      {pos.symbol} · {MARKET_LABELS[pos.market] || pos.market}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${changePct >= 0 ? "text-profit" : "text-loss"}`}>
                      {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
                    </span>
                    <button
                      onClick={() => handleDelete(pos.symbol)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-profit transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="flex justify-between mt-1.5 text-xs">
                  <span className="text-muted">
                    {pos.quantity} 股 · 成本 {pos.costPrice} · 现价 {currentPrice.toFixed(4)}
                  </span>
                  <span className={profit >= 0 ? "text-profit" : "text-loss"}>
                    ¥{marketValue.toFixed(2)} ({profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%)
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
