@AGENTS.md

# TradeDesk 开发规则

## 数据一致性

所有对持仓、余额、账号等数据的写操作，必须同时覆盖 UI 手动路径（`src/app/api/`）和 LLM agent 工具路径（`src/lib/agent/tools.ts`），保证两边结果一致。新增写操作时，检查两条路径是否都已实现，不能出现一方修改后另一方不同步。

## 功能同步

新增功能时，如果该操作适合通过对话触发，必须一并实现对应的 LLM 工具（在 `src/lib/agent/tools.ts` 中添加 tool 定义和执行逻辑），并在 `src/lib/agent/prompt.ts` 中补充工具说明。

## 默认部署

修改完成后默认部署到生产服务器，不需要等用户说"部署"。只有用户明确说"先在本地"或"先不部署"时才跳过部署。部署方法见 `/deploy` skill。

## Prisma Schema 变更

Schema 变更后，本地执行 `npx prisma db push` 和 `npx prisma generate`。数据库是 Neon PostgreSQL，直接推送生效，不需要 migration 文件。
