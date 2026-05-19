import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { toolDefinitions, executeTool } from "@/lib/agent/tools";
import { prisma } from "@/lib/db";
import { getLLMConfig } from "@/lib/config";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { messages: history, conversationId } = await req.json();

  if (!history || !Array.isArray(history)) {
    return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { apiKey, baseURL, model } = await getLLMConfig();
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "LLM_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new Anthropic({ apiKey, baseURL });

  const apiMessages: Anthropic.MessageParam[] = history.map(
    (m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })
  );

  const toolCtx = {
    conversationId: conversationId as string | undefined,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Agent loop: keep calling LLM until it stops requesting tools
        let loopCount = 0;
        const MAX_LOOPS = 10;
        let allText = ""; // Collect all text for saving

        while (loopCount < MAX_LOOPS) {
          loopCount++;

          const response = await client.messages.create({
            model,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools: toolDefinitions as Anthropic.Tool[],
            messages: apiMessages,
          });

          // Process response blocks
          const textParts: string[] = [];
          const toolCalls: Anthropic.ToolUseBlock[] = [];

          for (const block of response.content) {
            if (block.type === "text") {
              textParts.push(block.text);
            } else if (block.type === "tool_use") {
              toolCalls.push(block);
            }
          }

          // Stream any text content to client
          const textContent = textParts.join("");
          if (textContent) {
            allText += textContent;
            send("content", { text: textContent });
          }

          // No tool calls — we're done
          if (toolCalls.length === 0) {
            break;
          }

          // Add assistant response to conversation
          apiMessages.push({ role: "assistant", content: response.content });

          // Execute each tool call and add results
          for (const toolCall of toolCalls) {
            send("tool_start", {
              tool: toolCall.name,
              input: toolCall.input,
            });

            const result = await executeTool(toolCall.name, toolCall.input as Record<string, unknown>, toolCtx);

            send("tool_end", {
              tool: toolCall.name,
              result: result.content,
              error: result.error,
            });

            apiMessages.push({
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolCall.id,
                  content: result.content,
                },
              ],
            });
          }
        }

        send("done", {});

        // Save messages to conversation
        if (conversationId && allText) {
          try {
            const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
            if (conv) {
              const savedMessages = (conv.messages as { role: string; content: string }[]) || [];
              savedMessages.push({ role: "user", content: history[history.length - 1]?.content || "" });
              savedMessages.push({ role: "assistant", content: allText });
              // Auto-title on first exchange
              const title = savedMessages.length <= 2
                ? (history[history.length - 1]?.content || "新对话").slice(0, 30)
                : undefined;
              await prisma.conversation.update({
                where: { id: conversationId },
                data: {
                  messages: savedMessages,
                  ...(title ? { title } : {}),
                },
              });
            }
          } catch {
            // Don't fail the response if saving fails
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
