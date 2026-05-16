"use client";

import PortfolioPanel from "@/components/PortfolioPanel";
import ChatPanel from "@/components/ChatPanel";
import { useRef } from "react";
import Link from "next/link";

export default function Home() {
  const portfolioRef = useRef<{ reload: () => void }>(null);

  return (
    <div className="h-full flex flex-col">
      <header className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">TradeDesk</h1>
        <div className="flex items-center gap-3">
          <Link href="/settings" className="text-xs text-muted hover:text-foreground transition-colors">
            设置
          </Link>
          <span className="text-xs text-muted">v0.1.0</span>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-[380px] border-r border-border flex flex-col bg-sidebar-bg shrink-0">
          <PortfolioPanel ref={portfolioRef} />
        </aside>
        <main className="flex-1 flex flex-col min-w-0">
          <ChatPanel onPositionChange={() => portfolioRef.current?.reload()} />
        </main>
      </div>
    </div>
  );
}
