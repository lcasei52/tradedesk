"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface ToolStep {
  tool: string;
  input: Record<string, unknown>;
  result?: string;
  error?: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  toolSteps?: ToolStep[];
}

interface HistoryMessage {
  role: string;
  content: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

function parseSSE(text: string): { event: string; data: unknown }[] {
  const events: { event: string; data: unknown }[] = [];
  let currentEvent = "";
  const lines = text.split("\n");

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) });
      } catch {
        // skip malformed
      }
      currentEvent = "";
    }
  }

  return events;
}

export default function ChatPanel({ onPositionChange }: { onPositionChange?: () => void }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeTools, setActiveTools] = useState<ToolStep[]>([]);
  const [showList, setShowList] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }, []);

  // Load conversation list on mount
  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Auto-create first conversation if none exist
  useEffect(() => {
    if (conversations.length === 0 && !activeId) {
      createConversation();
    } else if (!activeId && conversations.length > 0) {
      switchConversation(conversations[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length]);

  const createConversation = useCallback(async () => {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return;
    const conv = await res.json();
    setActiveId(conv.id);
    setMessages([{
      role: "assistant",
      content: "你好！我是你的 AI 投资助手。可以问我行情、分析持仓，或者直接告诉我你的交易操作。",
    }]);
    setHistory([]);
    await loadConversations();
    setShowList(false);
  }, [loadConversations]);

  const switchConversation = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const conv = await res.json();
    setActiveId(id);
    const saved = (conv.messages as { role: string; content: string }[]) || [];
    setHistory(saved);
    if (saved.length === 0) {
      setMessages([{
        role: "assistant",
        content: "你好！我是你的 AI 投资助手。可以问我行情、分析持仓，或者直接告诉我你的交易操作。",
      }]);
    } else {
      setMessages(saved.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
    }
    setShowList(false);
  }, []);

  const deleteConversation = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
      setHistory([]);
    }
    await loadConversations();
  }, [activeId, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, streamingText, activeTools]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeId) return;
    setInput("");

    const userMsg: Message = { role: "user", content: text };
    const newHistory = [...history, { role: "user", content: text }];
    setMessages((prev) => [...prev, userMsg]);
    setHistory(newHistory);
    setLoading(true);
    setStreamingText("");
    setActiveTools([]);

    let assistantContent = "";
    const toolSteps: ToolStep[] = [];
    let hadPositionUpdate = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory, conversationId: activeId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无响应流");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = parseSSE(buffer);

        const lastEventEnd = buffer.lastIndexOf("\n\n");
        if (lastEventEnd !== -1) {
          buffer = buffer.slice(lastEventEnd + 2);
        }

        for (const { event, data } of events) {
          const d = data as Record<string, unknown>;

          if (event === "content") {
            assistantContent += d.text as string;
            setStreamingText(assistantContent);
          } else if (event === "tool_start") {
            const step: ToolStep = { tool: d.tool as string, input: d.input as Record<string, unknown> };
            toolSteps.push(step);
            setActiveTools([...toolSteps]);
          } else if (event === "tool_end") {
            const last = toolSteps[toolSteps.length - 1];
            if (last) {
              last.result = d.result as string;
              last.error = d.error as boolean;
            }
            setActiveTools([...toolSteps]);
            if ((d.tool as string) === "update_position") hadPositionUpdate = true;
          } else if (event === "error") {
            assistantContent += `\n\n错误：${d.message}`;
            setStreamingText(assistantContent);
          }
        }
      }
    } catch (err) {
      assistantContent = err instanceof Error ? err.message : "网络错误，请重试";
    }

    const finalContent = assistantContent || "无回复";
    const updatedHistory = [...newHistory, { role: "assistant", content: finalContent }];
    setHistory(updatedHistory);
    setStreamingText("");
    setActiveTools([]);
    setLoading(false);

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: finalContent,
        toolSteps: toolSteps.length > 0 ? toolSteps : undefined,
      },
    ]);

    // Refresh conversation list (title may have changed)
    loadConversations();

    if (hadPositionUpdate && onPositionChange) {
      setTimeout(() => onPositionChange(), 300);
    }
  }, [input, loading, history, activeId, onPositionChange, loadConversations]);

  const currentTitle = conversations.find((c) => c.id === activeId)?.title || "新对话";

  const startRename = useCallback(() => {
    setTitleDraft(currentTitle);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [currentTitle]);

  const confirmRename = useCallback(async () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || !activeId || trimmed === currentTitle) return;
    await fetch(`/api/conversations/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    await loadConversations();
  }, [titleDraft, activeId, currentTitle, loadConversations]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={confirmRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRename();
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="flex-1 text-sm font-medium px-1 py-0.5 rounded border border-primary bg-transparent outline-none"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setShowList(!showList)}
            onDoubleClick={startRename}
            className="text-sm font-medium truncate flex-1 text-left hover:text-primary transition-colors"
            title="双击重命名"
          >
            {currentTitle}
          </button>
        )}
        {!editingTitle && (
          <button
            onClick={startRename}
            className="text-xs text-muted hover:text-foreground transition-colors"
            title="重命名"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
          </button>
        )}
        <button
          onClick={createConversation}
          className="text-xs px-2 py-1 rounded-md border border-border hover:bg-border transition-colors"
          title="新对话"
        >
          + 新对话
        </button>
      </div>

      {/* Conversation list dropdown */}
      {showList && (
        <div className="absolute top-10 left-2 right-2 z-10 bg-card-bg border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-3 text-sm text-muted text-center">暂无对话</div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => switchConversation(conv.id)}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-border/50 transition-colors ${
                  conv.id === activeId ? "bg-border/30" : ""
                }`}
              >
                <span className="flex-1 text-sm truncate">{conv.title}</span>
                <button
                  onClick={(e) => deleteConversation(conv.id, e)}
                  className="text-xs text-muted hover:text-loss transition-colors shrink-0"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-primary text-white rounded-br-md"
                  : "bg-card-bg border border-border rounded-bl-md"
              }`}
            >
              {msg.content}
              {msg.toolSteps && msg.toolSteps.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                  {msg.toolSteps.map((step, j) => (
                    <div key={j} className="text-xs text-muted">
                      <span className="font-medium">
                        {step.tool === "get_quote" && "查行情"}
                        {step.tool === "get_portfolio" && "看持仓"}
                        {step.tool === "update_position" && "改持仓"}
                      </span>
                      {step.result && (
                        <span className={step.error ? "text-loss" : "text-profit"}> — {step.error ? "失败" : "完成"}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming content */}
        {(loading || streamingText || activeTools.length > 0) && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-card-bg border border-border text-sm whitespace-pre-wrap">
              {streamingText || "思考中..."}
              {activeTools.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                  {activeTools.map((step, j) => (
                    <div key={j} className="text-xs text-muted flex items-center gap-1">
                      {!step.result && (
                        <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      )}
                      <span className="font-medium">
                        {step.tool === "get_quote" && "查询行情..."}
                        {step.tool === "get_portfolio" && "获取持仓..."}
                        {step.tool === "update_position" && "更新持仓..."}
                      </span>
                      {step.result && (
                        <span className={step.error ? "text-loss" : "text-profit"}>
                          {step.error ? "失败" : "完成"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="输入消息..."
            className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-card-bg text-sm outline-none focus:border-primary transition-colors"
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
