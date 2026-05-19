import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

// Auto-migrate: create default broker account from legacy Settings.cashBalance
async function ensureDefaultAccount() {
  const count = await prisma.brokerAccount.count();
  if (count > 0) return;

  // Read legacy cash balance
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const value = settings?.value as Record<string, unknown> | null;
  const cashBalance = (value?.cashBalance as number) || 0;

  const account = await prisma.brokerAccount.create({
    data: { name: "默认证券账户", currency: "CNY", cashBalance },
  });

  // Assign existing stock/fund positions to this account
  await prisma.position.updateMany({
    where: {
      market: { in: ["a_share", "hk_stock", "us_stock", "fund"] },
      exchangeAccountId: null,
      brokerAccountId: null,
    },
    data: { brokerAccountId: account.id },
  });
}

export async function GET() {
  await ensureDefaultAccount();
  const accounts = await prisma.brokerAccount.findMany({
    include: {
      _count: { select: { positions: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(
    accounts.map((a) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      cashBalance: a.cashBalance,
      positionCount: a._count.positions,
      createdAt: a.createdAt,
    }))
  );
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, currency = "CNY", initialBalance = 0 } = body as {
    name?: string; currency?: string; initialBalance?: number;
  };
  if (!name) return NextResponse.json({ error: "缺少账户名称" }, { status: 400 });

  const account = await prisma.brokerAccount.create({
    data: { name, currency, cashBalance: initialBalance },
  });
  return NextResponse.json({
    id: account.id,
    name: account.name,
    currency: account.currency,
    cashBalance: account.cashBalance,
  });
}
