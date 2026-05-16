import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/positions
export async function GET() {
  const positions = await prisma.position.findMany({
    orderBy: { createdAt: "desc" },
    include: { exchangeAccount: { select: { name: true, exchange: true } } },
  });
  return NextResponse.json(positions);
}

// POST /api/positions — add or update (manual positions, direction=null)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, name, market, quantity, costPrice } = body;

  if (!symbol || !name || !market || quantity == null || costPrice == null) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const existing = await prisma.position.findFirst({
    where: { symbol, direction: null },
  });

  if (existing) {
    const totalQty = existing.quantity + quantity;
    const avgCost = (existing.costPrice * existing.quantity + costPrice * quantity) / totalQty;
    const updated = await prisma.position.update({
      where: { id: existing.id },
      data: { quantity: totalQty, costPrice: Math.round(avgCost * 10000) / 10000, name, market },
    });
    return NextResponse.json(updated);
  }

  const position = await prisma.position.create({
    data: { symbol, name, market, quantity, costPrice },
  });
  return NextResponse.json(position);
}

// DELETE /api/positions?symbol=xxx
export async function DELETE(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  // Find by symbol (could have direction or not)
  const pos = await prisma.position.findFirst({ where: { symbol } });
  if (!pos) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.position.delete({ where: { id: pos.id } });
  return NextResponse.json({ ok: true });
}

// PUT /api/positions — update quantity (sell) or edit
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { symbol, quantity, costPrice, name, market } = body;

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const pos = await prisma.position.findFirst({ where: { symbol } });
  if (!pos) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (quantity !== undefined && quantity <= 0) {
    await prisma.position.delete({ where: { id: pos.id } });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const data: Record<string, unknown> = {};
  if (quantity !== undefined) data.quantity = quantity;
  if (costPrice !== undefined) data.costPrice = costPrice;
  if (name) data.name = name;
  if (market) data.market = market;

  const updated = await prisma.position.update({ where: { id: pos.id }, data });
  return NextResponse.json(updated);
}
