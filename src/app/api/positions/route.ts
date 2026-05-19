import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const CASH_MARKETS = new Set(["a_share", "hk_stock", "us_stock", "fund"]);

const MARKET_CURRENCY: Record<string, string> = {
  a_share: "CNY", hk_stock: "HKD", us_stock: "USD", fund: "CNY",
};

async function adjustCash(market: string, exchangeAccountId: string | null, brokerAccountId: string | null, delta: number) {
  if (!CASH_MARKETS.has(market) || exchangeAccountId) return;
  if (delta === 0) return;
  if (!brokerAccountId) return;

  await prisma.brokerAccount.update({
    where: { id: brokerAccountId },
    data: { cashBalance: { increment: delta } },
  });
}

// Find or create a default broker account for the given market's currency
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

  if (existing) {
    const totalQty = existing.quantity + quantity;
    const avgCost = (existing.costPrice * existing.quantity + costPrice * quantity) / totalQty;
    const updated = await prisma.position.update({
      where: { id: existing.id },
      data: { quantity: totalQty, costPrice: Math.round(avgCost * 10000) / 10000, name, market },
    });
    await adjustCash(market, existing.exchangeAccountId, existing.brokerAccountId, -buyAmount);
    return NextResponse.json(updated);
  }

  const position = await prisma.position.create({
    data: { symbol, name, market, quantity, costPrice, brokerAccountId },
  });
  await adjustCash(market, null, brokerAccountId, -buyAmount);
  return NextResponse.json(position);
}

// DELETE /api/positions?symbol=xxx&market=yyy — sell all: add back cash
export async function DELETE(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const market = req.nextUrl.searchParams.get("market");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const pos = await prisma.position.findFirst({ where: { symbol, ...(market ? { market } : {}) } });
  if (!pos) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sellAmount = pos.costPrice * pos.quantity;
  await prisma.position.delete({ where: { id: pos.id } });
  await adjustCash(pos.market, pos.exchangeAccountId, pos.brokerAccountId, sellAmount);
  return NextResponse.json({ ok: true });
}

// PUT /api/positions — sell partial: add back cash for sold portion
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { symbol, quantity, costPrice, name, market } = body;

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const pos = await prisma.position.findFirst({ where: { symbol, ...(market ? { market } : {}) } });
  if (!pos) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (quantity !== undefined && quantity <= 0) {
    const sellAmount = pos.costPrice * pos.quantity;
    await prisma.position.delete({ where: { id: pos.id } });
    await adjustCash(pos.market, pos.exchangeAccountId, pos.brokerAccountId, sellAmount);
    return NextResponse.json({ ok: true, deleted: true });
  }

  // Partial sell: cash back for the sold portion
  if (quantity !== undefined && quantity < pos.quantity) {
    const soldQty = pos.quantity - quantity;
    const sellAmount = pos.costPrice * soldQty;
    await adjustCash(pos.market, pos.exchangeAccountId, pos.brokerAccountId, sellAmount);
  }

  const data: Record<string, unknown> = {};
  if (quantity !== undefined) data.quantity = quantity;
  if (costPrice !== undefined) data.costPrice = costPrice;
  if (name) data.name = name;
  if (market) data.market = market;

  const updated = await prisma.position.update({ where: { id: pos.id }, data });
  return NextResponse.json(updated);
}
