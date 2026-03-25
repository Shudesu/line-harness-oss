# LINE OSS CRM - L社/U社 Alternative

## Overview
Open-source LINE Official Account CRM/marketing automation tool.
Clone → configure → deploy for free (or near-free at scale).

## Tech Stack
- **Frontend**: Next.js 15 (App Router) on Vercel
- **API/Webhook**: Cloudflare Workers (Hono framework)
- **Database**: Cloudflare D1 (SQLite)
- **Queue**: Cloudflare Queues (for async message sending)
- **Cron**: Workers Cron Triggers (step delivery scheduling)

## Architecture
```
LINE Platform → CF Workers (webhook) → D1
                                      ↓
Vercel (Admin UI) → CF Workers (API) → D1
                                      ↓
CF Cron Trigger → Workers → LINE Messaging API
```

## Monorepo Structure
```
line-oss-crm/
├── apps/
│   ├── web/          # Next.js admin dashboard (Vercel)
│   └── worker/       # Cloudflare Workers API + webhook
├── packages/
│   ├── db/           # D1 schema, migrations, queries
│   ├── line-sdk/     # LINE Messaging API wrapper (typed)
│   └── shared/       # Shared types, constants
├── wrangler.toml
├── package.json      # pnpm workspace
└── README.md         # Setup guide (clone → deploy in 5 min)
```

## Core Features (MVP)

### 1. Friend Management
- Auto-register on friend add webhook
- Profile sync (display name, picture)
- Tag system (manual + auto-tagging by actions)
- Segment builder (tag combinations)

### 2. Step Delivery (ステップ配信)
- Create scenarios with multiple steps
- Each step: delay (days/hours) + message content
- Trigger: friend add, tag added, manual
- Support: text, image, flex message, rich menu switch
- Pause/resume per user

### 3. Broadcast (一斉配信)
- Send to all or filtered segments
- Schedule future sends
- Draft/preview before sending

### 4. Rich Menu Management
- Create/switch rich menus per segment
- Conditional display based on tags

### 5. Auto-Response
- Keyword-based auto-reply
- Flex message templates
- AI response option (future)

### 6. Analytics Dashboard
- Friend growth chart
- Message delivery/open rates
- Step completion funnel
- Tag distribution

## D1 Schema (Key Tables)
- `friends` - LINE user profiles + metadata
- `tags` - tag definitions
- `friend_tags` - many-to-many
- `scenarios` - step delivery scenarios
- `scenario_steps` - individual steps in scenario
- `friend_scenarios` - user progress in scenarios
- `broadcasts` - scheduled/sent broadcasts
- `messages_log` - delivery log
- `rich_menus` - rich menu configs
- `auto_replies` - keyword → response mapping
- `admin_users` - dashboard login

## Auth
- Admin dashboard: simple email/password or OAuth
- Workers API: API key + webhook signature verification

## Key Design Decisions
- D1 over Turso/PlanetScale: zero config, free tier, native CF integration
- Hono over itty-router: better DX, middleware, typed
- pnpm workspace: lightweight monorepo
- All LINE API calls through typed SDK wrapper

## Deployment Guide (README)
1. Clone repo
2. Create LINE Official Account + Messaging API channel
3. `cp .env.example .env` → fill LINE credentials
4. `pnpm install`
5. `npx wrangler d1 create line-crm` → update wrangler.toml
6. `npx wrangler d1 execute line-crm --file=packages/db/schema.sql`
7. `npx wrangler deploy` (Workers)
8. `vercel deploy` (Admin UI)
9. Set webhook URL in LINE console

## Scaling Notes
- Free tier handles ~5,000 friends comfortably
- 10,000+ friends: D1 paid ($0.75/1M reads), Workers paid ($5/mo)
- 50,000+ friends: Consider Queues for rate-limited sending
- LINE rate limit: 100,000 messages/min (shouldn't be an issue)

## IMPORTANT: API-First / CC-Native Design

### Philosophy
This is NOT a traditional SaaS with a UI that happens to have an API.
This is an **API-first platform** where the admin UI is just one client.

### Requirements
- **Every single feature must be exposed as a REST API endpoint**
- API is the source of truth. UI is just a consumer.
- Claude Code / AI agents must be able to fully operate the CRM via API
- All endpoints return JSON, well-documented with OpenAPI spec
- API key auth for programmatic access

### Full Feature List (L社 + U社 parity)

#### Friend Management
- GET/POST/PUT/DELETE friends
- Bulk tag/untag
- Custom fields (name, email, phone, any key-value)
- Friend activity log (messages sent/received, actions taken)
- Block/unblock
- CSV import/export

#### Scenarios (ステップ配信)
- CRUD scenarios
- Steps: text, image, video, flex message, rich menu switch, tag add/remove
- Triggers: friend add, tag change, keyword, date, manual
- Conditional branching (if tag X → step A, else → step B)
- Delay: minutes, hours, days
- A/B testing (split delivery)
- Completion actions (add tag, move to another scenario)

#### Broadcasts (一斉配信)
- Send to all / filtered segment
- Schedule future sends
- Draft management
- Template library

#### Rich Menus
- CRUD rich menus
- Per-segment assignment
- Tap area → action mapping (URL, postback, text, scenario trigger)
- Image upload support

#### Auto Response
- Keyword matching (exact, contains, regex)
- Response: text, flex, image, scenario trigger
- Priority ordering

#### Forms & Surveys
- Create forms (embedded in LINE via LIFF)
- Collect responses → auto-tag
- Response → trigger scenario

#### Reminders (リマインダ配信)
- Date-based reminders
- Countdown messages (3 days before, 1 day before, etc.)

#### Analytics
- GET /analytics/friends (growth, churn)
- GET /analytics/messages (delivery, open rate)
- GET /analytics/scenarios (funnel, completion rate)
- GET /analytics/broadcasts (performance)
- All queryable by date range, segment

#### Webhook Events (Outgoing)
- Friend actions → webhook to external URL
- For integrating with other systems

#### OpenAPI Spec
- Auto-generated from Hono routes
- Swagger UI at /docs
- TypeScript SDK auto-generated

### CC Integration Example
```bash
# Create a scenario
curl -X POST https://api.example.com/scenarios \
  -H "Authorization: Bearer sk-xxx" \
  -d '{"name":"新規友だちシナリオ","trigger":"friend_add"}'

# Add steps
curl -X POST https://api.example.com/scenarios/1/steps \
  -d '{"delay_hours":0,"type":"text","content":"友だち追加ありがとう！"}'

# Tag friends by segment
curl -X POST https://api.example.com/friends/bulk-tag \
  -d '{"filter":{"registered_after":"2024-01-01"},"tag":"新規"}'

# Send broadcast
curl -X POST https://api.example.com/broadcasts \
  -d '{"segment":{"tags":["VIP"]},"message":{"type":"text","text":"限定セール！"}}'
```

## Extended Features (CVR Optimization & LINE Platform Full)

### Rich Messages (CVR施策)
- Flex Message builder (visual editor in admin UI)
- Carousel messages (商品一覧、メニュー)
- Image map messages (タップ領域付き画像)
- Quick reply buttons
- Confirm template (Yes/No分岐)
- Button template (複数CTA)
- Video messages with action button

### LINE Login Integration
- LIFF (LINE Front-end Framework) for in-LINE web apps
- LINE Login for admin dashboard (optional)
- User profile enrichment via Login scope (email, etc.)
- ID連携 (LINE userId ↔ external system ID)

### LINE Mini App Support
- Mini app launch from rich menu / messages
- User data passthrough
- Payment integration hooks (LINE Pay)

### CVR Optimization Tools
- URL click tracking (短縮URL + クリック計測)
- A/B test messages (which flex gets more taps?)
- Conversion tracking (form submit, purchase, etc.)
- Retargeting: 未開封→再送、未完了→リマインド
- Time-optimized delivery (配信時間最適化)
- Progressive profiling (段階的にユーザー情報収集)

### Audience Sync
- LINE Official Account audience upload
- Lookalike audience creation support
- LINE広告連携 (LINE Ads Platform audience)

### Webhook Actions (ポストバック)
- Postback event handling
- Action chains (tap → tag → scenario → rich menu switch)
- Deep linking support

### E-commerce Integration
- Purchase event tracking
- Order status notifications
- Abandoned cart reminders
- Receipt messages (Flex)

### Multi-account Support
- Manage multiple LINE Official Accounts from one dashboard
- Account switching in admin UI
- Per-account API keys

## Cross-Account UUID Linking (アカウント間UUID連携) - CRITICAL

### Problem
LINE Official Accounts can get banned. When that happens, all friend data is lost.
Also, businesses may run multiple accounts (main + sub-accounts for different purposes).

### Solution: Internal UUID System
- Every friend gets an **internal UUID** (our system's ID) separate from LINE userId
- LINE userId is per-Official-Account (different userId per account for same person)
- Link multiple LINE userIds to one internal UUID

### Implementation
- `users` table: internal UUID + email/phone/custom identifiers
- `line_accounts` table: LINE channel configs
- `line_friends` table: line_user_id + line_account_id + internal_uuid
- When user interacts with Account B, match by:
  1. LINE Login (same sub = same person across accounts)
  2. LIFF ID token (email scope)
  3. Phone number / email collected via form
  4. Manual CSV mapping
  5. Custom link parameter (e.g. ?uid=xxx in rich menu URL)

### Account Ban Recovery
1. Create new LINE Official Account
2. Register in our system
3. Old friends who add new account → auto-matched by UUID
4. All tags, scenario progress, custom fields preserved
5. Scenario continues from where it left off

### API
- POST /users/:uuid/link - Link LINE userId to UUID
- GET /users/:uuid/accounts - List all linked LINE accounts
- POST /accounts/:id/migrate - Migrate friends from old → new account
- GET /users/:uuid/history - Cross-account interaction history

### Data Portability
- All data is UUID-centric, not LINE-userId-centric
- Export/import by UUID (full history across accounts)
- Zero vendor lock-in to any single LINE account

## Affiliate & Conversion Tracking (アフィリエイト・CV計測)

### Micro Conversion Points
- Define custom conversion events at any point:
  - 友だち追加
  - リッチメニュータップ
  - URL クリック
  - フォーム送信
  - 特定キーワード送信
  - シナリオ特定ステップ到達
  - LIFF ページ閲覧
  - 購入完了
  - LINE Pay決済
- Each CV point has a name, value (optional ¥), and UUID tracking

### Affiliate System
- Generate unique tracking URLs per affiliate/referrer
  - `https://lin.ee/xxx?ref=affiliate_code`
  - Or LIFF URL with tracking param
- Affiliate management:
  - CRUD affiliates (name, code, commission rate)
  - Per-affiliate dashboard (clicks, CVs, revenue)
  - Tiered commission (CV数に応じて料率変動)
- Attribution:
  - First-touch / last-touch / multi-touch models
  - UUID-based → 100% accurate attribution across sessions
  - Cookie-less tracking (LINE内だからcookie不要)
- Payout reports:
  - CSV export for affiliate payouts
  - Period-based aggregation

### Funnel Analytics (UUID-powered)
- Define custom funnels:
  - 友だち追加 → ステップ3到達 → フォーム送信 → 購入
- Drop-off analysis at each stage
- Segment comparison (タグAの人 vs タグBの人)
- Revenue attribution per scenario/broadcast

### API
- POST /conversions/points - Define CV point
- POST /conversions/track - Record conversion event
- GET /conversions/report - Aggregated CV data
- CRUD /affiliates - Manage affiliates
- GET /affiliates/:id/report - Affiliate performance
- GET /funnels - Funnel analysis
- POST /funnels - Define custom funnel

## Stealth Operation (LINE Platform Compliance & Stealth)

### Principles
- All operations must appear as normal LINE Official Account usage
- No fingerprinting, no suspicious patterns

### Implementation Rules
- **Rate limiting**: Respect LINE API limits, add jitter/randomization to bulk sends
  - Don't send 10,000 messages in 1 second → spread over minutes with random delays
  - Mimic human-operated official account patterns
- **Webhook response**: Always return 200 OK immediately (LINE requires <1s response)
- **No scraping**: Only use official Messaging API endpoints
- **Message patterns**: Avoid identical messages to large groups simultaneously
  - Add small variations or personalization tokens
  - Stagger delivery times (±random minutes)
- **API calls**: Use standard LINE SDK headers, no custom user-agents
- **Rich menu switches**: Don't rapid-fire switch menus, add natural delays
- **LIFF pages**: Host on custom domain, no obvious automation branding
- **Tracking URLs**: Use your own domain shortener, not suspicious redirect chains
- **Error handling**: Graceful degradation, don't retry aggressively on 429s
- **Multi-account**: Spread across different CF Workers deployments if needed
  - Each account gets its own worker URL as webhook
  - No shared infrastructure visible from LINE's side

### What NOT to do
- Don't exceed documented rate limits
- Don't use undocumented API endpoints
- Don't impersonate LINE SDK version strings
- Don't bulk-add friends (not possible via API anyway)
- Don't send prohibited content types
