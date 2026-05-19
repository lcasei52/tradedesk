import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/snapshots?days=30
export async function GET(req: NextRequest) {
  const days = parseInt(req.nextUrl.searchParams.get("days") || "30");
  const since = new Date();
  since.setDate(since.getDate() - days);

  const snapshots = await prisma.dailySnapshot.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      totalAssets: true,
      totalCost: true,
    },
  });

  // Calculate daily change
  const data = snapshots.map((s, i) => ({
    date: s.date,
    totalAssets: s.totalAssets,
    totalCost: s.totalCost,
    dailyChange: i > 0 ? s.totalAssets - snapshots[i - 1].totalAssets : 0,
    dailyChangePct:
      i > 0 && snapshots[i - 1].totalAssets > 0
        ? ((s.totalAssets - snapshots[i - 1].totalAssets) / snapshots[i - 1].totalAssets) * 100
        : 0,
    returnPct:
      s.totalCost > 0 ? ((s.totalAssets - s.totalCost) / s.totalCost) * 100 : 0,
  }));

  return NextResponse.json(data);
}

// POST /api/snapshots — auto-save today's snapshot if not exists
export async function POST() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const existing = await prisma.dailySnapshot.findUnique({ where: { date: dateStr } });
  if (existing) {
    return NextResponse.json({ ok: true, created: false });
  }

  // Dynamically import to avoid circular deps
  const { saveDailySnapshot } = await import("@/lib/report");
  await saveDailySnapshot();

  return NextResponse.json({ ok: true, created: true });
}
