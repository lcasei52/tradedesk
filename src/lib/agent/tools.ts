import { getQuote } from "@/lib/market";
import { prisma } from "@/lib/db";
import { sendTelegramNotification } from "@/lib/telegram";
import { getTelegramConfig } from "@/lib/config";
import { generateDailyReport, saveDailySnapshot } from "@/lib/report";

interface ToolResult {
  content: string;
  error?: boolean;
}

export const toolDefinitions = [
  {
    name: "get_quote",
    description:
      "获取股票或加密货币的实时行情。支持 A 股（6 位代码如 510210）、港股（5 位代码）、美股（字母代码如 AAPL）、加密货币（如 BTC、ETH、SOL）。market 参数可选：a_share / hk_stock / us_stock / crypto。",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: {
          type: "string",
          description: "股票/加密货币代码，如 510210、AAPL、BTC",
        },
        market: {
          type: "string",
          description: "市场类型：a_share / hk_stock / us_stock / crypto（可选，自动检测）",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_portfolio",
    description: "获取用户当前所有持仓列表，包含代码、名称、市场、数量、成本价。不返回实时行情，需要行情数据请用 get_quote。",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "update_position",
    description:
      "修改持仓。操作类型：buy（买入，增加持仓量和加权平均成本）、sell（卖出，减少持仓量，清零自动删除）。必须提供代码、名称、市场、数量、价格。",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["buy", "sell"],
          description: "操作类型：buy 买入，sell 卖出",
        },
        symbol: {
          type: "string",
          description: "代码，如 510210、AAPL、BTC",
        },
        name: {
          type: "string",
          description: "名称，如 上证指数ETF、苹果、比特币",
        },
        market: {
          type: "string",
          enum: ["a_share", "hk_stock", "us_stock", "crypto"],
          description: "市场",
        },
        quantity: {
          type: "number",
          description: "数量",
        },
        price: {
          type: "number",
          description: "成交价格",
        },
      },
      required: ["action", "symbol", "name", "market", "quantity", "price"],
    },
  },
  {
    name: "push_daily_report",
    description:
      "生成今日持仓日报并推送到 Telegram。当用户要求推送日报、发送报告时调用。无需参数。",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_quote": {
        const symbol = input.symbol as string;
        const market = input.market as string | undefined;
        const quote = await getQuote(symbol, market);
        if (!quote) {
          return { content: `未找到 ${symbol} 的行情数据`, error: true };
        }
        return {
          content: JSON.stringify({
            symbol: quote.symbol,
            name: quote.name,
            market: quote.market,
            price: quote.price,
            changePct: +quote.changePct.toFixed(2),
            volume: quote.volume,
          }),
        };
      }

      case "get_portfolio": {
        const positions = await prisma.position.findMany({
          orderBy: { createdAt: "desc" },
        });
        if (positions.length === 0) {
          return { content: "当前无持仓" };
        }
        return {
          content: JSON.stringify(
            positions.map((p) => ({
              symbol: p.symbol,
              name: p.name,
              market: p.market,
              quantity: p.quantity,
              costPrice: p.costPrice,
            }))
          ),
        };
      }

      case "update_position": {
        const { action, symbol, name, market, quantity, price } = input as {
          action: string;
          symbol: string;
          name: string;
          market: string;
          quantity: number;
          price: number;
        };

        if (action === "buy") {
          const existing = await prisma.position.findUnique({
            where: { symbol },
          });

          if (existing) {
            const totalQty = existing.quantity + quantity;
            const avgCost =
              (existing.costPrice * existing.quantity + price * quantity) /
              totalQty;
            await prisma.position.update({
              where: { symbol },
              data: {
                quantity: totalQty,
                costPrice: Math.round(avgCost * 10000) / 10000,
                name,
                market,
              },
            });
            return {
              content: `买入成功：${name}(${symbol}) +${quantity}股 @ ${price}，当前持有 ${totalQty}股，成本价 ${avgCost.toFixed(4)}`,
            };
          }

          await prisma.position.create({
            data: { symbol, name, market, quantity, costPrice: price },
          });
          return {
            content: `建仓成功：${name}(${symbol}) ${quantity}股 @ ${price}`,
          };
        }

        if (action === "sell") {
          const existing = await prisma.position.findUnique({
            where: { symbol },
          });
          if (!existing) {
            return { content: `未找到 ${symbol} 的持仓`, error: true };
          }

          const remaining = existing.quantity - quantity;
          if (remaining <= 0) {
            await prisma.position.delete({ where: { symbol } });
            return {
              content: `清仓：${name}(${symbol}) 全部卖出 @ ${price}`,
            };
          }

          await prisma.position.update({
            where: { symbol },
            data: { quantity: remaining },
          });
          return {
            content: `卖出成功：${name}(${symbol}) -${quantity}股 @ ${price}，剩余 ${remaining}股`,
          };
        }

        return { content: `未知操作：${action}`, error: true };
      }

      case "push_daily_report": {
        const config = await getTelegramConfig();
        if (!config) {
          return { content: "Telegram 未配置（缺少 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID）", error: true };
        }

        const positions = await prisma.position.findMany();
        if (positions.length === 0) {
          return { content: "当前无持仓，无需推送日报" };
        }

        const report = await generateDailyReport(true);
        const ok = await sendTelegramNotification(config, report);

        if (!ok) {
          return { content: "日报已生成但推送失败（Telegram API 连接错误）", error: true };
        }

        await saveDailySnapshot();

        return { content: `日报已推送到 Telegram ✅` };
      }

      default:
        return { content: `未知工具：${name}`, error: true };
    }
  } catch (err) {
    return {
      content: `工具执行失败：${err instanceof Error ? err.message : String(err)}`,
      error: true,
    };
  }
}
