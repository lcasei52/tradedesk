import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/market";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const market = req.nextUrl.searchParams.get("market") || undefined;

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  const quote = await getQuote(symbol, market);

  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  return NextResponse.json(quote);
}
