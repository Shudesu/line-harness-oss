🌐 [日本語](README.md) | **English** | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# L Harness

> ### **[Try free on LINE](https://shudesu.github.io/line-harness-oss/)** 👈

A fully open-source CRM for LINE Official Accounts. **Free alternative to proprietary LINE CRM SaaS** (priced at ¥10,000–20,000+/month).
Runs on Cloudflare's free tier. **$0/month server cost.** Fully operable from Claude Code.

### ▶️ [Watch the walkthrough on YouTube (~20 min)](https://youtu.be/DiRuGaeq1sM)

[![Click to play on YouTube — L Harness setup guide](https://img.youtube.com/vi/DiRuGaeq1sM/maxresdefault.jpg)](https://youtu.be/DiRuGaeq1sM)

**Current version**: v0.13.2 ・ MIT License ・ TypeScript / Cloudflare Workers + D1

---

## Why L Harness?

| | Proprietary SaaS A | Proprietary SaaS B | **L Harness** |
|---|---|---|---|
| Monthly cost | ¥20,000+ | ¥10,000+ | **$0** |
| Step messaging | ✅ | ✅ | ✅ |
| Segment broadcasts | ✅ | ✅ | ✅ |
| Rich menu switching | ✅ | ✅ | ✅ |
| Forms (LIFF) | ✅ | ✅ | ✅ |
| Lead scoring | ✅ | ❌ | ✅ |
| IF-THEN automation | partial | partial | ✅ |
| Public API | ❌ | ❌ | **all features** |
| Claude Code (AI) integration | ❌ | ❌ | **MCP server included** |
| BAN detection & account migration | ❌ | ❌ | **✅** |
| Multi-account | extra contract | extra contract | **built-in** |
| Friend deduplication | ❌ | ❌ | **✅** (cross-account, picture token matching) |
| Source code | closed | closed | **MIT (this repo)** |

---

## Quick Start

### One-command setup

```bash
npx create-line-harness
```

The CLI handles everything:
- Cloudflare account auth (`wrangler login`)
- D1 database creation + schema/migrations
- Worker / dashboard deployment
- LINE Official Account credentials registration
- LIFF app auto-creation
- Initial Owner user for the dashboard

Takes about 5 minutes. Once done, the dashboard at `https://<your-name>-admin.pages.dev` is live and ready.

### Requirements

- Cloudflare account (free tier is fine)
- LINE Official Account + Messaging API channel
- Node.js 22+ / pnpm

---

## Features

### Messaging
- **Step scenarios** — minute-level `delay_minutes`, conditional branching, stealth delivery
- **Broadcasts** — to all / by tag / by segment, immediate or scheduled, auto-queued for 500+ recipients
- **Reminders** — countdown delivery from a target date (3 days before / 1 day before / day-of)
- **Templates** — personalize with `{{name}}` `{{uid}}` `{{auth_url:CHANNEL_ID}}`
- **Tracked links** — click counting → automatic tagging → scenario triggering

### CRM
- **Friend management** — webhook auto-registration, profile fetching, custom metadata
- **Tags** — segmentation conditions and scenario triggers
- **Lead scoring** — automatic score calculation from behavior
- **Operator chat** — direct 1:1 reply from the dashboard
- **Conversation inbox** — list unanswered conversations sorted by idle time (automated sends excluded)
- **Friend deduplication** — auto-tag the same physical user across multiple accounts via `picture_url` token matching

### Marketing
- **Rich menus** — per-user / per-tag automatic switching
- **Forms (LIFF)** — fully in-LINE forms, answers auto-saved as metadata
- **Calendar booking** — Google Calendar integrated booking via LIFF
- **Staff management** — Owner / Admin / Staff roles, individual API keys

### Affiliate Tracking (ASP)
- **Self-serve link issuance** — affiliates generate their own tracked LIFF links without admin intervention
- **Campaign management** — set a fixed reward per campaign, run multiple campaigns in parallel
- **Timeline tracking** — records click → friend-add → conversion in sequence, attribution via last-touch
- **Approval workflow** — approve/reject attributed conversions to finalize rewards, with duplicate-account flags to surface potential fraud
- **LINE push notifications** — automatic push to the affiliate when a conversion is confirmed
- Details: [docs/wiki/27-Affiliate-ASP.md](docs/wiki/27-Affiliate-ASP.md)

### Automation
- **IF-THEN rules** — 7 trigger types × 6 action types
- **Auto-replies** — exact / partial keyword matching
- **Webhook in/out** — integration with Stripe, Slack, etc.
- **Notification rules** — conditional alerts
- **Delivery timing** — fully controlled by `delay_minutes` and `scheduled_at` (v0.13.2 removed all system-side time gates; you control timing operationally)

### Multi-account
- Manage **multiple LINE Official Accounts** from a single dashboard
- **Per-account scope** for scenarios, tags, broadcasts
- **BAN detection** → automatic friend migration to the next account in the pool
- **Traffic pools** — automatic distribution across multiple accounts

### AI integration
- **MCP server included** (`@line-harness/mcp-server`) — natural-language operation from Claude Code
  - `list_conversations` / `get_conversation` — AI-monitored unanswered conversations
  - `create_scenario` / `update_step` — let AI design scenarios
  - `broadcast` / `send_message` — sending requires user confirmation
- **Official SDK** (`@line-harness/sdk`) — typed TypeScript SDK, ESM + CJS, zero dependencies

### iOS app support
- **`GET /api/capabilities`** — capability/version negotiation endpoint for the iOS app (the-harness-ios)
- Available to Owner / Admin / Staff roles

---

## Architecture

```
[ LINE Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ]
                              ⇅
                    [ Cloudflare Pages (Next.js 15) ]
                              ⇅
                    [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + LIFF + webhook receiver, cron-driven delivery
- **Web** (`apps/web`): Next.js 15 dashboard (19 sections)
- **Packages**:
  - `@line-harness/sdk` — TypeScript SDK
  - `@line-harness/mcp-server` — MCP server for Claude Code
  - `create-line-harness` — setup CLI
  - `@line-harness/plugin-template` — plugin extension template
  - `@line-harness/db` — D1 migrations + helpers
  - `@line-harness/line-sdk` — thin LINE API wrapper
  - `@line-harness/shared` — shared type definitions

---

## Resources

- [Setup walkthrough (video)](https://youtu.be/DiRuGaeq1sM)
- [Live demo on LINE](https://shudesu.github.io/line-harness-oss/)
- [npm: @line-harness/sdk](https://www.npmjs.com/package/@line-harness/sdk)
- [npm: @line-harness/mcp-server](https://www.npmjs.com/package/@line-harness/mcp-server)
- [npm: create-line-harness](https://www.npmjs.com/package/create-line-harness)

---

## License

MIT License. Free for commercial use, modification, and redistribution.

---

## Contributing

Issues and PRs welcome. Please open them against `Shudesu/line-harness-oss` (this repo).

---

> **L Harness** by [@Shudesu](https://github.com/Shudesu) — an AI-native open-source LINE CRM
