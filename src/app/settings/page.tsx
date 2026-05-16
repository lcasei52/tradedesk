"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Settings {
  llm: { baseUrl: string; apiKey: string; model: string; hasApiKey: boolean };
  telegram: { botToken: string; chatId: string; hasBotToken: boolean };
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings);
  }, []);

  if (!settings) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted">加载中...</div>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const body: Record<string, Record<string, string>> = {};

      body.llm = {
        baseUrl: settings.llm.baseUrl,
        apiKey: settings.llm.apiKey,
        model: settings.llm.model,
      };

      body.telegram = {
        botToken: settings.telegram.botToken,
        chatId: settings.telegram.chatId,
      };

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("保存失败");

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    try {
      const res = await fetch("/api/report/daily", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        alert("推送成功！请检查 Telegram");
      } else {
        alert("推送失败：" + (data.error || "未知错误"));
      }
    } catch {
      alert("请求失败");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-semibold">设置</h1>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            ← 返回
          </button>
        </div>

        {/* LLM Settings */}
        <section className="mb-8">
          <h2 className="text-base font-medium mb-4 pb-2 border-b border-border">LLM 配置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted mb-1">API 地址</label>
              <input
                type="text"
                value={settings.llm.baseUrl}
                onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, baseUrl: e.target.value } })}
                placeholder="https://open.bigmodel.cn/api/anthropic"
                className="w-full px-3 py-2 rounded-lg border border-border bg-card-bg text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">
                API Key {settings.llm.hasApiKey && <span className="text-profit">（已配置）</span>}
              </label>
              <input
                type="password"
                value={settings.llm.apiKey}
                onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, apiKey: e.target.value } })}
                placeholder={settings.llm.hasApiKey ? "留空保持当前配置" : "输入 API Key"}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card-bg text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">模型</label>
              <input
                type="text"
                value={settings.llm.model}
                onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, model: e.target.value } })}
                placeholder="glm-5.1"
                className="w-full px-3 py-2 rounded-lg border border-border bg-card-bg text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
        </section>

        {/* Telegram Settings */}
        <section className="mb-8">
          <h2 className="text-base font-medium mb-4 pb-2 border-b border-border">Telegram 推送</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted mb-1">
                Bot Token {settings.telegram.hasBotToken && <span className="text-profit">（已配置）</span>}
              </label>
              <input
                type="password"
                value={settings.telegram.botToken}
                onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, botToken: e.target.value } })}
                placeholder={settings.telegram.hasBotToken ? "留空保持当前配置" : "输入 Bot Token"}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card-bg text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Chat ID</label>
              <input
                type="text"
                value={settings.telegram.chatId}
                onChange={(e) => setSettings({ ...settings, telegram: { ...settings.telegram, chatId: e.target.value } })}
                placeholder="输入 Chat ID"
                className="w-full px-3 py-2 rounded-lg border border-border bg-card-bg text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={handleTestTelegram}
              disabled={!settings.telegram.hasBotToken && !settings.telegram.botToken}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-border transition-colors disabled:opacity-40"
            >
              测试推送
            </button>
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center gap-4 pt-4 border-t border-border">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            {saving ? "保存中..." : "保存设置"}
          </button>
          {saved && <span className="text-sm text-profit">已保存</span>}
          {error && <span className="text-sm text-loss">{error}</span>}
        </div>
      </div>
    </div>
  );
}
