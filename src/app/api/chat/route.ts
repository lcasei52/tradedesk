import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { message } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  // Placeholder — will be replaced with LLM + tool calling
  return NextResponse.json({
    content: `[Echo] ${message}\n\nAI Agent 尚未接入，这是占位回复。`,
  });
}
