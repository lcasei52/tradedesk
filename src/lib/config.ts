import { prisma } from "@/lib/db";

interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export async function getLLMConfig(): Promise<LLMConfig> {
  const row = await prisma.settings.findUnique({ where: { id: "default" } });
  const value = (row?.value as Record<string, Record<string, string>>) || {};

  return {
    apiKey: value.llm?.apiKey || process.env.LLM_API_KEY || "",
    baseURL: value.llm?.baseUrl || process.env.LLM_BASE_URL || "https://open.bigmodel.cn/api/anthropic",
    model: value.llm?.model || process.env.LLM_MODEL || "glm-5.1",
  };
}

export async function getTelegramConfig(): Promise<TelegramConfig | null> {
  const row = await prisma.settings.findUnique({ where: { id: "default" } });
  const value = (row?.value as Record<string, Record<string, string>>) || {};

  const botToken = value.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = value.telegram?.chatId || process.env.TELEGRAM_CHAT_ID || "";

  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}
