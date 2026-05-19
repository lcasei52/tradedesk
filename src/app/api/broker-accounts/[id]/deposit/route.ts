import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { amount } = (await req.json()) as { amount: number };

  if (typeof amount !== "number" || amount === 0) {
    return NextResponse.json({ error: "金额不能为0" }, { status: 400 });
  }

  const account = await prisma.brokerAccount.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: "账户不存在" }, { status: 404 });

  const updated = await prisma.brokerAccount.update({
    where: { id },
    data: { cashBalance: { increment: amount } },
  });

  return NextResponse.json({ cashBalance: updated.cashBalance });
}
