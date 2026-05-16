import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEFAULT_SETTINGS = {
  llm: { baseUrl: "", apiKey: "", model: "glm-5.1" },
  telegram: { botToken: "", chatId: "" },
};

// GET /api/settings
export async function GET() {
  const row = await prisma.settings.findUnique({ where: { id: "default" } });
  const value = (row?.value as Record<string, unknown>) || DEFAULT_SETTINGS;

  return NextResponse.json({
    llm: {
      baseUrl: (value.llm as Record<string, string>)?.baseUrl || process.env.LLM_BASE_URL || "",
      // Never expose full API key to client — return masked version
      apiKey: maskKey((value.llm as Record<string, string>)?.apiKey || process.env.LLM_API_KEY || ""),
      model: (value.llm as Record<string, string>)?.model || process.env.LLM_MODEL || "glm-5.1",
      hasApiKey: !!((value.llm as Record<string, string>)?.apiKey || process.env.LLM_API_KEY),
    },
    telegram: {
      botToken: maskKey((value.telegram as Record<string, string>)?.botToken || process.env.TELEGRAM_BOT_TOKEN || ""),
      chatId: (value.telegram as Record<string, string>)?.chatId || process.env.TELEGRAM_CHAT_ID || "",
      hasBotToken: !!((value.telegram as Record<string, string>)?.botToken || process.env.TELEGRAM_BOT_TOKEN),
    },
  });
}

// PATCH /api/settings — update settings
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const row = await prisma.settings.findUnique({ where: { id: "default" } });
  const current = (row?.value as Record<string, Record<string, string>>) || DEFAULT_SETTINGS;

  // Merge: only update provided fields, keep existing if empty (means "keep current")
  const updated = { ...current };

  if (body.llm) {
    updated.llm = {
      baseUrl: body.llm.baseUrl || (current.llm as Record<string, string>)?.baseUrl || "",
      apiKey: body.llm.apiKey || (current.llm as Record<string, string>)?.apiKey || "",
      model: body.llm.model || (current.llm as Record<string, string>)?.model || "glm-5.1",
    };
  }

  if (body.telegram) {
    updated.telegram = {
      botToken: body.telegram.botToken || (current.telegram as Record<string, string>)?.botToken || "",
      chatId: body.telegram.chatId || (current.telegram as Record<string, string>)?.chatId || "",
    };
  }

  await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", value: updated },
    update: { value: updated },
  });

  return NextResponse.json({ ok: true });
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? "****" : "";
  return key.slice(0, 4) + "****" + key.slice(-4);
}
