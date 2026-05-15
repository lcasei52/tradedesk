import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/positions
export async function GET() {
  const positions = await prisma.position.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(positions);
}

// POST /api/positions — add or update
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, name, market, quantity, costPrice } = body;

  if (!symbol || !name || !market || quantity == null || costPrice == null) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const existing = await prisma.position.findUnique({ where: { symbol } });

  if (existing) {
    // Weighted average cost
    const totalQty = existing.quantity + quantity;
    const avgCost = (existing.costPrice * existing.quantity + costPrice * quantity) / totalQty;
    const updated = await prisma.position.update({
      where: { symbol },
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

  await prisma.position.delete({ where: { symbol } });
  return NextResponse.json({ ok: true });
}

// PUT /api/positions — update quantity (sell) or edit
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { symbol, quantity, costPrice, name, market } = body;

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  if (quantity !== undefined && quantity <= 0) {
    await prisma.position.delete({ where: { symbol } });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const data: Record<string, unknown> = {};
  if (quantity !== undefined) data.quantity = quantity;
  if (costPrice !== undefined) data.costPrice = costPrice;
  if (name) data.name = name;
  if (market) data.market = market;

  const updated = await prisma.position.update({ where: { symbol }, data });
  return NextResponse.json(updated);
}
