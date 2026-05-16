import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BinanceAdapter } from "@/lib/exchange/binance";

// GET /api/exchange-accounts
export async function GET() {
  const accounts = await prisma.exchangeAccount.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    accounts.map((a) => ({
      id: a.id,
      name: a.name,
      exchange: a.exchange,
      apiKey: a.apiKey.slice(0, 4) + "****" + a.apiKey.slice(-4),
      apiSecret: "****",
      isDemo: a.isDemo,
      createdAt: a.createdAt,
    }))
  );
}

// POST /api/exchange-accounts — add new exchange account
export async function POST(req: NextRequest) {
  const { name, exchange, apiKey, apiSecret, isDemo } = await req.json();

  if (!name || !exchange || !apiKey || !apiSecret) {
    return NextResponse.json({ error: "name, exchange, apiKey, apiSecret required" }, { status: 400 });
  }

  // Test connection before saving
  if (exchange === "binance") {
    const adapter = new BinanceAdapter({ apiKey, apiSecret });
    const ok = await adapter.testConnection();
    if (!ok) {
      return NextResponse.json({ error: "连接失败，请检查 API Key 和 Secret" }, { status: 400 });
    }
  }

  const account = await prisma.exchangeAccount.create({
    data: { name, exchange, apiKey, apiSecret, isDemo: isDemo || false },
  });

  return NextResponse.json({
    id: account.id,
    name: account.name,
    exchange: account.exchange,
    ok: true,
  });
}
