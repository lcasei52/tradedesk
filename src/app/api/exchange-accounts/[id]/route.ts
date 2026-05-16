import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// DELETE /api/exchange-accounts/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Delete synced positions first
  await prisma.position.deleteMany({ where: { exchangeAccountId: id } });
  await prisma.exchangeAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
