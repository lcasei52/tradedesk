import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/trades — list trades
export async function GET(req: NextRequest) {
  const market = req.nextUrl.searchParams.get("market");
  const trades = await prisma.trade.findMany({
    where: market ? { market } : undefined,
    orderBy: { createdAt: "desc" },
    include: { brokerAccount: { select: { name: true, currency: true } } },
    take: 200,
  });
  const totalRealizedPnl = await prisma.trade.aggregate({
    where: { side: "sell" },
    _sum: { realizedPnl: true },
  });
  return NextResponse.json({
    trades,
    totalRealizedPnl: totalRealizedPnl._sum.realizedPnl || 0,
  });
}

// POST /api/trades — manual trade entry
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, name, market, side, quantity, price, costPrice, realizedPnl, brokerAccountId, note } = body as {
    symbol: string; name: string; market: string; side: string;
    quantity: number; price: number; costPrice?: number; realizedPnl?: number;
    brokerAccountId?: string; note?: string;
  };

  if (!symbol || !name || !market || !side || !quantity || !price) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const trade = await prisma.trade.create({
    data: {
      symbol, name, market, side, quantity, price,
      costPrice: costPrice ?? price,
      realizedPnl: realizedPnl ?? 0,
      brokerAccountId: brokerAccountId || null,
      manual: true,
      note: note || null,
    },
  });
  return NextResponse.json(trade);
}
