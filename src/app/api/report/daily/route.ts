import { NextRequest, NextResponse } from "next/server";
import { sendTelegramNotification } from "@/lib/telegram";
import { getTelegramConfig } from "@/lib/config";
import { generateDailyReport, saveDailySnapshot } from "@/lib/report";

// POST /api/report/daily — generate and send daily report
export async function POST(req: NextRequest) {
  const config = await getTelegramConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Telegram not configured (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)" },
      { status: 400 }
    );
  }

  try {
    const report = await generateDailyReport(true);
    const ok = await sendTelegramNotification(config, report);

    if (!ok) {
      return NextResponse.json({ error: "Failed to send Telegram message" }, { status: 500 });
    }

    await saveDailySnapshot();

    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET /api/report/daily — preview report without sending
export async function GET() {
  try {
    const report = await generateDailyReport(true);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
