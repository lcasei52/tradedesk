import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await _req.json();
  const { name, cashBalance } = body as { name?: string; cashBalance?: number };

  const data: Record<string, unknown> = {};
  if (name) data.name = name;
  if (cashBalance !== undefined) data.cashBalance = cashBalance;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "没有修改" }, { status: 400 });

  const account = await prisma.brokerAccount.update({ where: { id }, data });
  return NextResponse.json({
    id: account.id, name: account.name, currency: account.currency, cashBalance: account.cashBalance,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Unlink positions
  await prisma.position.updateMany({ where: { brokerAccountId: id }, data: { brokerAccountId: null } });
  await prisma.brokerAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
