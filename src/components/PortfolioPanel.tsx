"use client";

import { useEffect, useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";

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
  const [hasExchangeAccounts, setHasExchangeAccounts] = useState(false);
  const [usdCny, setUsdCny] = useState(7.25);
  const positionsRef = useRef<Position[]>([]);

  const fetchQuotes = useCallback((posList: Position[]) => {
    const symbolMarkets = new Map<string, string>();
    for (const p of posList) {
      if (!symbolMarkets.has(p.symbol)) {
        symbolMarkets.set(p.symbol, p.market);
      }
    }
    const entries = Array.from(symbolMarkets.entries());
    Promise.allSettled(
      entries.map(([symbol, market]) =>
        fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}&market=${market}`)
          .then((r) => r.json())
          .then((q) => (q.price ? { symbol, price: q.price, changePct: q.changePct } : null))
          .catch(() => null)
      )
    ).then((results) => {
      // Merge: only update symbols with successful responses, keep old values for failures
      setQuotes((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            next.set(r.value.symbol, { price: r.value.price, changePct: r.value.changePct });
          }
        }
        return next;
      });
    });
  }, []);

  const load = useCallback(() => {
    fetch("/api/positions")
      .then((r) => r.json())
      .then((data: Position[]) => {
        setPositions(data);
        positionsRef.current = data;
        fetchQuotes(data);
      })
      .catch(() => {});

    fetch("/api/exchange-accounts")
      .then((r) => r.json())
      .then((accounts: unknown[]) => setHasExchangeAccounts(accounts.length > 0))
      .catch(() => {});

    // Fetch USD/CNY rate
    fetch("/api/quote?symbol=USDCNY&market=forex")
      .then((r) => r.json())
      .then((q) => { if (q.price) setUsdCny(q.price); })
      .catch(() => {});
  }, [fetchQuotes]);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (positionsRef.current.length > 0) {
        fetchQuotes(positionsRef.current);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [load, fetchQuotes]);

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

  // For futures: compute effective margin if DB value is 0
  const effectiveMargin = (p: Position): number => {
    if (p.margin && p.margin > 0) return p.margin;
    // Fallback: entryPrice * quantity / leverage
    const lev = p.leverage || 1;
    const entry = p.entryPrice ?? p.costPrice;
    return entry * p.quantity / lev;
  };

  const filtered = filter === "all" ? positions : positions.filter((p) => p.market === filter);

  const posValue = (p: Position): number => {
    if (isFutures(p)) {
      return effectiveMargin(p) + (p.unrealizedPnl ?? 0);
    }
    const q = quotes.get(p.symbol);
    const price = q ? q.price : p.costPrice;
    if (p.market === "crypto") {
      return price * p.quantity * usdCny;
    }
    return price * p.quantity;
  };

  const posCost = (p: Position): number => {
    if (isFutures(p)) return effectiveMargin(p);
    if (p.market === "crypto" && p.costPrice > 0) return p.costPrice * p.quantity * usdCny;
    if (p.market === "crypto") return 0;
    return p.costPrice * p.quantity;
  };

  const displayValue = filtered.reduce((s, p) => s + posValue(p), 0);
  const displayCost = filtered.reduce((s, p) => s + posCost(p), 0);
  const displayProfit = displayValue - displayCost;
  const displayProfitPct = displayCost > 0 ? (displayProfit / displayCost) * 100 : 0;
  const headerLabel = filter === "all" ? "总资产" : `${MARKET_LABELS[filter] || filter}资产`;

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
          <div className="text-xs text-muted">{headerLabel}</div>
          {hasExchangeAccounts && (
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
          ¥{displayValue.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className={`text-xs mt-1 ${displayProfit >= 0 ? "text-loss" : "text-profit"}`}>
          {displayProfit >= 0 ? "+" : ""}{displayProfit.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          ({displayProfitPct >= 0 ? "+" : ""}{displayProfitPct.toFixed(2)}%)
        </div>
        <div className="text-xs text-muted mt-0.5">
          成本 ¥{displayCost.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {filtered.length} 只持仓
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
            const isShort = pos.direction === "short";

            // Direction-aware daily change color
            const dailyIsProfit = isShort ? changePct < 0 : changePct >= 0;

            let profit: number;
            let profitPct: number;
            let profitHasCost = true;
            let displayLine = "";

            if (futures) {
              const margin = effectiveMargin(pos);
              profit = pos.unrealizedPnl ?? 0;
              profitPct = margin > 0 ? (profit / margin) * 100 : 0;
              const entry = pos.entryPrice ?? pos.costPrice;
              displayLine = `持仓 ${pos.quantity} ${pos.symbol} · 保证金 ${margin.toFixed(2)} USDT · 开仓 ${entry.toFixed(2)} · 现价 ${currentPrice.toFixed(2)}`;
              if (pos.liquidationPrice && pos.liquidationPrice > 0) {
                displayLine += ` · 强平 ${pos.liquidationPrice.toFixed(2)}`;
              }
            } else if (pos.market === "crypto") {
              const cnyValue = currentPrice * pos.quantity * usdCny;
              if (pos.costPrice > 0) {
                profit = (currentPrice - pos.costPrice) * pos.quantity * usdCny;
                profitPct = ((currentPrice - pos.costPrice) / pos.costPrice) * 100;
              } else {
                profit = 0;
                profitPct = 0;
                profitHasCost = false;
              }
              displayLine = `${pos.quantity} 枚 · 现价 ${currentPrice.toFixed(2)} USDT (¥${cnyValue.toFixed(2)})`;
            } else {
              profit = (currentPrice - pos.costPrice) * pos.quantity;
              profitPct = pos.costPrice > 0 ? ((currentPrice - pos.costPrice) / pos.costPrice) * 100 : 0;
              displayLine = `${pos.quantity} 股 · 成本 ${pos.costPrice} · 现价 ${currentPrice.toFixed(4)}`;
            }

            const directionLabel = isShort ? "空" : pos.direction === "long" ? "多" : null;

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
                    <span className={`text-xs font-medium ${dailyIsProfit ? "text-profit" : "text-loss"}`}>
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
                  <span className="text-muted">{displayLine}</span>
                  <span className={profit >= 0 ? "text-profit" : "text-loss"}>
                    {futures ? (
                      <>{profit >= 0 ? "+" : ""}{profit.toFixed(2)} USDT ({profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%)</>
                    ) : profitHasCost ? (
                      <>¥{posValue(pos).toFixed(2)} ({profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%)</>
                    ) : (
                      <>¥{posValue(pos).toFixed(2)}</>
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
