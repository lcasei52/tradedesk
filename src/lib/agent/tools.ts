import { getQuote } from "@/lib/market";
import { prisma } from "@/lib/db";
import { sendTelegramNotification } from "@/lib/telegram";
import { getTelegramConfig } from "@/lib/config";
import { generateDailyReport, saveDailySnapshot } from "@/lib/report";

interface ToolResult {
  content: string;
  error?: boolean;
}

const CASH_MARKETS = new Set(["a_share", "hk_stock", "us_stock", "fund"]);

const MARKET_CURRENCY: Record<string, string> = {
  a_share: "CNY", hk_stock: "HKD", us_stock: "USD", fund: "CNY",
};

async function adjustCash(market: string, brokerAccountId: string | null, delta: number) {
  if (!CASH_MARKETS.has(market) || delta === 0 || !brokerAccountId) return;
  await prisma.brokerAccount.update({
    where: { id: brokerAccountId },
    data: { cashBalance: { increment: delta } },
  });
}

async function findAccountForMarket(market: string): Promise<string | null> {
  const currency = MARKET_CURRENCY[market];
  if (!currency) return null;
  const account = await prisma.brokerAccount.findFirst({ where: { currency } });
  return account?.id ?? null;
}

export const toolDefinitions = [
  {
    name: "get_quote",
    description:
      "获取股票或加密货币的实时行情。支持 A 股（6位代码）、港股（5位代码）、美股（字母代码）、加密货币、基金（6位代码）。",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "代码，如 510210、AAPL、BTC" },
        market: { type: "string", description: "市场：a_share / hk_stock / us_stock / crypto / fund（可选，自动检测）" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_portfolio",
    description: "获取用户当前所有持仓列表，包含代码、名称、市场、数量、成本价，以及合约的方向、杠杆、未实现盈亏等。不返回实时行情，需要行情数据请用 get_quote。",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_account_balances",
    description: "查询账户余额详情，包括各交易所账户的现货余额、合约余额、资金账户余额，以及证券现金余额。",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_snapshots",
    description: "查询最近N天的资产快照趋势数据，包括每日总资产、总成本、日变动。用于回答'最近收益如何'、'资产走势'等问题。",
    input_schema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "查询天数，默认7天" },
      },
    },
  },
  {
    name: "sync_crypto",
    description: "从交易所同步加密货币持仓（现货+合约）和账户余额。当用户说'同步持仓'、'刷新加密仓位'时调用。",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "update_position",
    description:
      "修改持仓。操作类型：buy（买入）、sell（卖出，清零自动删除）。必须提供代码、名称、市场、数量、价格。**name 必须来自 get_quote 返回的真实名称，不要猜测**。调用前必须先调用 get_quote 获取正确名称，再调用 get_portfolio 确认持仓状态。",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["buy", "sell"], description: "操作类型" },
        symbol: { type: "string", description: "代码" },
        name: { type: "string", description: "名称" },
        market: { type: "string", enum: ["a_share", "hk_stock", "us_stock", "crypto", "fund"], description: "市场" },
        quantity: { type: "number", description: "数量" },
        price: { type: "number", description: "成交价格" },
        broker_account: { type: "string", description: "券商账户名称（可选，不填则使用默认账户）" },
      },
      required: ["action", "symbol", "name", "market", "quantity", "price"],
    },
  },
  {
    name: "edit_position",
    description: "修改已有持仓的信息（成本价、名称、所属账户），不改变数量和余额。用于用户说'把XX的成本改成Y'、'修改XX的名称'、'把XX移到招商证券账户'。",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "代码" },
        market: { type: "string", description: "市场：a_share / hk_stock / us_stock / crypto / fund（可选，用于区分同代码不同市场）" },
        costPrice: { type: "number", description: "新的成本价（可选）" },
        name: { type: "string", description: "新的名称（可选）" },
        broker_account: { type: "string", description: "移动到的券商账户名称（可选）" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "update_cash_balance",
    description: "设置券商账户现金余额。当用户说'我的证券现金是X'、'余额改为X'、'设置余额X'时调用。直接设置为指定金额，不是增减。会更新默认CNY券商账户的余额。",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number", description: "新的余额金额（元）" },
      },
      required: ["amount"],
    },
  },
  {
    name: "manage_broker_account",
    description: "管理券商账户：创建、查询列表、入金、出金。当用户说'添加账户'、'入金X'、'出金X'、'查账户余额'时调用。",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["create", "list", "deposit", "withdraw"], description: "操作类型" },
        account_name: { type: "string", description: "账户名称（create/deposit/withdraw时必填）" },
        currency: { type: "string", enum: ["CNY", "USD", "HKD"], description: "币种（create时使用，默认CNY）" },
        initial_balance: { type: "number", description: "初始余额（create时使用，默认0）" },
        amount: { type: "number", description: "金额（deposit/withdraw时必填）" },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_conversation",
    description: "管理对话：创建新对话、重命名当前对话、删除对话。当用户说'新建对话'、'改名'、'删除对话'时调用。",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["create", "rename", "delete"], description: "操作类型" },
        title: { type: "string", description: "新对话标题或重命名的新标题（create/rename时必填）" },
        conversation_id: { type: "string", description: "要操作的对话ID（delete/rename时使用，不填则为当前对话）" },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_exchange_account",
    description: "管理交易所账号：添加或删除。添加时需要API Key和Secret，会自动测试连接。删除时会同时移除该账号同步的持仓。",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["add", "delete"], description: "操作类型" },
        name: { type: "string", description: "账号名称，如'币安主号'（add时必填）" },
        exchange: { type: "string", enum: ["binance"], description: "交易所（add时必填）" },
        apiKey: { type: "string", description: "API Key（add时必填）" },
        apiSecret: { type: "string", description: "API Secret（add时必填）" },
        account_id: { type: "string", description: "要删除的账号ID（delete时必填）" },
      },
      required: ["action"],
    },
  },
  {
    name: "push_daily_report",
    description: "生成今日持仓日报并推送到 Telegram。",
    input_schema: { type: "object" as const, properties: {} },
  },
];

interface ToolContext {
  conversationId?: string;
  appUrl?: string;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx?: ToolContext
): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_quote": {
        const symbol = input.symbol as string;
        const market = input.market as string | undefined;
        const quote = await getQuote(symbol, market);
        if (!quote) return { content: `未找到 ${symbol} 的行情数据`, error: true };
        return {
          content: JSON.stringify({
            symbol: quote.symbol, name: quote.name, market: quote.market,
            price: quote.price, changePct: +quote.changePct.toFixed(2), volume: quote.volume,
          }),
        };
      }

      case "get_portfolio": {
        const positions = await prisma.position.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            exchangeAccount: { select: { name: true } },
            brokerAccount: { select: { name: true, currency: true } },
          },
        });
        if (positions.length === 0) return { content: "当前无持仓" };
        return {
          content: JSON.stringify(positions.map((p) => ({
            symbol: p.symbol, name: p.name, market: p.market, quantity: p.quantity,
            costPrice: p.costPrice, direction: p.direction, leverage: p.leverage,
            margin: p.margin, entryPrice: p.entryPrice, unrealizedPnl: p.unrealizedPnl,
            liquidationPrice: p.liquidationPrice, exchangeAccount: p.exchangeAccount?.name ?? null,
            brokerAccount: p.brokerAccount?.name ?? null,
          }))),
        };
      }

      case "get_account_balances": {
        const [accounts, brokerAccounts] = await Promise.all([
          prisma.exchangeAccount.findMany(),
          prisma.brokerAccount.findMany(),
        ]);
        const result = {
          exchanges: accounts.map((a) => ({
            name: a.name, exchange: a.exchange,
            spot: a.spotBalance || 0, futures: a.futuresBalance || 0, funding: a.fundingBalance || 0,
          })),
          brokerAccounts: brokerAccounts.map((a) => ({
            name: a.name, currency: a.currency, cashBalance: a.cashBalance,
          })),
        };
        return { content: JSON.stringify(result) };
      }

      case "get_snapshots": {
        const days = (input.days as number) || 7;
        const since = new Date();
        since.setDate(since.getDate() - days);
        const snapshots = await prisma.dailySnapshot.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { date: "asc" },
          select: { date: true, totalAssets: true, totalCost: true },
        });
        if (snapshots.length === 0) return { content: "暂无历史快照数据" };
        const data = snapshots.map((s, i) => ({
          date: s.date, totalAssets: s.totalAssets, totalCost: s.totalCost,
          dailyChange: i > 0 ? +(s.totalAssets - snapshots[i - 1].totalAssets).toFixed(2) : 0,
          dailyChangePct: i > 0 && snapshots[i - 1].totalAssets > 0
            ? +(((s.totalAssets - snapshots[i - 1].totalAssets) / snapshots[i - 1].totalAssets) * 100).toFixed(2)
            : 0,
        }));
        return { content: JSON.stringify(data) };
      }

      case "sync_crypto": {
        const accounts = await prisma.exchangeAccount.findMany();
        if (accounts.length === 0) return { content: "未配置交易所账号，请先在设置页添加", error: true };
        const res = await fetch(`${ctx?.appUrl || "http://localhost:3000"}/api/exchange/sync`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) return { content: `同步失败：${data.error || "未知错误"}`, error: true };
        const summary = (data.results || [])
          .map((r: { account: string; spot: number; futures: number; errors: string[] }) => {
            if (r.errors.length > 0) return `${r.account}: ${r.errors.join(", ")}`;
            return `${r.account}: 现货${r.spot}个, 合约${r.futures}个`;
          }).join("; ");
        return { content: `同步完成 — ${summary}` };
      }

      case "update_position": {
        const { action, symbol, name: llmName, market, quantity, price, broker_account } = input as {
          action: string; symbol: string; name: string; market: string; quantity: number; price: number; broker_account?: string;
        };
        // Resolve broker account
        let brokerAccountId: string | null = null;
        if (broker_account) {
          const acc = await prisma.brokerAccount.findFirst({ where: { name: broker_account } });
          if (acc) brokerAccountId = acc.id;
        }
        if (!brokerAccountId) brokerAccountId = await findAccountForMarket(market);

        if (action === "buy") {
          let realName = llmName;
          try {
            const quote = await getQuote(symbol, market);
            if (quote?.name) realName = quote.name;
          } catch {}
          const amount = price * quantity;
          const existing = await prisma.position.findFirst({ where: { symbol, market, direction: null, brokerAccountId } });
          if (existing) {
            const totalQty = existing.quantity + quantity;
            const avgCost = (existing.costPrice * existing.quantity + price * quantity) / totalQty;
            await prisma.position.update({
              where: { id: existing.id },
              data: { quantity: totalQty, costPrice: Math.round(avgCost * 10000) / 10000, name: realName, market },
            });
            await adjustCash(market, existing.brokerAccountId, -amount);
            return { content: `买入成功：${realName}(${symbol}) +${quantity}股 @ ${price}，当前持有 ${totalQty}股，成本价 ${avgCost.toFixed(4)}` };
          }
          await prisma.position.create({ data: { symbol, name: realName, market, quantity, costPrice: price, brokerAccountId } });
          await adjustCash(market, brokerAccountId, -amount);
          return { content: `建仓成功：${realName}(${symbol}) ${quantity}股 @ ${price}` };
        }
        if (action === "sell") {
          const existing = await prisma.position.findFirst({ where: { symbol, market, direction: null, brokerAccountId } });
          if (!existing) return { content: `未找到 ${symbol} 的持仓`, error: true };
          const realName = existing.name;
          const sellAmount = price * Math.min(quantity, existing.quantity);
          const remaining = existing.quantity - quantity;
          if (remaining <= 0) {
            await prisma.position.delete({ where: { id: existing.id } });
            await adjustCash(market, existing.brokerAccountId, sellAmount);
            return { content: `清仓：${realName}(${symbol}) 全部卖出 @ ${price}` };
          }
          await prisma.position.update({ where: { id: existing.id }, data: { quantity: remaining } });
          await adjustCash(market, existing.brokerAccountId, sellAmount);
          return { content: `卖出成功：${realName}(${symbol}) -${quantity}股 @ ${price}，剩余 ${remaining}股` };
        }
        return { content: `未知操作：${action}`, error: true };
      }

      case "edit_position": {
        const { symbol, market, costPrice, name, broker_account } = input as { symbol: string; market?: string; costPrice?: number; name?: string; broker_account?: string };
        const existing = await prisma.position.findFirst({ where: { symbol, ...(market ? { market } : {}), direction: null } });
        if (!existing) return { content: `未找到 ${symbol} 的持仓`, error: true };
        const data: Record<string, unknown> = {};
        if (costPrice !== undefined) data.costPrice = costPrice;
        if (name) data.name = name;
        if (broker_account) {
          const acc = await prisma.brokerAccount.findFirst({ where: { name: broker_account } });
          if (!acc) return { content: `未找到券商账户 "${broker_account}"，请先通过 manage_broker_account 创建`, error: true };
          data.brokerAccountId = acc.id;
        }
        if (Object.keys(data).length === 0) return { content: "没有需要修改的字段", error: true };
        await prisma.position.update({ where: { id: existing.id }, data });
        const changes: string[] = [];
        if (costPrice !== undefined) changes.push(`成本价 → ${costPrice}`);
        if (name) changes.push(`名称 → ${name}`);
        if (broker_account) changes.push(`账户 → ${broker_account}`);
        return { content: `已修改 ${existing.name}(${symbol})：${changes.join("，")}` };
      }

      case "update_cash_balance": {
        const amount = input.amount as number;
        const account = await prisma.brokerAccount.findFirst({ where: { currency: "CNY" } });
        if (!account) return { content: "未找到CNY券商账户", error: true };
        await prisma.brokerAccount.update({ where: { id: account.id }, data: { cashBalance: amount } });
        return { content: `${account.name} 现金余额已设置为 ¥${amount.toFixed(2)}` };
      }

      case "manage_broker_account": {
        const { action, account_name, amount, currency, initial_balance } = input as {
          action: string; account_name?: string; amount?: number; currency?: string; initial_balance?: number;
        };
        if (action === "create") {
          if (!account_name) return { content: "请提供账户名称", error: true };
          const cur = currency || "CNY";
          const existing = await prisma.brokerAccount.findFirst({ where: { name: account_name } });
          if (existing) return { content: `账户 "${account_name}" 已存在`, error: true };
          const acc = await prisma.brokerAccount.create({
            data: { name: account_name, currency: cur, cashBalance: initial_balance || 0 },
          });
          const prefix = cur === "CNY" ? "¥" : cur === "USD" ? "$" : "HK$";
          return { content: `券商账户 "${account_name}" 已创建，币种 ${cur}，余额 ${prefix}${(initial_balance || 0).toFixed(2)}` };
        }
        if (action === "list") {
          const accounts = await prisma.brokerAccount.findMany({ orderBy: { createdAt: "asc" } });
          if (accounts.length === 0) return { content: "暂无券商账户" };
          return { content: JSON.stringify(accounts.map((a) => ({ name: a.name, currency: a.currency, cashBalance: a.cashBalance }))) };
        }
        if (action === "deposit" || action === "withdraw") {
          if (!account_name) return { content: "请提供账户名称", error: true };
          const acc = await prisma.brokerAccount.findFirst({ where: { name: account_name } });
          if (!acc) return { content: `未找到账户 "${account_name}"`, error: true };
          if (amount === undefined || amount <= 0) return { content: "请提供正数金额", error: true };
          const delta = action === "deposit" ? amount : -amount;
          const newBalance = acc.cashBalance + delta;
          if (newBalance < 0) return { content: `余额不足（当前 ${acc.currency === "CNY" ? "¥" : acc.currency === "USD" ? "$" : "HK$"}${acc.cashBalance.toFixed(2)}）`, error: true };
          await prisma.brokerAccount.update({ where: { id: acc.id }, data: { cashBalance: newBalance } });
          const prefix = acc.currency === "CNY" ? "¥" : acc.currency === "USD" ? "$" : "HK$";
          return { content: `${acc.name} ${action === "deposit" ? "入金" : "出金"} ${prefix}${amount.toFixed(2)}，当前余额 ${prefix}${newBalance.toFixed(2)}` };
        }
        return { content: `未知操作：${action}`, error: true };
      }

      case "manage_conversation": {
        const { action, title, conversation_id } = input as {
          action: string; title?: string; conversation_id?: string;
        };
        if (action === "create") {
          const conv = await prisma.conversation.create({
            data: { title: title || "新对话", messages: [] },
          });
          return { content: `新对话已创建：${conv.title}（ID: ${conv.id}）` };
        }
        if (action === "rename") {
          const id = conversation_id || ctx?.conversationId;
          if (!id) return { content: "未指定对话ID", error: true };
          if (!title) return { content: "请提供新标题", error: true };
          await prisma.conversation.update({ where: { id }, data: { title } });
          return { content: `对话已重命名为：${title}` };
        }
        if (action === "delete") {
          const id = conversation_id || ctx?.conversationId;
          if (!id) return { content: "未指定对话ID", error: true };
          await prisma.conversation.delete({ where: { id } });
          return { content: "对话已删除" };
        }
        return { content: `未知操作：${action}`, error: true };
      }

      case "manage_exchange_account": {
        const { action, name, exchange, apiKey, apiSecret, account_id } = input as {
          action: string; name?: string; exchange?: string; apiKey?: string; apiSecret?: string; account_id?: string;
        };
        if (action === "add") {
          if (!name || !exchange || !apiKey || !apiSecret) {
            return { content: "添加账号需要提供：name, exchange, apiKey, apiSecret", error: true };
          }
          // Test connection first
          const { BinanceAdapter } = await import("@/lib/exchange/binance");
          const adapter = new BinanceAdapter({ apiKey, apiSecret });
          const ok = await adapter.testConnection();
          if (!ok) return { content: "连接测试失败，请检查 API Key 和 Secret", error: true };
          const account = await prisma.exchangeAccount.create({
            data: { name, exchange, apiKey, apiSecret },
          });
          return { content: `交易所账号 "${name}" 添加成功（ID: ${account.id}），连接测试通过` };
        }
        if (action === "delete") {
          if (!account_id) return { content: "请提供要删除的账号ID，可先通过 get_account_balances 查看所有账号", error: true };
          await prisma.position.deleteMany({ where: { exchangeAccountId: account_id } });
          await prisma.exchangeAccount.delete({ where: { id: account_id } });
          return { content: "交易所账号已删除，关联的同步持仓也已移除" };
        }
        return { content: `未知操作：${action}`, error: true };
      }

      case "push_daily_report": {
        const config = await getTelegramConfig();
        if (!config) return { content: "Telegram 未配置", error: true };
        const positions = await prisma.position.findMany();
        if (positions.length === 0) return { content: "当前无持仓，无需推送日报" };
        const report = await generateDailyReport(true);
        const ok = await sendTelegramNotification(config, report);
        if (!ok) return { content: "日报已生成但推送失败", error: true };
        await saveDailySnapshot();
        return { content: `日报已推送到 Telegram ✅` };
      }

      default:
        return { content: `未知工具：${name}`, error: true };
    }
  } catch (err) {
    return { content: `工具执行失败：${err instanceof Error ? err.message : String(err)}`, error: true };
  }
}
