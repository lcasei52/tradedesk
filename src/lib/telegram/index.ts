const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

async function sendMessage(config: TelegramConfig, text: string): Promise<boolean> {
  // Telegram message limit is 4096 chars, split if needed
  const chunks = splitMessage(text, 4000);

  for (const chunk of chunks) {
    try {
      const res = await fetch(
        `${TELEGRAM_API}/bot${config.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: config.chatId,
            text: chunk,
            parse_mode: "Markdown",
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!res.ok) {
        const err = await res.text();
        console.error("Telegram send error:", err);
        return false;
      }
    } catch (err) {
      console.error("Telegram send failed:", err);
      return false;
    }
  }

  return true;
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export async function sendTelegramNotification(
  config: TelegramConfig,
  text: string
): Promise<boolean> {
  return sendMessage(config, text);
}
