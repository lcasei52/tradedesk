import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const CASH_MARKETS = new Set(["a_share", "hk_stock", "us_stock", "fund"]);

const MARKET_CURRENCY: Record<string, string> = {
  a_share: "CNY", hk_stock: "HKD", us_stock: "USD", fund: "CNY",
};

async function findAccountForMarket(market: string): Promise<string | null> {
  const currency = MARKET_CURRENCY[market];
  if (!currency) return null;
  const account = await prisma.brokerAccount.findFirst({ where: { currency } });
  return account?.id ?? null;
}

// GET /api/positions
export async function GET() {
  const positions = await prisma.position.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      exchangeAccount: { select: { name: true, exchange: true } },
      brokerAccount: { select: { name: true, currency: true } },
    },
  });
  return NextResponse.json(positions);
}

// POST /api/positions — buy: deduct cash from broker account
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, name, market, quantity, costPrice, brokerAccountId: inputBrokerId } = body;

  if (!symbol || !name || !market || quantity == null || costPrice == null) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const buyAmount = costPrice * quantity;
  const brokerAccountId = inputBrokerId || await findAccountForMarket(market);

  const existing = await prisma.position.findFirst({
    where: { symbol, market, direction: null, brokerAccountId },
  });

  const result = await prisma.$transaction(async (tx) => {
    // 情况一：已有持仓 → 加仓
    if (existing) {
      const totalQty = existing.quantity + quantity;
      const avgCost = (existing.costPrice * existing.quantity + costPrice * quantity) / totalQty;
      const updated = await tx.position.update({
        where: { id: existing.id },
        data: { quantity: totalQty, costPrice: Math.round(avgCost * 10000) / 10000, name, market },
      });
      if (CASH_MARKETS.has(market) && existing.brokerAccountId) {
        await tx.brokerAccount.update({
          where: { id: existing.brokerAccountId },
          data: { cashBalance: { increment: -buyAmount } },
        });
      }
      await tx.trade.create({
        data: { symbol, name, market, side: "buy", quantity, price: costPrice, costPrice, realizedPnl: 0, brokerAccountId },
      });
      return updated;
    }

    // 情况二：没有持仓 → 新建
    const position = await tx.position.create({
      data: { symbol, name, market, quantity, costPrice, brokerAccountId },
    });
    if (CASH_MARKETS.has(market) && brokerAccountId) {
      await tx.brokerAccount.update({
        where: { id: brokerAccountId },
        data: { cashBalance: { increment: -buyAmount } },
      });
    }
    await tx.trade.create({
      data: { symbol, name, market, side: "buy", quantity, price: costPrice, costPrice, realizedPnl: 0, brokerAccountId },
    });
    return position;
  });

  return NextResponse.json(result);
}

// DELETE /api/positions?symbol=xxx&market=yyy&price=zzz — sell all
export async function DELETE(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const market = req.nextUrl.searchParams.get("market");
  const priceParam = req.nextUrl.searchParams.get("price");

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const pos = await prisma.position.findFirst({ where: { symbol, ...(market ? { market } : {}) } });
  if (!pos) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 卖出价：前端传的市价 > 回退到成本价
  const sellPrice = priceParam ? parseFloat(priceParam) : pos.costPrice;
  const sellAmount = sellPrice * pos.quantity;
  const realizedPnl = (sellPrice - pos.costPrice) * pos.quantity;

  await prisma.$transaction(async (tx) => {
    await tx.trade.create({
      data: {
        symbol: pos.symbol, name: pos.name, market: pos.market,
        side: "sell", quantity: pos.quantity, price: sellPrice, costPrice: pos.costPrice,
        realizedPnl, brokerAccountId: pos.brokerAccountId,
      },
    });
    await tx.position.delete({ where: { id: pos.id } });
    if (CASH_MARKETS.has(pos.market) && pos.brokerAccountId) {
      await tx.brokerAccount.update({
        where: { id: pos.brokerAccountId },
        data: { cashBalance: { increment: sellAmount } },
      });
    }
  });

  return NextResponse.json({ ok: true });
}

// PUT /api/positions — sell partial or edit
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { symbol, quantity, costPrice, name, market, brokerAccountId, price: inputPrice } = body;

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const pos = await prisma.position.findFirst({ where: { symbol, ...(market ? { market } : {}) } });
  if (!pos) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 情况一：数量 ≤ 0 → 等同于全部卖出
  if (quantity !== undefined && quantity <= 0) {
    const sellPrice = inputPrice ?? pos.costPrice;
    const sellAmount = sellPrice * pos.quantity;
    const realizedPnl = (sellPrice - pos.costPrice) * pos.quantity;

    await prisma.$transaction(async (tx) => {
      await tx.trade.create({
        data: {
          symbol: pos.symbol, name: pos.name, market: pos.market,
          side: "sell", quantity: pos.quantity, price: sellPrice, costPrice: pos.costPrice,
          realizedPnl, brokerAccountId: pos.brokerAccountId,
        },
      });
      await tx.position.delete({ where: { id: pos.id } });
      if (CASH_MARKETS.has(pos.market) && pos.brokerAccountId) {
        await tx.brokerAccount.update({
          where: { id: pos.brokerAccountId },
          data: { cashBalance: { increment: sellAmount } },
        });
      }
    });

    return NextResponse.json({ ok: true, deleted: true });
  }

  // 情况二：数量减少 → 部分卖出
  if (quantity !== undefined && quantity < pos.quantity) {
    const soldQty = pos.quantity - quantity;
    const sellPrice = inputPrice ?? pos.costPrice;
    const sellAmount = sellPrice * soldQty;
    const realizedPnl = (sellPrice - pos.costPrice) * soldQty;

    await prisma.$transaction(async (tx) => {
      if (CASH_MARKETS.has(pos.market) && pos.brokerAccountId) {
        await tx.brokerAccount.update({
          where: { id: pos.brokerAccountId },
          data: { cashBalance: { increment: sellAmount } },
        });
      }
      await tx.trade.create({
        data: {
          symbol: pos.symbol, name: pos.name, market: pos.market,
          side: "sell", quantity: soldQty, price: sellPrice, costPrice: pos.costPrice,
          realizedPnl, brokerAccountId: pos.brokerAccountId,
        },
      });
    });
  }

  // 情况三：修改属性，用户传了哪些字段就更新哪些，没传的不动
  const data: Record<string, unknown> = {};
  if (quantity !== undefined) data.quantity = quantity;
  if (costPrice !== undefined) data.costPrice = costPrice;
  if (name) data.name = name;
  if (market) data.market = market;
  if (brokerAccountId !== undefined) data.brokerAccountId = brokerAccountId;

  const updated = await prisma.position.update({ where: { id: pos.id }, data });
  return NextResponse.json(updated);
}
