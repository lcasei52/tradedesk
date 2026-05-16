import { prisma } from "@/lib/db";
import { getQuote } from "@/lib/market";
import { getLLMConfig } from "@/lib/config";
import Anthropic from "@anthropic-ai/sdk";

interface PositionRow {
  symbol: string;
  name: string;
  market: string;
  quantity: number;
  costPrice: number;
}

const MARKET_LABEL: Record<string, string> = {
  a_share: "A股",
  hk_stock: "港股",
  us_stock: "美股",
  crypto: "加密",
};

interface ReportData {
  positions: PositionRow[];
  quotes: Map<string, { price: number; changePct: number } | null>;
  yesterdaySnapshot: { totalAssets: number; totalCost: number } | null;
  recentSnapshots: { date: string; totalAssets: number }[];
  totalCost: number;
  totalValue: number;
  totalProfit: number;
  totalProfitPct: number;
  dailyChange: number;
  dailyChangePct: number;
}

async function collectData(): Promise<ReportData> {
  const positions = await prisma.position.findMany({ orderBy: { market: "asc" } });

  const quotes = new Map<string, { price: number; changePct: number } | null>();
  await Promise.allSettled(
    positions.map(async (pos) => {
      const q = await getQuote(pos.symbol, pos.market);
      quotes.set(pos.symbol, q ? { price: q.price, changePct: q.changePct } : null);
    })
  );

  const totalCost = positions.reduce((s, p) => s + p.costPrice * p.quantity, 0);
  const totalValue = positions.reduce(
    (s, p) => s + (quotes.get(p.symbol)?.price ?? p.costPrice) * p.quantity,
    0
  );
  const totalProfit = totalValue - totalCost;
  const totalProfitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  // Get yesterday's snapshot for daily change
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const yesterdaySnapshot = await prisma.dailySnapshot.findUnique({
    where: { date: yesterdayStr },
  });

  const dailyChange = yesterdaySnapshot ? totalValue - yesterdaySnapshot.totalAssets : 0;
  const dailyChangePct = yesterdaySnapshot?.totalAssets
    ? (dailyChange / yesterdaySnapshot.totalAssets) * 100
    : 0;

  // Recent 7 days for sparkline
  const recentSnapshots = await prisma.dailySnapshot.findMany({
    orderBy: { date: "desc" },
    take: 7,
  });
  recentSnapshots.reverse();

  return {
    positions,
    quotes,
    yesterdaySnapshot: yesterdaySnapshot
      ? { totalAssets: yesterdaySnapshot.totalAssets, totalCost: yesterdaySnapshot.totalCost }
      : null,
    recentSnapshots: recentSnapshots.map((s) => ({ date: s.date, totalAssets: s.totalAssets })),
    totalCost,
    totalValue,
    totalProfit,
    totalProfitPct,
    dailyChange,
    dailyChangePct,
  };
}

function sparkline(values: number[]): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const chars = "▁▂▃▄▅▆▇█";
  return values.map((v) => chars[Math.min(Math.floor(((v - min) / range) * 7), 7)]).join("");
}

function buildMarkdownReport(data: ReportData): string {
  const { positions, quotes, recentSnapshots, totalCost, totalValue, totalProfit, totalProfitPct, dailyChange, dailyChangePct } = data;

  const today = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const lines: string[] = [
    `📊 *TradeDesk 持仓日报*`,
    `📅 ${today}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `*总览*`,
    `  💰 总资产  ¥${totalValue.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `  💵 总成本  ¥${totalCost.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `  📈 累计盈亏  ${totalProfit >= 0 ? "+" : ""}¥${totalProfit.toFixed(2)} (${totalProfitPct >= 0 ? "+" : ""}${totalProfitPct.toFixed(2)}%)`,
    `  📊 日变动  ${dailyChange >= 0 ? "+" : ""}¥${dailyChange.toFixed(2)} (${dailyChangePct >= 0 ? "+" : ""}${dailyChangePct.toFixed(2)}%)`,
    `  📦 持仓数  ${positions.length}`,
  ];

  // Sparkline
  if (recentSnapshots.length >= 2) {
    const values = recentSnapshots.map((s) => s.totalAssets);
    const chart = sparkline(values);
    const first = recentSnapshots[0].date.slice(5);
    const last = recentSnapshots[recentSnapshots.length - 1].date.slice(5);
    lines.push(`  📉 趋势  ${chart}`);
    lines.push(`          ${first} → ${last}`);
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━━━`, ``);

  // Group by market
  const grouped = new Map<string, PositionRow[]>();
  for (const pos of positions) {
    const g = grouped.get(pos.market) || [];
    g.push(pos);
    grouped.set(pos.market, g);
  }

  for (const [market, group] of grouped) {
    const groupValue = group.reduce(
      (s, p) => s + (quotes.get(p.symbol)?.price ?? p.costPrice) * p.quantity,
      0
    );
    const groupPct = totalValue > 0 ? (groupValue / totalValue) * 100 : 0;

    lines.push(`*${MARKET_LABEL[market] || market}*  ¥${groupValue.toFixed(0)} (${groupPct.toFixed(1)}%)`);

    for (const pos of group) {
      const q = quotes.get(pos.symbol);
      const cp = q?.price ?? pos.costPrice;
      const changePct = q?.changePct ?? 0;
      const profit = (cp - pos.costPrice) * pos.quantity;
      const profitPct = pos.costPrice > 0 ? ((cp - pos.costPrice) / pos.costPrice) * 100 : 0;
      const mv = cp * pos.quantity;
      const allocPct = totalValue > 0 ? (mv / totalValue) * 100 : 0;

      const changeIcon = changePct >= 0 ? "🔺" : "🔻";
      const profitIcon = profit >= 0 ? "🔴" : "🟢";

      lines.push(
        `  ${pos.name} (${pos.symbol})`,
        `    ${changeIcon} ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%  ${profitIcon} ${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%  占比 ${allocPct.toFixed(1)}%`,
        `    市值 ¥${mv.toFixed(0)} · 数量 ${pos.quantity}`,
        ``
      );
    }
  }

  // Risk assessment
  lines.push(`━━━━━━━━━━━━━━━━━━━━`, ``);
  lines.push(`*风险评估*`);

  const risks: string[] = [];

  // Concentration risk
  for (const pos of positions) {
    const cp = quotes.get(pos.symbol)?.price ?? pos.costPrice;
    const allocPct = totalValue > 0 ? (cp * pos.quantity / totalValue) * 100 : 0;
    if (allocPct > 50) {
      risks.push(`⚠️ ${pos.name} 占比 ${allocPct.toFixed(1)}%，持仓过于集中`);
    }
  }

  if (positions.length === 1) {
    risks.push("⚠️ 仅持有 1 只标的，集中度风险极高");
  }

  // Market concentration
  for (const [market, group] of grouped) {
    const groupValue = group.reduce(
      (s, p) => s + (quotes.get(p.symbol)?.price ?? p.costPrice) * p.quantity,
      0
    );
    const groupPct = totalValue > 0 ? (groupValue / totalValue) * 100 : 0;
    if (groupPct > 80 && group.length > 0) {
      risks.push(`⚠️ ${MARKET_LABEL[market]}占比 ${groupPct.toFixed(1)}%，市场集中度高`);
    }
  }

  // Profit/loss warnings
  if (totalProfitPct > 20) {
    risks.push(`💡 浮盈 ${totalProfitPct.toFixed(1)}%，可考虑部分止盈`);
  } else if (totalProfitPct < -10) {
    risks.push(`⚠️ 浮亏 ${totalProfitPct.toFixed(1)}%，注意风控`);
  }

  if (risks.length === 0) {
    lines.push(`  ✅ 暂无明显风险信号`);
  } else {
    for (const r of risks) {
      lines.push(`  ${r}`);
    }
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━━━`);

  return lines.join("\n");
}

async function generateLLMCommentary(data: ReportData): Promise<string> {
  const config = await getLLMConfig();
  if (!config.apiKey) return "";

  try {
    const client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });

    // Build position summary for LLM
    const posSummary = data.positions.map((p) => {
      const q = data.quotes.get(p.symbol);
      const cp = q?.price ?? p.costPrice;
      const changePct = q?.changePct ?? 0;
      const profitPct = p.costPrice > 0 ? ((cp - p.costPrice) / p.costPrice) * 100 : 0;
      const allocPct = data.totalValue > 0 ? (cp * p.quantity / data.totalValue) * 100 : 0;
      return `${p.name}(${p.symbol}): 现价${cp.toFixed(4)}, 今日${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%, 盈亏${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%, 占比${allocPct.toFixed(1)}%`;
    }).join("\n");

    const response = await client.messages.create({
      model: config.model,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `你是投资顾问。基于以下持仓数据，用2-3句话给出简短的操作建议或市场观点。直接说重点，不要寒暄。

总资产: ¥${data.totalValue.toFixed(2)}
总盈亏: ${data.totalProfit >= 0 ? "+" : ""}${data.totalProfitPct.toFixed(2)}%
日变动: ${data.dailyChange >= 0 ? "+" : ""}${data.dailyChangePct.toFixed(2)}%

持仓明细:
${posSummary}

给出建议:`,
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return text.trim();
  } catch {
    return "";
  }
}

export async function generateDailyReport(withLLM = true): Promise<string> {
  const data = await collectData();

  if (data.positions.length === 0) {
    return "📭 当前无持仓";
  }

  let report = buildMarkdownReport(data);

  // LLM commentary
  if (withLLM) {
    const commentary = await generateLLMCommentary(data);
    if (commentary) {
      report += `\n\n*AI 点评*\n${commentary}`;
    }
  }

  report += `\n\n━━━━━━━━━━━━━━━━━━━━\n_生成时间: ${new Date().toLocaleString("zh-CN")}_`;

  return report;
}

export async function saveDailySnapshot(data?: ReportData): Promise<void> {
  if (!data) data = await collectData();

  const dateStr = new Date().toISOString().slice(0, 10);
  const positions = await prisma.position.findMany();

  const quotes = new Map<string, number>();
  await Promise.allSettled(
    positions.map(async (p) => {
      const q = await getQuote(p.symbol, p.market);
      if (q) quotes.set(p.symbol, q.price);
    })
  );

  await prisma.dailySnapshot.upsert({
    where: { date: dateStr },
    create: {
      date: dateStr,
      totalAssets: data.totalValue,
      totalCost: data.totalCost,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        name: p.name,
        market: p.market,
        quantity: p.quantity,
        costPrice: p.costPrice,
        currentPrice: quotes.get(p.symbol) ?? p.costPrice,
      })),
    },
    update: {
      totalAssets: data.totalValue,
      totalCost: data.totalCost,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        name: p.name,
        market: p.market,
        quantity: p.quantity,
        costPrice: p.costPrice,
        currentPrice: quotes.get(p.symbol) ?? p.costPrice,
      })),
    },
  });
}
