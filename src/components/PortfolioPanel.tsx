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
  brokerAccountId: string | null;
  exchangeAccount?: { name: string; exchange: string } | null;
  brokerAccount?: { name: string; currency: string } | null;
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
  fund: "基金",
};

interface ExchangeAccountInfo {
  id: string;
  name: string;
  exchange: string;
  futuresBalance: number;
  spotBalance: number;
  fundingBalance: number;
}

interface BrokerAccountInfo {
  id: string;
  name: string;
  currency: string;
  cashBalance: number;
  positionCount: number;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: "¥", USD: "$", HKD: "HK$",
};

const PortfolioPanel = forwardRef<{ reload: () => void }>(function PortfolioPanel(_, ref) {
  useImperativeHandle(ref, () => ({ reload: load }));
  const [positions, setPositions] = useState<Position[]>([]);
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [exchangeAccounts, setExchangeAccounts] = useState<ExchangeAccountInfo[]>([]);
  const [brokerAccounts, setBrokerAccounts] = useState<BrokerAccountInfo[]>([]);
  const [usdCny, setUsdCny] = useState(7.25);
  const [hkdCny, setHkdCny] = useState(0.91);
  const positionsRef = useRef<Position[]>([]);

  const fetchQuotes = useCallback((posList: Position[], isInitial = false) => {
    const symbolMarkets = new Map<string, string>();
    for (const p of posList) {
      if (!symbolMarkets.has(p.symbol)) {
        symbolMarkets.set(p.symbol, p.market);
      }
    }
    const entries = Array.from(symbolMarkets.entries());
    if (isInitial) setQuotesLoading(true);
    Promise.allSettled(
      entries.map(([symbol, market]) =>
        fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}&market=${market}`)
          .then((r) => r.json())
          .then((q) => (q.price ? { symbol, price: q.price, changePct: q.changePct } : null))
          .catch(() => null)
      )
    ).then((results) => {
      setQuotes((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            next.set(r.value.symbol, { price: r.value.price, changePct: r.value.changePct });
          }
        }
        return next;
      });
      setQuotesLoading(false);
    });
  }, []);

  const load = useCallback(() => {
    fetch("/api/positions")
      .then((r) => r.json())
      .then((data: Position[]) => {
        setPositions(data);
        positionsRef.current = data;
        fetchQuotes(data, true);
      })
      .catch(() => {});

    fetch("/api/exchange-accounts")
      .then((r) => r.json())
      .then((data: ExchangeAccountInfo[]) => setExchangeAccounts(data))
      .catch(() => {});

    fetch("/api/broker-accounts")
      .then((r) => r.json())
      .then((data: BrokerAccountInfo[]) => setBrokerAccounts(data))
      .catch(() => {});

    // Fetch exchange rates
    fetch("/api/quote?symbol=USDCNY&market=forex")
      .then((r) => r.json())
      .then((q) => { if (q.price) setUsdCny(q.price); })
      .catch(() => {});
    fetch("/api/quote?symbol=HKDCNY&market=forex")
      .then((r) => r.json())
      .then((q) => { if (q.price) setHkdCny(q.price); })
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

  const effectiveMargin = (p: Position): number => {
    if (p.margin && p.margin > 0) return p.margin;
    const lev = p.leverage || 1;
    const entry = p.entryPrice ?? p.costPrice;
    return entry * p.quantity / lev;
  };

  const filtered = filter === "all" ? positions : positions.filter((p) => p.market === filter);

  const futuresPnl = (p: Position): number => {
    const q = quotes.get(p.symbol);
    const price = q ? q.price : (p.entryPrice ?? p.costPrice);
    const entry = p.entryPrice ?? p.costPrice;
    return p.direction === "short"
      ? (entry - price) * p.quantity
      : (price - entry) * p.quantity;
  };

  const posValue = (p: Position): number | null => {
    if (isFutures(p)) {
      return (effectiveMargin(p) + futuresPnl(p)) * usdCny;
    }
    const q = quotes.get(p.symbol);
    if (!q) return null;
    if (p.market === "crypto") {
      return q.price * p.quantity * usdCny;
    }
    if (p.market === "hk_stock") {
      return q.price * p.quantity * hkdCny;
    }
    if (p.market === "us_stock") {
      return q.price * p.quantity * usdCny;
    }
    return q.price * p.quantity;
  };

  const posCost = (p: Position): number => {
    if (isFutures(p)) return effectiveMargin(p) * usdCny;
    if (p.market === "crypto" && p.costPrice > 0) return p.costPrice * p.quantity * usdCny;
    if (p.market === "crypto") return 0;
    if (p.market === "hk_stock") return p.costPrice * p.quantity * hkdCny;
    if (p.market === "us_stock") return p.costPrice * p.quantity * usdCny;
    return p.costPrice * p.quantity;
  };

  const safeBal = (a: ExchangeAccountInfo) => ({
    futures: a.futuresBalance || 0,
    spot: a.spotBalance || 0,
    funding: a.fundingBalance || 0,
  });

  const futuresMarginTotal = filtered
    .filter((p) => isFutures(p))
    .reduce((s, p) => s + effectiveMargin(p), 0);

  const exchangeBalanceCny = filter === "all" || filter === "crypto"
    ? exchangeAccounts.reduce((s, a) => {
        const b = safeBal(a);
        const unusedFutures = Math.max(b.futures - futuresMarginTotal, 0);
        return s + (unusedFutures + b.spot + b.funding) * usdCny;
      }, 0)
    : 0;

  // Broker account cash, filtered by market/currency and converted to CNY
  const brokerCashCny = brokerAccounts
    .filter((a) => {
      if (filter === "all") return true;
      if (filter === "a_share" || filter === "fund") return a.currency === "CNY";
      if (filter === "us_stock") return a.currency === "USD";
      if (filter === "hk_stock") return a.currency === "HKD";
      return false;
    })
    .reduce((s, a) => {
      if (a.currency === "USD") return s + a.cashBalance * usdCny;
      if (a.currency === "HKD") return s + a.cashBalance * hkdCny;
      return s + a.cashBalance;
    }, 0);

  const allQuotesReady = !quotesLoading && filtered.every((p) => isFutures(p) || quotes.has(p.symbol));
  const displayValue = filtered.reduce((s, p) => {
    const v = posValue(p);
    return s + (v ?? 0);
  }, 0) + exchangeBalanceCny + brokerCashCny;
  const displayCost = filtered.reduce((s, p) => s + posCost(p), 0) + exchangeBalanceCny + brokerCashCny;
  const displayProfit = displayValue - displayCost;
  const displayProfitPct = displayCost > 0 ? (displayProfit / displayCost) * 100 : 0;
  const headerLabel = filter === "all" ? "总资产" : `${MARKET_LABELS[filter] || filter}资产`;

  const handleDelete = async (pos: Position) => {
    if (pos.exchangeAccountId) {
      if (!confirm("该持仓来自交易所同步，删除后下次同步会恢复。确定删除？")) return;
    }
    await fetch(`/api/positions?symbol=${encodeURIComponent(pos.symbol)}&market=${pos.market}`, { method: "DELETE" });
    load();
  };

  const handleDeposit = async (account: BrokerAccountInfo) => {
    const sym = CURRENCY_SYMBOL[account.currency] || "";
    const v = prompt(`${account.name} 入金/出金金额（正数入金，负数出金）:`, "");
    if (v === null || isNaN(Number(v))) return;
    const amount = Number(v);
    const res = await fetch(`/api/broker-accounts/${account.id}/deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    if (res.ok) {
      load();
    } else {
      const data = await res.json();
      alert(data.error || "操作失败");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-muted">{headerLabel}</div>
          {exchangeAccounts.length > 0 && (
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
          {!allQuotesReady && filtered.length > 0
            ? "加载中..."
            : `¥${displayValue.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </div>
        {allQuotesReady || filtered.length === 0 ? (
          <div className={`text-xs mt-1 ${displayProfit >= 0 ? "text-loss" : "text-profit"}`}>
            {displayProfit >= 0 ? "+" : ""}{displayProfit.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            ({displayProfitPct >= 0 ? "+" : ""}{displayProfitPct.toFixed(2)}%)
          </div>
        ) : null}
        <div className="text-xs text-muted mt-0.5">
          成本 ¥{displayCost.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {filtered.length} 只持仓
        </div>
      </div>

      <div className="flex gap-1 p-3 border-b border-border overflow-x-auto">
        {[["all", "全部"], ["a_share", "A 股"], ["hk_stock", "港股"], ["us_stock", "美股"], ["crypto", "加密"], ["fund", "基金"]].map(
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
            const hasQuote = !!q;
            const currentPrice = q?.price ?? pos.entryPrice ?? pos.costPrice;
            const changePct = q?.changePct ?? 0;
            const futures = isFutures(pos);
            const isShort = pos.direction === "short";

            const dailyIsProfit = isShort ? changePct < 0 : changePct >= 0;

            let profit: number;
            let profitPct: number;
            let profitHasCost = true;

            if (futures) {
              const margin = effectiveMargin(pos);
              const entry = pos.entryPrice ?? pos.costPrice;
              profit = isShort
                ? (entry - currentPrice) * pos.quantity * usdCny
                : (currentPrice - entry) * pos.quantity * usdCny;
              profitPct = margin > 0 ? (profit / (margin * usdCny)) * 100 : 0;
            } else if (pos.market === "crypto") {
              if (pos.costPrice > 0) {
                profit = (currentPrice - pos.costPrice) * pos.quantity * usdCny;
                profitPct = ((currentPrice - pos.costPrice) / pos.costPrice) * 100;
              } else {
                profit = 0;
                profitPct = 0;
                profitHasCost = false;
              }
            } else {
              const cnyPrice = pos.market === "hk_stock" ? currentPrice * hkdCny : pos.market === "us_stock" ? currentPrice * usdCny : currentPrice;
              const cnyCost = pos.market === "hk_stock" ? pos.costPrice * hkdCny : pos.market === "us_stock" ? pos.costPrice * usdCny : pos.costPrice;
              profit = (cnyPrice - cnyCost) * pos.quantity;
              profitPct = pos.costPrice > 0 ? ((currentPrice - pos.costPrice) / pos.costPrice) * 100 : 0;
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
                    <span className={`text-xs font-medium ${!hasQuote && !futures ? "text-muted" : dailyIsProfit ? "text-profit" : "text-loss"}`}>
                      {!hasQuote && !futures ? "--" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
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
                  {pos.brokerAccount && !pos.exchangeAccount && <span className="ml-1">({pos.brokerAccount.name})</span>}
                </div>

                {futures ? (
                  <div className="mt-1.5 text-xs space-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-muted">持仓 {(currentPrice * pos.quantity).toFixed(2)} USDT · 保证金 {effectiveMargin(pos).toFixed(2)} USDT</span>
                      <span className={profit >= 0 ? "text-profit" : "text-loss"}>
                        ¥{profit.toFixed(2)} ({profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">开仓 {(pos.entryPrice ?? pos.costPrice).toFixed(2)} · 现价 {currentPrice.toFixed(2)}</span>
                    </div>
                    {pos.liquidationPrice && pos.liquidationPrice > 0 && (
                      <div className="text-muted">强平 {pos.liquidationPrice.toFixed(2)}</div>
                    )}
                  </div>
                ) : (
                  <div className="flex justify-between mt-1.5 text-xs">
                    <span className="text-muted">
                      {!hasQuote
                        ? pos.market === "fund"
                          ? `${pos.quantity} 份 · 成本 ${pos.costPrice.toFixed(4)} · 净值 --`
                          : pos.market === "crypto"
                          ? `${pos.quantity} 枚 · 现价 --`
                          : `${pos.quantity} 股 · 成本 ${pos.costPrice} · 现价 --`
                        : pos.market === "crypto"
                        ? `${pos.quantity} 枚 · 现价 ${currentPrice.toFixed(2)} USDT (¥${(currentPrice * pos.quantity * usdCny).toFixed(2)})`
                        : pos.market === "fund"
                        ? `${pos.quantity} 份 · 成本 ${pos.costPrice.toFixed(4)} · 净值 ${currentPrice.toFixed(4)}`
                        : `${pos.quantity} 股 · 成本 ${pos.costPrice} · 现价 ${currentPrice.toFixed(4)}`}
                    </span>
                    <span className={hasQuote ? (profit >= 0 ? "text-profit" : "text-loss") : "text-muted"}>
                      {!hasQuote ? "--"
                        : profitHasCost
                        ? `¥${(posValue(pos) ?? 0).toFixed(2)} (${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%)`
                        : `¥${(posValue(pos) ?? 0).toFixed(2)}`}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Account balances */}
      <div className="px-3 py-2 border-t border-border text-xs text-muted space-y-1">
        {(filter === "all" || filter === "crypto") && exchangeAccounts.map((a) => {
          const b = safeBal(a);
          const unusedFutures = Math.max(b.futures - futuresMarginTotal, 0);
          const total = (unusedFutures + b.spot + b.funding) * usdCny;
          if (total <= 0 && b.futures <= 0 && b.spot <= 0 && b.funding <= 0) return null;
          return (
            <div key={a.id} className="flex justify-between">
              <span>{a.name}</span>
              <span>
                {b.spot > 0 && <span>现货 {b.spot.toFixed(2)} · </span>}
                {b.futures > 0 && <span>合约 {b.futures.toFixed(2)} (可用 {unusedFutures.toFixed(2)}) · </span>}
                {b.funding > 0 && <span>资金 {b.funding.toFixed(2)} · </span>}
                <span className="text-foreground">¥{total.toFixed(2)}</span>
              </span>
            </div>
          );
        })}
        {brokerAccounts
          .filter((a) => {
            if (filter === "all") return true;
            if (filter === "a_share" || filter === "fund") return a.currency === "CNY";
            if (filter === "us_stock") return a.currency === "USD";
            if (filter === "hk_stock") return a.currency === "HKD";
            return false;
          })
          .map((a) => {
            const sym = CURRENCY_SYMBOL[a.currency] || "";
            const cny = a.currency === "USD" ? a.cashBalance * usdCny : a.currency === "HKD" ? a.cashBalance * hkdCny : a.cashBalance;
            return (
              <div key={a.id} className="flex justify-between items-center">
                <span>{a.name}</span>
                <button
                  onClick={() => handleDeposit(a)}
                  className={`hover:underline ${a.cashBalance < 0 ? "text-loss" : "text-foreground"}`}
                >
                  {a.cashBalance !== 0 ? `${a.cashBalance < 0 ? "" : ""}${sym}${a.cashBalance.toFixed(2)}` : "+ 设置余额"}
                  {a.currency !== "CNY" && a.cashBalance !== 0 && (
                    <span className="text-muted ml-1">(¥{cny.toFixed(2)})</span>
                  )}
                </button>
              </div>
            );
          })}
      </div>

      <div className="p-3 border-t border-border">
        <button
          onClick={() => {
            // Build account options
            const accOptions = brokerAccounts.length > 0
              ? "\n可用账户: " + brokerAccounts.map((a) => a.name).join(" / ")
              : "";

            const input = prompt(
              `格式: 代码 名称 市场(a_share/hk_stock/us_stock/crypto/fund) 数量 成本价 账户名(可选)\n例: 510210 上证指数ETF a_share 41700 0.9684 招商证券${accOptions}`
            );
            if (!input) return;
            const parts = input.split(" ");
            const [symbol, name, market, qty, cost, accountName] = parts;
            if (!symbol || !name || !market || !qty || !cost) return;

            // Find broker account by name if provided
            const brokerId = accountName
              ? brokerAccounts.find((a) => a.name === accountName)?.id
              : brokerAccounts.find((a) => {
                  if (market === "a_share" || market === "fund") return a.currency === "CNY";
                  if (market === "us_stock") return a.currency === "USD";
                  if (market === "hk_stock") return a.currency === "HKD";
                  return false;
                })?.id;

            fetch("/api/positions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                symbol, name, market,
                quantity: Number(qty),
                costPrice: Number(cost),
                brokerAccountId: brokerId || undefined,
              }),
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
