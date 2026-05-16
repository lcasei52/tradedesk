"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";

interface Snapshot {
  date: string;
  totalAssets: number;
  totalCost: number;
  dailyChange: number;
  dailyChangePct: number;
  returnPct: number;
}

type Range = 30 | 90 | 0;

export default function ChartPanel() {
  const [data, setData] = useState<Snapshot[]>([]);
  const [range, setRange] = useState<Range>(30);
  const [view, setView] = useState<"assets" | "change">("assets");

  const load = useCallback(async () => {
    const days = range === 0 ? 9999 : range;
    const res = await fetch(`/api/snapshots?days=${days}`);
    if (res.ok) setData(await res.json());
  }, [range]);

  useEffect(() => { load(); }, [load]);

  if (data.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted">
        暂无历史数据，推送日报后自动积累
      </div>
    );
  }

  const latestAssets = data[data.length - 1]?.totalAssets ?? 0;
  const firstAssets = data[0]?.totalAssets ?? 0;
  const periodReturn = firstAssets > 0 ? ((latestAssets - firstAssets) / firstAssets) * 100 : 0;

  const formatY = (v: number) => {
    if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
    return v.toFixed(0);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted">资产曲线</span>
          <span className={`text-xs font-medium ${periodReturn >= 0 ? "text-profit" : "text-loss"}`}>
            {periodReturn >= 0 ? "+" : ""}{periodReturn.toFixed(2)}%
          </span>
        </div>
        <div className="flex items-center gap-1">
          {[30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d as Range)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                range === d ? "bg-primary text-white" : "text-muted hover:text-foreground"
              }`}
            >
              {d}天
            </button>
          ))}
          <button
            onClick={() => setRange(0)}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              range === 0 ? "bg-primary text-white" : "text-muted hover:text-foreground"
            }`}
          >
            全部
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setView("assets")}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              view === "assets" ? "bg-border text-foreground" : "text-muted"
            }`}
          >
            曲线
          </button>
          <button
            onClick={() => setView("change")}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              view === "change" ? "bg-border text-foreground" : "text-muted"
            }`}
          >
            日盈亏
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-[160px] px-1 py-2">
        {view === "assets" ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="assetGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(5)}
                tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatY}
                tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                axisLine={false}
                tickLine={false}
                width={48}
                domain={["auto", "auto"]}
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => [`¥${Number(v).toFixed(2)}`, "总资产"]}
                labelFormatter={(l) => String(l)}
                contentStyle={{
                  fontSize: 12,
                  background: "var(--color-card-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                }}
              />
              <Area
                type="monotone"
                dataKey="totalAssets"
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="url(#assetGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(5)}
                tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatY}
                tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => {
                  const n = Number(v);
                  return [`${n >= 0 ? "+" : ""}¥${n.toFixed(2)}`, "日盈亏"];
                }}
                contentStyle={{
                  fontSize: 12,
                  background: "var(--color-card-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                }}
              />
              <Bar
                dataKey="dailyChange"
                radius={[2, 2, 0, 0]}
                fill="var(--color-primary)"
                maxBarSize={16}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
