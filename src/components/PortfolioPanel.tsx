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
  change: number;
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

function EditModal({
  pos,
  brokerAccounts,
  onSave,
  onClose,
}: {
  pos: Position;
  brokerAccounts: BrokerAccountInfo[];
  onSave: (data: { id: string; symbol?: string; quantity?: number; costPrice?: number; brokerAccountId?: string | null }) => void;
  onClose: () => void;
}) {
  const [symbol, setSymbol] = useState(pos.symbol);
  const [quantity, setQuantity] = useState(String(pos.quantity));
  const [costPrice, setCostPrice] = useState(String(pos.costPrice));
  const [accountId, setAccountId] = useState(pos.brokerAccountId ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: pos.id,
      symbol: symbol !== pos.symbol ? symbol : undefined,
      quantity: quantity !== String(pos.quantity) ? Number(quantity) : undefined,
      costPrice: costPrice !== String(pos.costPrice) ? Number(costPrice) : undefined,
      brokerAccountId: accountId !== (pos.brokerAccountId ?? "") ? (accountId || null) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card-bg border border-border rounded-lg p-4 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-medium mb-3">{pos.name} ({pos.symbol})</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">代码</label>
            <input
              type="text" value={symbol} onChange={(e) => setSymbol(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">数量</label>
            <input
              type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">成本价</label>
            <input
              type="number" step="any" value={costPrice} onChange={(e) => setCostPrice(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm outline-none focus:border-primary"
            />
          </div>
          {!pos.exchangeAccountId && brokerAccounts.length > 0 && (
            <div>
              <label className="block text-xs text-muted mb-1">账户</label>
              <select
                value={accountId} onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-border bg-card-bg text-sm outline-none focus:border-primary"
              >
                <option value="">无账户</option>
                {brokerAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="flex-1 py-1.5 rounded bg-primary text-white text-sm">保存</button>
            <button type="button" onClick={onClose} className="flex-1 py-1.5 rounded border border-border text-sm">取消</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AccountManageModal({
  accounts,
  actions,
  onClose,
}: {
  accounts: BrokerAccountInfo[];
  actions: {
    create: (name: string, currency: string, initialBalance: number) => Promise<void>;
    rename: (id: string, name: string) => Promise<void>;
    setBalance: (id: string, cashBalance: number) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState("CNY");
  const [newBalance, setNewBalance] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [balanceId, setBalanceId] = useState<string | null>(null);
  const [editBalance, setEditBalance] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    actions.create(newName.trim(), newCurrency, Number(newBalance) || 0).then(() => {
      setNewName("");
      setNewBalance("0");
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card-bg border border-border rounded-lg p-4 w-96 max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-medium">账户管理</h3>
          <button onClick={onClose} className="text-xs text-muted hover:text-foreground">✕</button>
        </div>

        {/* Account list */}
        {accounts.length === 0 ? (
          <div className="text-xs text-muted text-center py-3">暂无账户</div>
        ) : (
          <div className="space-y-2 mb-4">
            {accounts.map((a) => (
              <div key={a.id} className="border border-border rounded p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  {editingId === a.id ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        value={editName} onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 px-1.5 py-1 rounded border border-border bg-background text-xs outline-none"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editName.trim()) {
                            actions.rename(a.id, editName.trim()).then(() => setEditingId(null));
                          }
                        }}
                        autoFocus
                      />
                      <button onClick={() => { if (editName.trim()) actions.rename(a.id, editName.trim()).then(() => setEditingId(null)); }} className="text-primary">✓</button>
                      <button onClick={() => setEditingId(null)} className="text-muted">✕</button>
                    </div>
                  ) : (
                    <span
                      className="font-medium cursor-pointer hover:text-primary"
                      onClick={() => { setEditingId(a.id); setEditName(a.name); }}
                    >
                      {a.name} <span className="text-muted font-normal">({a.currency})</span>
                    </span>
                  )}
                  <button
                    onClick={() => { if (confirm(`删除 ${a.name}？持仓会被解除关联。`)) actions.delete(a.id); }}
                    className="text-muted hover:text-loss ml-2"
                  >
                    删除
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-muted">余额</span>
                  {balanceId === a.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number" step="any"
                        value={editBalance} onChange={(e) => setEditBalance(e.target.value)}
                        className="w-24 px-1.5 py-1 rounded border border-border bg-background text-xs outline-none text-right"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !isNaN(Number(editBalance))) {
                            actions.setBalance(a.id, Number(editBalance)).then(() => setBalanceId(null));
                          }
                        }}
                        autoFocus
                      />
                      <button onClick={() => { if (!isNaN(Number(editBalance))) actions.setBalance(a.id, Number(editBalance)).then(() => setBalanceId(null)); }} className="text-primary">✓</button>
                      <button onClick={() => setBalanceId(null)} className="text-muted">✕</button>
                    </div>
                  ) : (
                    <span
                      className={`cursor-pointer hover:text-primary ${a.cashBalance < 0 ? "text-loss" : "text-foreground"}`}
                      onClick={() => { setBalanceId(a.id); setEditBalance(parseFloat(a.cashBalance.toFixed(2)).toString()); }}
                    >
                      {CURRENCY_SYMBOL[a.currency]}{a.cashBalance.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create new account */}
        <form onSubmit={handleCreate} className="border-t border-border pt-3 space-y-2">
          <div className="text-xs text-muted">新建账户</div>
          <input
            value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="账户名称"
            className="w-full px-2 py-1.5 rounded border border-border bg-background text-xs outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <select
              value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)}
              className="px-2 py-1.5 rounded border border-border bg-card-bg text-xs outline-none"
            >
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
              <option value="HKD">HKD</option>
            </select>
            <input
              type="number" step="any"
              value={newBalance} onChange={(e) => setNewBalance(e.target.value)}
              placeholder="初始余额"
              className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-xs outline-none focus:border-primary"
            />
          </div>
          <button type="submit" className="w-full py-1.5 rounded bg-primary text-white text-xs">创建</button>
        </form>
      </div>
    </div>
  );
}

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
  const [editingPos, setEditingPos] = useState<Position | null>(null);
  const [showAccountManager, setShowAccountManager] = useState(false);
  const [showTradeHistory, setShowTradeHistory] = useState(false);
  const [totalRealizedPnl, setTotalRealizedPnl] = useState(0);
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
          .then((q) => (q.price ? { symbol, price: q.price, changePct: q.changePct, change: q.change || 0 } : null))
          .catch(() => null)
      )
    ).then((results) => {
      setQuotes((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            next.set(r.value.symbol, { price: r.value.price, changePct: r.value.changePct, change: r.value.change });
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

    fetch("/api/trades")
      .then((r) => r.json())
      .then((data: { totalRealizedPnl: number }) => setTotalRealizedPnl(data.totalRealizedPnl))
      .catch(() => {});

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

  const handleEditSave = async (data: {
    id: string; symbol?: string; quantity?: number; costPrice?: number; brokerAccountId?: string | null;
  }) => {
    const pos = positions.find((p) => p.id === data.id);
    if (!pos) return;

    // If broker account changed, transfer cash
    if (data.brokerAccountId !== undefined && data.brokerAccountId !== pos.brokerAccountId) {
      const amount = pos.costPrice * pos.quantity;
      if (pos.brokerAccountId) {
        await fetch(`/api/broker-accounts/${pos.brokerAccountId}/deposit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount }),
        });
      }
      if (data.brokerAccountId) {
        await fetch(`/api/broker-accounts/${data.brokerAccountId}/deposit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: -amount }),
        });
      }
    }

    // Update position fields
    const updateData: Record<string, unknown> = {};
    if (data.symbol) updateData.symbol = data.symbol;
    if (data.quantity !== undefined) updateData.quantity = data.quantity;
    if (data.costPrice !== undefined) updateData.costPrice = data.costPrice;
    if (data.brokerAccountId !== undefined) updateData.brokerAccountId = data.brokerAccountId;

    if (Object.keys(updateData).length > 0) {
      await fetch("/api/positions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: data.symbol || pos.symbol, market: pos.market, ...updateData }),
      });
    }

    setEditingPos(null);
    load();
  };

  const accountActions = {
    create: async (name: string, currency: string, initialBalance: number) => {
      await fetch("/api/broker-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, currency, initialBalance }),
      });
      load();
    },
    rename: async (id: string, name: string) => {
      await fetch(`/api/broker-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      load();
    },
    setBalance: async (id: string, cashBalance: number) => {
      await fetch(`/api/broker-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashBalance }),
      });
      load();
    },
    delete: async (id: string) => {
      await fetch(`/api/broker-accounts/${id}`, { method: "DELETE" });
      load();
    },
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
            浮动 {displayProfit >= 0 ? "+" : ""}{displayProfit.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            ({displayProfitPct >= 0 ? "+" : ""}{displayProfitPct.toFixed(2)}%)
          </div>
        ) : null}
        {totalRealizedPnl !== 0 && (
          <div className={`text-xs mt-0.5 ${totalRealizedPnl >= 0 ? "text-loss" : "text-profit"}`}>
            已实现 {totalRealizedPnl >= 0 ? "+" : ""}¥{totalRealizedPnl.toFixed(2)}
          </div>
        )}
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

            // Market value in CNY for % calc
            const mktVal = posValue(pos);
            const mktValCny = mktVal ?? 0;
            const totalAssets = displayValue > 0 ? displayValue : 1;

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
                    <button
                      onClick={() => setEditingPos(pos)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-primary transition-opacity"
                      title="编辑"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(pos)}
                      className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-profit transition-opacity"
                      title="删除"
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
                  <div className="mt-1.5 text-xs space-y-0.5">
                    <div className="text-muted">
                      {!hasQuote
                        ? pos.market === "fund"
                          ? `${pos.quantity} 份 · 成本 ${pos.costPrice.toFixed(4)} · 净值 --`
                          : pos.market === "crypto"
                          ? `${pos.quantity} 枚 · 现价 --`
                          : `${pos.quantity} 股 · 成本 ${pos.costPrice} · 现价 --`
                        : pos.market === "crypto"
                        ? `${pos.quantity} 枚 · 现价 ${currentPrice.toFixed(2)} USDT`
                        : pos.market === "fund"
                        ? `${pos.quantity} 份 · 成本 ${pos.costPrice.toFixed(4)} · 净值 ${currentPrice.toFixed(4)}`
                        : `${pos.quantity} 股 · 成本 ${pos.costPrice} · 现价 ${currentPrice.toFixed(4)}`}
                    </div>
                    {hasQuote && (
                      <div className="flex justify-between">
                        <span>
                          <span className="text-muted">市值 </span>
                          <span className="text-foreground">¥{mktValCny.toFixed(2)}</span>
                          <span className="text-muted"> ({((mktValCny / totalAssets) * 100).toFixed(1)}%)</span>
                        </span>
                        {profitHasCost && (
                          <span>
                            <span className="text-muted">收益 </span>
                            <span className={profit >= 0 ? "text-profit" : "text-loss"}>
                              {profit >= 0 ? "+" : ""}¥{profit.toFixed(2)} ({profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%)
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                    {hasQuote && (
                      <div className="flex justify-end">
                        <span>
                          <span className="text-muted">今日 </span>
                          <span className={`font-medium ${dailyIsProfit ? "text-profit" : "text-loss"}`}>
                            {(() => {
                              const changeVal = q?.change ?? 0;
                              const dailyCny = pos.market === "us_stock" ? changeVal * pos.quantity * usdCny
                                : pos.market === "hk_stock" ? changeVal * pos.quantity * hkdCny
                                : pos.market === "crypto" ? changeVal * pos.quantity * usdCny
                                : changeVal * pos.quantity;
                              const sign = dailyCny >= 0 ? "+" : "";
                              return `${sign}¥${dailyCny.toFixed(2)} (${sign}${changePct.toFixed(2)}%)`;
                            })()}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Edit modal */}
      {editingPos && (
        <EditModal
          pos={editingPos}
          brokerAccounts={brokerAccounts}
          onSave={handleEditSave}
          onClose={() => setEditingPos(null)}
        />
      )}

      {/* Account manager modal */}
      {showAccountManager && (
        <AccountManageModal
          accounts={brokerAccounts}
          actions={accountActions}
          onClose={() => setShowAccountManager(false)}
        />
      )}

      {/* Trade history modal */}
      {showTradeHistory && (
        <TradeHistoryModal onClose={() => { setShowTradeHistory(false); load(); }} />
      )}

      {/* Account balances */}
      <div className="px-3 py-2 border-t border-border text-xs text-muted space-y-1">
        <div className="flex justify-between items-center mb-0.5">
          <span>账户</span>
          <button onClick={() => setShowAccountManager(true)} className="text-xs text-primary hover:underline">管理</button>
        </div>
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
              <div key={a.id} className="flex justify-between">
                <span>{a.name}</span>
                <span className={a.cashBalance < 0 ? "text-loss" : "text-foreground"}>
                  {sym}{a.cashBalance.toFixed(2)}
                  {a.currency !== "CNY" && (
                    <span className="text-muted ml-1">(¥{cny.toFixed(2)})</span>
                  )}
                </span>
              </div>
            );
          })}
      </div>

      <div className="p-3 border-t border-border">
        <button
          onClick={() => {
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
        <button
          onClick={() => setShowTradeHistory(true)}
          className="w-full py-1.5 mt-2 text-xs text-muted hover:text-primary transition-colors"
        >
          交易记录
        </button>
      </div>
    </div>
  );
});

interface TradeInfo {
  id: string;
  symbol: string;
  name: string;
  market: string;
  side: string;
  quantity: number;
  price: number;
  costPrice: number;
  realizedPnl: number;
  manual: boolean;
  note: string | null;
  createdAt: string;
}

function TradeHistoryModal({ onClose }: { onClose: () => void }) {
  const [trades, setTrades] = useState<TradeInfo[]>([]);
  const [totalPnl, setTotalPnl] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ symbol: "", name: "", market: "a_share", buyPrice: "", sellPrice: "", quantity: "", note: "" });

  useEffect(() => {
    fetch("/api/trades").then((r) => r.json()).then((data) => {
      setTrades(data.trades || []);
      setTotalPnl(data.totalRealizedPnl || 0);
    }).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { symbol, name, market, buyPrice, sellPrice, quantity, note } = form;
    if (!symbol || !name || !buyPrice || !sellPrice || !quantity) return;
    await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol, name, market, side: "sell",
        quantity: Number(quantity), price: Number(sellPrice), costPrice: Number(buyPrice),
        realizedPnl: (Number(sellPrice) - Number(buyPrice)) * Number(quantity),
        note: note || undefined,
      }),
    });
    setForm({ symbol: "", name: "", market: "a_share", buyPrice: "", sellPrice: "", quantity: "", note: "" });
    setShowForm(false);
    const res = await fetch("/api/trades").then((r) => r.json());
    setTrades(res.trades || []);
    setTotalPnl(res.totalRealizedPnl || 0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card-bg border border-border rounded-lg p-4 w-96 max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-medium">交易记录</h3>
          <button onClick={onClose} className="text-xs text-muted hover:text-foreground">✕</button>
        </div>

        {totalPnl !== 0 && (
          <div className={`text-xs mb-3 ${totalPnl >= 0 ? "text-loss" : "text-profit"}`}>
            累计已实现 {totalPnl >= 0 ? "+" : ""}¥{totalPnl.toFixed(2)}
          </div>
        )}

        {trades.length === 0 ? (
          <div className="text-xs text-muted text-center py-3">暂无交易记录</div>
        ) : (
          <div className="space-y-1.5 mb-3">
            {trades.map((t) => (
              <div key={t.id} className="text-xs border-b border-border pb-1.5">
                <div className="flex justify-between">
                  <span>
                    <span className={`font-medium ${t.side === "buy" ? "text-loss" : "text-profit"}`}>
                      {t.side === "buy" ? "买入" : "卖出"}
                    </span>
                    {" "}{t.name}({t.symbol})
                  </span>
                  <span className="text-muted">{new Date(t.createdAt).toLocaleDateString("zh-CN")}</span>
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-muted">{t.quantity}份 @ {t.price} {t.costPrice !== t.price && `(成本${t.costPrice})`}</span>
                  {t.side === "sell" && (
                    <span className={t.realizedPnl >= 0 ? "text-loss" : "text-profit"}>
                      {t.realizedPnl >= 0 ? "+" : ""}¥{t.realizedPnl.toFixed(2)}
                    </span>
                  )}
                </div>
                {t.note && <div className="text-muted mt-0.5">{t.note}</div>}
                {t.manual && <span className="text-muted text-[10px]">手动录入</span>}
              </div>
            ))}
          </div>
        )}

        {showForm ? (
          <form onSubmit={handleSubmit} className="border-t border-border pt-3 space-y-2">
            <div className="text-xs text-muted">添加历史交易</div>
            <div className="flex gap-2">
              <input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="代码" className="w-20 px-2 py-1.5 rounded border border-border bg-background text-xs outline-none" />
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="名称" className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-xs outline-none" />
            </div>
            <div className="flex gap-2">
              <select value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })} className="px-2 py-1.5 rounded border border-border bg-card-bg text-xs outline-none">
                <option value="a_share">A股</option><option value="hk_stock">港股</option><option value="us_stock">美股</option><option value="crypto">加密</option><option value="fund">基金</option>
              </select>
              <input type="number" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="数量" className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-xs outline-none" />
            </div>
            <div className="flex gap-2">
              <input type="number" step="any" value={form.buyPrice} onChange={(e) => setForm({ ...form, buyPrice: e.target.value })} placeholder="买入价" className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-xs outline-none" />
              <input type="number" step="any" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} placeholder="卖出价" className="flex-1 px-2 py-1.5 rounded border border-border bg-background text-xs outline-none" />
            </div>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="备注（可选）" className="w-full px-2 py-1.5 rounded border border-border bg-background text-xs outline-none" />
            <div className="flex gap-2">
              <button type="submit" className="flex-1 py-1.5 rounded bg-primary text-white text-xs">添加</button>
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-1.5 rounded border border-border text-xs">取消</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setShowForm(true)} className="w-full py-1.5 rounded border border-dashed border-border text-xs text-muted hover:border-primary hover:text-primary transition-colors">
            + 添加历史交易
          </button>
        )}
      </div>
    </div>
  );
}

export default PortfolioPanel;
