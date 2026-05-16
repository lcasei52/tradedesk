import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/conversations — list all conversations (id, title, updatedAt)
export async function GET() {
  const conversations = await prisma.conversation.findMany({
    select: { id: true, title: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(conversations);
}

// POST /api/conversations — create a new conversation
export async function POST(req: NextRequest) {
  const { title } = await req.json();
  const conversation = await prisma.conversation.create({
    data: { title: title || "新对话", messages: [] },
  });
  return NextResponse.json(conversation);
}
