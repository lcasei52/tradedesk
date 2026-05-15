"use client";

import { useEffect, useState } from "react";

interface Position {
  symbol: string;
  name: string;
  market: string;
  quantity: number;
  costPrice: number;
}

const MARKET_LABELS: Record<string, string> = {
  a_share: "A 股",
  hk_stock: "港股",
  us_stock: "美股",
  crypto: "加密",
};

export default function PortfolioPanel() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [filter, setFilter] = useState("all");

  const load = () => {
    fetch("/api/positions")
      .then((r) => r.json())
      .then(setPositions)
      .catch(() => {});
  };

  useEffect(load, []);

  const filtered = filter === "all" ? positions : positions.filter((p) => p.market === filter);
  const totalCost = positions.reduce((s, p) => s + p.costPrice * p.quantity, 0);

  const handleDelete = async (symbol: string) => {
    await fetch(`/api/positions?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Total assets */}
      <div className="p-4 border-b border-border">
        <div className="text-xs text-muted mb-1">总投入成本</div>
        <div className="text-2xl font-bold">¥{totalCost.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div className="text-xs text-muted mt-1">{positions.length} 只持仓</div>
      </div>

      {/* Market filter */}
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

      {/* Position list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted">暂无持仓</div>
        ) : (
          filtered.map((pos) => (
            <div
              key={pos.symbol}
              className="p-3 border-b border-border hover:bg-border/30 group relative"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-sm">{pos.name}</div>
                  <div className="text-xs text-muted">
                    {pos.symbol} · {MARKET_LABELS[pos.market] || pos.market}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(pos.symbol)}
                  className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-profit transition-opacity"
                  title="删除"
                >
                  ✕
                </button>
              </div>
              <div className="flex justify-between mt-1.5 text-xs">
                <span className="text-muted">
                  {pos.quantity} 股 · 成本 {pos.costPrice}
                </span>
                <span className="text-muted">
                  ¥{(pos.costPrice * pos.quantity).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add position button */}
      <div className="p-3 border-t border-border">
        <button
          onClick={() => {
            // Quick add via prompt for now — will be replaced by chat interaction
            const input = prompt("格式: 代码 名称 市场(a_share/hk_stock/us_stock/crypto) 数量 成本价\n例: SHA:510210 上证指数ETF a_share 41700 0.9684");
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
}
