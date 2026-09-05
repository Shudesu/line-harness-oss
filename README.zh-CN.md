🌐 [日本語](README.md) | [English](README.en.md) | **简体中文** | [한국어](README.ko.md) | [Español](README.es.md)

# L Harness

> ### **[在 LINE 上免费体验](https://shudesu.github.io/line-harness-oss/)** 👈

完全开源的 LINE 官方账号 CRM。**专有 LINE CRM SaaS（月费 1-2 万日元）的免费替代方案**。
基于 Cloudflare 免费套餐运行。**服务器费用 0 元**。可通过 Claude Code 完整操作。

### ▶️ [在 YouTube 观看视频教程（约 20 分钟）](https://youtu.be/DiRuGaeq1sM)

[![点击在 YouTube 播放 — L Harness 配置教程](https://img.youtube.com/vi/DiRuGaeq1sM/maxresdefault.jpg)](https://youtu.be/DiRuGaeq1sM)

**当前版本**: v0.13.2 ・ MIT 许可证 ・ TypeScript / Cloudflare Workers + D1

---

## 为什么选择 L Harness？

| | 闭源 SaaS A | 闭源 SaaS B | **L Harness** |
|---|---|---|---|
| 月费 | ¥20,000+ | ¥10,000+ | **0 日元** |
| 步骤群发 | ✅ | ✅ | ✅ |
| 分群推送 | ✅ | ✅ | ✅ |
| 富菜单切换 | ✅ | ✅ | ✅ |
| 表单 (LIFF) | ✅ | ✅ | ✅ |
| 线索评分 | ✅ | ❌ | ✅ |
| IF-THEN 自动化 | 部分支持 | 部分支持 | ✅ |
| 公开 API | ❌ | ❌ | **全部功能** |
| Claude Code (AI) 集成 | ❌ | ❌ | **内置 MCP server** |
| 封号检测与账号自动迁移 | ❌ | ❌ | **✅** |
| 多账号管理 | 需另购 | 需另购 | **标配** |
| 好友去重 | ❌ | ❌ | **✅**（基于 picture_url token 跨账号匹配）|
| 源代码 | 闭源 | 闭源 | **MIT（本仓库）** |

---

## 快速开始

### 一条命令完成全部配置

```bash
npx create-line-harness
```

CLI 自动完成以下全部步骤：
- Cloudflare 账号认证 (`wrangler login`)
- D1 数据库创建 + schema 与 migration 应用
- Worker / 管理后台部署
- LINE 官方账号 credentials 注册
- LIFF 应用自动创建
- 管理后台首次登录用 Owner 用户创建

约 5 分钟完成。完成后即可在 `https://<your-name>-admin.pages.dev` 后台开始运营。

### 前置要求

- Cloudflare 账号（免费套餐即可）
- LINE 官方账号 + Messaging API channel
- Node.js 22+ / pnpm

---

## 主要功能

### 消息推送
- **步骤群发** — 分钟级 `delay_minutes` 控制，条件分支，隐身发送
- **群发广播** — 全部 / 标签 / 分群，即时或定时，500+ 自动队列化
- **提醒** — 从指定日期倒计时推送（活动前 3 天 / 前 1 天 / 当天）
- **模板** — `{{name}}` `{{uid}}` `{{auth_url:CHANNEL_ID}}` 个性化
- **追踪链接** — 点击统计 → 自动打标 → 触发场景

### CRM
- **好友管理** — Webhook 自动注册、profile 获取、自定义 metadata
- **标签** — 推送条件与场景触发
- **线索评分** — 基于行为的自动评分
- **客服聊天** — 后台直接 1 对 1 回复
- **会话收件箱** — 按未回复时间长度排序未答会话（自动推送不计入）
- **好友去重** — 基于 `picture_url` 中段 token 跨多账号识别同一用户并自动打标

### 营销
- **富菜单** — 按用户 / 标签自动切换
- **表单 (LIFF)** — LINE 内部完成，答案自动存为 metadata
- **日程预约** — 基于 Google Calendar 的 LIFF 预约系统
- **员工管理** — Owner / Admin / Staff 三级角色，独立 API key

### 联盟营销追踪（ASP）
- **自助链接发放** — 联盟伙伴无需管理员介入即可自行生成 LIFF 追踪链接
- **活动管理** — 按活动设置固定奖励金额，多活动并行运营
- **时序追踪** — 依次记录点击 → 添加好友 → 转化，以 last-touch 归因关联成果
- **审核流程** — 审批/驳回归因转化以确认奖励，并通过重复账号标记提示可疑成果
- **LINE 推送通知** — 转化确认时自动向联盟伙伴发送 push 通知
- 详情: [docs/wiki/27-Affiliate-ASP.md](docs/wiki/27-Affiliate-ASP.md)

### 自动化
- **IF-THEN 规则** — 7 种触发器 × 6 种动作
- **自动回复** — 关键词完全匹配 / 部分匹配
- **Webhook IN/OUT** — Stripe、Slack 等外部服务集成
- **通知规则** — 条件化告警
- **推送时机** — 由 `delay_minutes` 和 `scheduled_at` 完全控制（v0.13.2 已撤除系统侧时间门，由运营方主导）

### 多账号
- 单一后台管理**多个 LINE 官方账号**
- 场景、标签、推送均**按账号隔离**
- **封号检测** → 自动将好友迁移至 pool 中下一个账号
- **流量池** — 跨多账号自动分发

### AI 集成
- **内置 MCP Server** (`@line-harness/mcp-server`) — Claude Code 自然语言完整操作
  - `list_conversations` / `get_conversation` — AI 监控未答会话
  - `create_scenario` / `update_step` — 让 AI 设计场景
  - `broadcast` / `send_message` — 发送类操作需要用户确认
- **官方 SDK** (`@line-harness/sdk`) — TypeScript 强类型 SDK，ESM + CJS，零依赖

### iOS 应用支持
- **`GET /api/capabilities`** — iOS 应用 (the-harness-ios) 的能力/版本协商 endpoint
- Owner / Admin / Staff 角色均可使用

---

## 架构

```
[ LINE Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ]
                              ⇅
                    [ Cloudflare Pages (Next.js 15) ]
                              ⇅
                    [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + LIFF + Webhook 接收器，cron 驱动的推送处理
- **Web** (`apps/web`): Next.js 15 后台（19 个功能模块）
- **Packages**:
  - `@line-harness/sdk` — TypeScript SDK
  - `@line-harness/mcp-server` — Claude Code 用 MCP server
  - `create-line-harness` — 配置 CLI
  - `@line-harness/plugin-template` — 插件扩展模板
  - `@line-harness/db` — D1 migration 与辅助函数
  - `@line-harness/line-sdk` — LINE API 薄封装
  - `@line-harness/shared` — 共享类型定义

---

## 资源

- [配置教程视频](https://youtu.be/DiRuGaeq1sM)
- [在 LINE 上免费体验](https://shudesu.github.io/line-harness-oss/)
- [npm: @line-harness/sdk](https://www.npmjs.com/package/@line-harness/sdk)
- [npm: @line-harness/mcp-server](https://www.npmjs.com/package/@line-harness/mcp-server)
- [npm: create-line-harness](https://www.npmjs.com/package/create-line-harness)

---

## 许可证

MIT License. 商用、修改、再分发自由。

---

## 贡献

欢迎 Issue 和 PR。请向 `Shudesu/line-harness-oss`（本仓库）提交。

---

> **L Harness** by [@Shudesu](https://github.com/Shudesu) — AI 原生时代的开源 LINE CRM
