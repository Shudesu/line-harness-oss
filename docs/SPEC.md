# みやびライン — 完全プロダクト仕様書 (SPEC v2.1.0)

> **作成日**: 2026-03-26
> **更新日**: 2026-03-26
> **対象リポジトリ**: ShunsukeHayashi/line-harness-oss
> **本番ブランチ**: main
> **ステータス**: アクティブ開発中（M0 ベータフェーズ）
> **Workers 名**: `miyabi-line-crm`
> **Workers URL**: `https://miyabi-line-crm.supernovasyun.workers.dev`
> **D1 Database ID**: `2b9355ee-ddef-45d1-bca1-06a0a029ff83`

---

## 目次

1. [プロダクト概要](#1-プロダクト概要)
2. [ターゲットペルソナ](#2-ターゲットペルソナ)
3. [価格プラン](#3-価格プラン)
4. [技術スタック](#4-技術スタック)
5. [モノレポ構成](#5-モノレポ構成)
6. [データベーススキーマ](#6-データベーススキーマ)
7. [API エンドポイント仕様](#7-api-エンドポイント仕様)
8. [機能要件](#8-機能要件)
9. [非機能要件](#9-非機能要件)
10. [環境変数・シークレット](#10-環境変数シークレット)
11. [CI/CD パイプライン](#11-cicd-パイプライン)
12. [法務要件 (T38)](#12-法務要件-t38)
13. [AIデータガバナンス](#13-aiデータガバナンス)
14. [マルチエージェント構成](#14-マルチエージェント構成)
15. [差別化・競合比較](#15-差別化競合比較)
16. [ロードマップ](#16-ロードマップ)
17. [用語集](#17-用語集)

---

## 1. プロダクト概要

**みやびライン**（LINE Harness OSS フォーク）は、LINE 公式アカウントを AI × CRM × Stripe で統合管理する SaaS プラットフォームです。

### ビジョン

> 「LINE CRM を誰でも月 ¥2,980 から。L-step の 1/7 のコストで、AI がマーケティングを自動化する。」

### 独自性（4 つの柱）

| 柱 | 説明 |
|----|------|
| **PPAL × LINE** | PPAL 受講生向けに特化した CRM エコシステム。コース受講 → LINE フォロー → 購買最適化の一貫フロー |
| **Claude AI 自動返信** | `claude-sonnet-4-6` / `claude-haiku-4-5-20251001` による高品質な AI 自動応答（PII フィルタリング済み） |
| **MCP ツール統合** | Claude Code・AI アシスタントから自然言語で LINE 操作。「PPAL 受講生全員に告知を送って」で実行 |
| **Stripe 課金内包** | Subscription API による Pro/Business プラン課金。決済完了 → LINE タグ付与を自動化 |

### 競合優位

```
L-step: ¥21,780/月（スタンダード）
みやびライン: ¥2,980/月（Pro）= 1/7 のコスト + AI 機能
```

### upstream 方針

> **重要**: upstream (Shudesu/line-harness-oss) への PR は **永久停止**（2026-03-25 決定）。
> 本リポジトリは「みやびライン」として完全独立開発。upstream との差分は随時取り込み専用。

---

## 2. ターゲットペルソナ

### Primary: PPAL 受講生

- **属性**: AI × コンテンツビジネス学習中の個人事業主
- **課題**: L-step 月 3 万円が重い。LINE 運用を自動化したい
- **提供価値**: PPAL 受講生割引（Pro 初月無料）+ AI 診断シナリオ統合

### Secondary: 個人コーチ・コンサル

- **属性**: LINE で顧客フォロー中、フォロワー 100〜1,000 名
- **課題**: 個別対応が時間を圧迫
- **提供価値**: AI が行動に応じて自動メッセージ配信

### Tertiary: 小規模 EC・オンラインショップ

- **属性**: Stripe + LINE を組み合わせたい
- **課題**: LINE × 決済の統合が技術的に難しい
- **提供価値**: Stripe Subscription → LINE タグ連動がノーコードで設定可能

---

## 3. 価格プラン

### Free（永久無料）

| 項目 | 制限 |
|------|------|
| 友だち数 | 最大 100 名 |
| 月間メッセージ | 500 通 |
| シナリオ数 | 3 本 |
| AI 返信 | なし |
| Stripe 課金 | なし |

### Pro（¥2,980/月）

| 項目 | 制限 |
|------|------|
| 友だち数 | 最大 3,000 名 |
| 月間メッセージ | 無制限 |
| シナリオ数 | 無制限 |
| AI 返信 | Claude Haiku 月 1,000 回 |
| Stripe 課金 | あり（Checkout / Portal） |
| MCP ツール | あり |

<!-- TODO: T37 完了後に実際の Stripe Product/Price ID に更新すること -->
**Stripe Product ID**: `prod_miyabi_pro`（暫定、T37 で確定）
**Stripe Price ID**: `price_2980_jpy_monthly`（暫定、T37 で確定）

### Business（¥9,800/月）

| 項目 | 制限 |
|------|------|
| 友だち数 | 無制限 |
| 月間メッセージ | 無制限 |
| AI 返信 | Claude Sonnet 無制限 |
| セグメント配信 | 高度スコアリング |
| CSV エクスポート | あり |
| 優先サポート | あり |

<!-- TODO: T37 完了後に実際の Stripe Product/Price ID に更新すること -->
**Stripe Product ID**: `prod_miyabi_business`（暫定、T37 で確定）
**Stripe Price ID**: `price_9800_jpy_monthly`（暫定、T37 で確定）

### PPAL 割引（限定）

| 対象 | 特典 | 期限 |
|------|------|------|
| PPAL β テスト 10 名 | Pro 初月無料 | 2026-04-30 |
| PPAL 受講生（通常） | Pro 20% OFF 永続 | 2026-12-31 |
| PPAL Alumni | Business 初月 50% OFF | 2026-06-30 |

---

## 4. 技術スタック

| 層 | 技術 | バージョン |
|----|------|------------|
| API / Webhook | Cloudflare Workers + Hono | Workers Runtime, Hono v4 |
| データベース | Cloudflare D1 (SQLite) | 生 SQL、ORM なし |
| 管理 UI | Next.js (App Router) + Tailwind CSS | Next.js 15 |
| LIFF | Vite + vanilla TypeScript | Vite 5 |
| パッケージ管理 | pnpm workspace | pnpm v9 |
| CI/CD | GitHub Actions | Copilot Coding Agent + Claude AI Review |
| AI | Anthropic Claude API | `claude-sonnet-4-6` / `claude-haiku-4-5-20251001` |
| 決済 | Stripe | Subscription API |
| 型 | TypeScript strict モード | TypeScript 5.x |

### 実行環境制約（Workers）

- `node:*` API 禁止（`node:fs`、`node:path` 等）
- D1 クエリパターン: `db.prepare('SQL').bind(...).run()` / `.first()` / `.all()`
- URL / URLSearchParams は `lib: ["ES2022", "DOM"]` を tsconfig に追加
- Workers 環境: `lib: ["ES2022", "WebWorker"]`

---

## 5. モノレポ構成

```
line-harness-oss/
├── apps/
│   ├── worker/                    # Cloudflare Workers API + Webhook
│   │   ├── src/
│   │   │   ├── index.ts           # エントリポイント・ルーティング・CORS・Auth middleware
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts        # Bearer 認証（API_KEY）
│   │   │   │   └── rate-limit.ts  # Cloudflare Rate Limiting
│   │   │   ├── routes/            # 26 ルートファイル（詳細は §7）
│   │   │   └── services/
│   │   │       ├── event-bus.ts   # イベント駆動オートメーション（2フェーズ実行）
│   │   │       ├── miyabi-ai-router.ts  # AI 返信ルーター
│   │   │       ├── step-delivery.ts     # シナリオステップ配信
│   │   │       └── token-refresh.ts     # LINE アクセストークン自動更新
│   │   └── wrangler.toml          # CF Workers 設定・D1 バインディング
│   │
│   ├── web/                       # Next.js 15 管理ダッシュボード（CF Pages）
│   │   └── app/
│   │       ├── (dashboard)/       # 管理画面ルート群
│   │       ├── landing/           # LP（L-step 比較・AI デモ）
│   │       └── api/               # Next.js API Routes
│   │
│   └── liff/                      # LINE LIFF（Vite + TypeScript）
│
├── packages/
│   ├── db/
│   │   └── migrations/            # 010 本 + multi_account（詳細は §6）
│   ├── line-sdk/                  # LINE Messaging API ラッパー
│   ├── sdk/                       # 外部公開 SDK（@line-harness/sdk）
│   └── shared/                    # 共通型定義
│
├── project_memory/                # エージェント共有ドキュメント
├── docs/                          # 仕様書・変更ログ
│   ├── SPEC.md                    # 本ドキュメント
│   └── wiki/
└── .github/workflows/             # CI/CD パイプライン
```

---

## 6. データベーススキーマ

> Cloudflare D1（SQLite）。マイグレーション: `packages/db/migrations/`

### マイグレーション一覧

| ファイル | 主要テーブル |
|---------|-------------|
| 001_initial.sql | friends, scenarios, steps, tags, automations |
| 002_segments.sql | segment_conditions, segment_sends, broadcasts |
| 003_entry_routes.sql | entry_routes（登録経路トラッキング） |
| 004_friend_metadata.sql | friend_metadata（LINE プロフィール同期） |
| 005_step_branching.sql | step_branching（条件分岐） |
| 006_tracked_links.sql | tracked_links（クリック追跡） |
| 007_forms.sql | forms, form_fields, form_submissions |
| 008_rate_limit.sql | rate_limit（API 制限） |
| 009_beta_feedback.sql | beta_feedback（構造化フィードバック） |
| 010_token_expiry.sql | token_expiry（LINE トークン自動更新） |
| 011_ai_consent.sql | friends への ai_consent カラム追加（**T38 で適用**） |
| 001_round2.sql | users, line_accounts, conversion_points, conversion_events, affiliates, affiliate_clicks, admin_users |
| 002_round3.sql | incoming_webhooks, outgoing_webhooks, google_calendar_connections, calendar_bookings, reminders, reminder_steps, friend_reminders, friend_reminder_deliveries, scoring_rules, friend_scores, templates, operators, chats, notification_rules, notifications, stripe_events, account_health_logs, account_migrations, automations, automation_logs |
| multi_account.sql | line_accounts（マルチ LINE チャネル対応） |

### コアテーブル詳細

#### friends（友だち）

> **注意**: `ai_consent` カラムは現時点（2026-03-26）の本番 DB には存在しない。
> `011_ai_consent.sql`（T38 前提）適用後に有効になる。

```sql
CREATE TABLE friends (
  id                 TEXT PRIMARY KEY,
  line_user_id       TEXT UNIQUE NOT NULL,
  display_name       TEXT,
  picture_url        TEXT,
  status_message     TEXT,
  is_following       INTEGER DEFAULT 1,
  tags               TEXT DEFAULT '[]',   -- JSON array
  score              INTEGER DEFAULT 0,
  metadata           TEXT DEFAULT '{}',   -- JSON object
  ref_code           TEXT,
  user_id            TEXT,                -- 会員アカウントとの紐付け
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
  -- ※ ai_consent / ai_consent_updated_at は 011_ai_consent.sql（T38）で追加
);
```

#### scenarios（シナリオ）

```sql
CREATE TABLE scenarios (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  trigger_type TEXT,     -- 'friend_add' | 'tag_added' | 'manual'
  trigger_tag_id TEXT,
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);
```

#### scenario_steps（ステップ）

```sql
CREATE TABLE scenario_steps (
  id          TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  step_order  INTEGER NOT NULL,
  delay_days  INTEGER DEFAULT 0,
  delay_hours INTEGER DEFAULT 0,
  message_type TEXT,   -- 'text' | 'image' | 'flex' | 'rich_menu_switch'
  message_content TEXT,
  condition   TEXT DEFAULT '{}',  -- 条件分岐 JSON
  created_at  TEXT DEFAULT (datetime('now'))
);
```

#### broadcasts（一斉配信）

```sql
CREATE TABLE broadcasts (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  status       TEXT DEFAULT 'draft',  -- 'draft' | 'scheduled' | 'sending' | 'sent'
  segment_id   TEXT,
  message_type TEXT,
  message_content TEXT,
  sent_count   INTEGER DEFAULT 0,
  scheduled_at TEXT,
  sent_at      TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
```

#### scoring_rules（スコアリングルール）

```sql
CREATE TABLE scoring_rules (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'open_message' | 'click_link' | 'purchase' | 'tag_added'
  tag_id     TEXT,
  score_delta INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

#### stripe_events（Stripe イベント）

```sql
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,
  friend_id    TEXT REFERENCES friends(id),
  event_type   TEXT NOT NULL,
  event_id     TEXT UNIQUE NOT NULL,
  amount       INTEGER,
  currency     TEXT,
  plan         TEXT,   -- 'pro' | 'business'
  metadata     TEXT DEFAULT '{}',
  created_at   TEXT DEFAULT (datetime('now'))
);
```

---

## 7. API エンドポイント仕様

> ベース URL: `https://miyabi-line-crm.supernovasyun.workers.dev`
> 認証: `Authorization: Bearer {API_KEY}` (全エンドポイント、LIFF 公開 URL を除く)

### 7.1 友だち管理 `/api/friends`

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/friends` | 一覧取得（?limit=20&offset=0、タグフィルタ対応） |
| GET | `/api/friends/:id` | 詳細取得 |
| PATCH | `/api/friends/:id` | 更新（tags、score、metadata 等） |
| DELETE | `/api/friends/:id` | 削除 |
| POST | `/api/friends/:id/tags` | タグ付与 |
| DELETE | `/api/friends/:id/tags/:tagId` | タグ解除 |
| GET | `/api/friends/:id/messages` | メッセージ履歴 |

**レスポンス例**（serializeFriend）:

```json
{
  "id": "uuid",
  "lineUserId": "U1234567890",
  "displayName": "みやびさん",
  "pictureUrl": "https://profile.line-scdn.net/...",
  "statusMessage": "",
  "isFollowing": true,
  "tags": ["購入済み", "PPAL受講生"],
  "score": 85,
  "metadata": {},
  "refCode": "ppal2026",
  "userId": null,
  "createdAt": "2026-03-01T00:00:00Z",
  "updatedAt": "2026-03-26T00:00:00Z"
}
```

### 7.2 タグ管理 `/api/tags`

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/tags` | タグ一覧 |
| POST | `/api/tags` | タグ作成 |
| PUT | `/api/tags/:id` | タグ更新 |
| DELETE | `/api/tags/:id` | タグ削除 |

### 7.3 シナリオ管理 `/api/scenarios`

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/scenarios` | 一覧取得 |
| GET | `/api/scenarios/:id` | 詳細取得 |
| POST | `/api/scenarios` | 作成 |
| PUT | `/api/scenarios/:id` | 更新 |
| DELETE | `/api/scenarios/:id` | 削除 |
| POST | `/api/scenarios/:id/steps` | ステップ追加 |
| PUT | `/api/scenarios/:id/steps/:stepId` | ステップ更新 |
| DELETE | `/api/scenarios/:id/steps/:stepId` | ステップ削除 |
| POST | `/api/scenarios/:id/enroll` | 友だちをシナリオに登録 |

### 7.4 一斉配信 `/api/broadcasts`

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/broadcasts` | 配信履歴 |
| POST | `/api/broadcasts` | 配信作成 |
| POST | `/api/broadcasts/:id/send` | 即時送信 |
| POST | `/api/broadcasts/:id/schedule` | スケジュール設定 |
| DELETE | `/api/broadcasts/:id` | 削除 |

### 7.5 Stripe 連携 `/api/integrations/stripe`

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/integrations/stripe/events` | イベント一覧（?friendId, ?eventType, ?limit） |
| POST | `/api/integrations/stripe/webhook` | Stripe Webhook 受信（署名検証必須） |
| POST | `/api/integrations/stripe/checkout` | Checkout Session 作成 |
| POST | `/api/integrations/stripe/portal` | Customer Portal セッション作成 |

**Webhook イベント処理**:

| イベント | 処理 |
|---------|------|
| `payment_intent.succeeded` | 購入完了タグ付与 → シナリオ登録 |
| `customer.subscription.created` | プラン開始 → 友だちに plan タグ |
| `customer.subscription.deleted` | プラン解約 → タグ解除 |

**priceId → plan 解決**:

```typescript
function resolvePlan(priceId: string, proPriceId: string, businessPriceId: string): 'pro' | 'business' | null {
  if (priceId === proPriceId) return 'pro';
  if (priceId === businessPriceId) return 'business';
  return null;
}
```

### 7.6 AI 分析 `/api/ai`

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/ai/analyze` | D1 コンテキスト付き Claude ストリーミング応答 |

**リクエスト**:

```json
{ "prompt": "今月の配信パフォーマンスを教えて" }
```

**内部処理**:

1. D1 から友だち数・タグ・アクティブシナリオ・配信実績を取得
2. システムプロンプトに CRM データを埋め込み
3. `claude-sonnet-4-6` でストリーミング応答（最大 512 トークン）
4. SSE (Server-Sent Events) でレスポンスをストリーム

### 7.7 Webhook 処理 `/webhook`

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/webhook/line` | LINE Messaging API イベント受信 |
| POST | `/webhook/incoming` | 外部 Webhook（Teachable 等）受信 |

**LINE Webhook イベント処理フロー**:

```
LINE Platform → POST /webhook/line
  → 署名検証（X-Line-Signature）
  → イベント種別ルーティング
    ├── follow → friends テーブル登録 → ウェルカムメッセージ → シナリオ開始
    ├── unfollow → is_following = 0 更新
    ├── message → AI 返信判定 → miyabi-ai-router
    └── postback → タグ付与 / シナリオ分岐
  → event-bus.ts でオートメーション実行（2フェーズ）
      Phase 1: スコアリング処理
      Phase 2: オートメーション条件評価・実行
```

### 7.8 その他エンドポイント

| パス | 機能 |
|------|------|
| `GET /api/health` | ヘルスチェック（D1 接続確認含む） |
| `GET /api/tags` | タグ管理 |
| `POST /api/rich-menus` | リッチメニュー登録・切替 |
| `GET /api/forms` | フォーム CRUD |
| `POST /api/liff/submit` | LIFF フォーム送信（認証不要） |
| `GET /api/chats` | チャット履歴 |
| `POST /api/chats/send` | 個別メッセージ送信 |
| `GET /api/scoring` | スコアリングルール管理 |
| `POST /api/scoring/rules` | ルール作成 |
| `GET /api/automations` | オートメーション一覧 |
| `GET /api/tracked-links` | 追跡リンク管理 |
| `GET /api/analytics` | 分析データ |
| `GET /api/conversions` | コンバージョン一覧 |
| `GET /api/affiliates` | アフィリエイト管理 |
| `GET /api/reminders` | リマインダー管理 |
| `GET /api/notifications` | 通知管理 |
| `GET /api/templates` | メッセージテンプレート |
| `GET /api/webhooks` | アウトバウンド Webhook 設定 |
| `GET /api/calendar` | Google Calendar 連携 |
| `GET /api/line-accounts` | マルチ LINE チャネル管理 |
| `GET /api/users` | ユーザー管理 |
| `GET /api/beta-feedback` | ベータフィードバック収集 |
| `GET /openapi.json` | OpenAPI スキーマ |

---

## 8. 機能要件

### 8.1 友だち管理

- LINE プロフィール自動取得・定期同期（pictureUrl、displayName、statusMessage）
- タグシステム: 最大 100 タグ / アカウント
- セグメント: タグ AND / OR 組み合わせで動的フィルタリング
- スコアリング: 行動（開封・クリック・購入）に応じて自動加算
- `score_threshold` 条件によるオートメーション（T22 修正済み）
- 登録経路（ref_code）トラッキング
- CSV エクスポート（Business プランのみ）

### 8.2 シナリオ配信（ステップ配信）

- シナリオ: 複数ステップの連続メッセージ配信
- 各ステップ: 遅延設定（日数・時間）+ メッセージ内容
- トリガー: friend_add / tag_added / manual / webhook
- メッセージ形式: text / image / flex / rich_menu_switch
- 条件分岐: タグ有無・スコア閾値による分岐
- 一時停止・再開（友だち単位）
- Cron Trigger でステップ配信をスケジュール実行

### 8.3 一斉配信

- 全友だち / セグメントへの一斉送信
- スケジュール予約送信
- 下書き保存・プレビュー
- 送信数トラッキング

### 8.4 AI 自動返信（みやびAI）

> **実装状況**: T36 完了済み（2026-03-25）

- **現在の動作**: LINE メッセージ受信時に AI 返信を実行
- **T38 適用後の動作**: `friends.ai_consent = 1` のユーザーのみ AI 返信（オプトアウト対応）
- **モデル**:
  - Business プラン: `claude-sonnet-4-6`（高品質分析・応答）
  - Pro プラン: `claude-haiku-4-5-20251001`（高速・低コスト）
- **PII フィルタリング**: 電話番号・メールアドレス・住所・カード番号を送信前に除去（`sanitizeForAI()`、ベストエフォート）
- **CRM コンテキスト**: 友だちのスコア・タグを systemPrompt に埋め込み（lineUserId はハッシュ化、displayName は送信しない）
- **ストリーミング**: SSE で管理画面にリアルタイム表示

### 8.5 AI 診断シナリオ（7 問診断）

1. LINE 友だち追加（エントリーポイント）
2. 7 問診断クイズ（LIFF）
3. Claude API でプロダクトマッチング判定
4. 診断結果メッセージ配信
5. 7 日間ステップ配信シナリオ開始

### 8.6 MCP ツール統合

packages/sdk 経由で Claude Code・AI アシスタントから自然言語操作:

```typescript
// 4 コアツール
line_broadcast_text(message: string, segmentId?: string)
line_broadcast_segment(message: string, tagIds: string[])
line_add_tag(lineUserId: string, tagName: string)
line_create_scenario(name: string, steps: Step[])
```

### 8.7 Stripe 課金

> **注意**: T37（Stripe 本番設定）は T38（法務ページ）完了後に実施

- Stripe Checkout Session: Pro / Business プラン購入
- Customer Portal: サブスクリプション管理・キャンセル
- Webhook: 決済完了 → LINE タグ自動付与
- 領収書: Stripe 側で自動発行

### 8.8 リッチメニュー管理

- リッチメニュー作成・削除・切替
- 条件分岐: タグ有無でリッチメニューを動的切替
- Alias による高速切替（lineAccountId 連携）

### 8.9 Google Calendar 連携

- OAuth 2.0 連携
- 予約スロット管理（calendar_bookings）
- リマインダー連動（LINE メッセージ自動送信）

### 8.10 LINE アクセストークン自動更新

- token_expiry テーブルで有効期限を管理
- **Cron Trigger**: 5 分ごと（`*/5 * * * *`）に期限チェック
- 30 日前から自動更新実行
- 更新失敗時: Telegram 通知

---

## 9. 非機能要件

### パフォーマンス

| 指標 | 目標 |
|------|------|
| API レスポンスタイム (P95) | < 500ms |
| Webhook 処理時間 | < 2s |
| D1 クエリタイム (P95) | < 100ms |
| AI 応答（初回トークン） | < 3s |
| LP Lighthouse Score | > 90 |

### 可用性

- Cloudflare Workers SLA: 99.9%
- D1 SLA: 99.9%
- 障害時: Cloudflare 側で自動フェイルオーバー

### セキュリティ

| 項目 | 実装 |
|------|------|
| API 認証 | Bearer Token（API_KEY 環境変数） |
| LINE Webhook 署名検証 | X-Line-Signature HMAC-SHA256 |
| Stripe Webhook 署名検証 | stripe-signature 検証 |
| CORS | 管理画面オリジン固定（T01 修正済み） |
| Rate Limiting | Cloudflare Rate Limiting（T02 実装済み）|
| LIFF 認証 | Access Token 検証（T03/T04 修正済み） |
| PII フィルタリング | AI 送信前に個人情報を除去（ベストエフォート） |
| D1 アクセス | Workers 内部のみ（外部直接アクセス不可） |

### スケーラビリティ

- Cloudflare Workers: グローバル 200+ エッジロケーション
- D1: 最大 10 GB / データベース
- ブロードキャスト: Cloudflare Queues で非同期処理（大量配信）

---

## 10. 環境変数・シークレット

> `wrangler secret put <NAME>` または `wrangler.toml [vars]` で設定

### 必須シークレット（`wrangler secret put` で設定）

| 変数名 | 説明 |
|--------|------|
| `LINE_CHANNEL_SECRET` | LINE チャンネルシークレット（Webhook 署名検証） |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE チャンネルアクセストークン |
| `LINE_LOGIN_CHANNEL_SECRET` | LINE Login チャンネルシークレット（LIFF 認証） |
| `API_KEY` | 管理 API の Bearer 認証キー |
| `ANTHROPIC_API_KEY` | Claude API キー（AI 機能用） |
| `STRIPE_SECRET_KEY` | Stripe シークレットキー（Checkout / Portal 作成） |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook 署名検証シークレット |
| `STRIPE_PRO_PRICE_ID` | Stripe Pro プライス ID（T37 で設定） |
| `STRIPE_BUSINESS_PRICE_ID` | Stripe Business プライス ID（T37 で設定） |

### オプションシークレット

| 変数名 | 説明 |
|--------|------|
| `GITHUB_TOKEN` | CI Issue 自動作成用 |
| `GITHUB_REPO` | `ShunsukeHayashi/line-harness-oss` |
| `TELEGRAM_BOT_TOKEN` | トークン更新失敗通知 |
| `TELEGRAM_CHAT_ID` | Telegram 通知先 |

### wrangler.toml `[vars]`（非シークレット）

| 変数名 | 値 / 説明 |
|--------|-----------|
| `WORKER_URL` | `https://miyabi-line-crm.supernovasyun.workers.dev` |
| `LIFF_URL` | LIFF アプリの URL |
| `LINE_CHANNEL_ID` | LINE チャンネル ID（Basic ID） |
| `LINE_LOGIN_CHANNEL_ID` | LINE Login チャンネル ID |
| `ALLOWED_ORIGINS` | 管理画面の許可オリジン（複数可） |
| `ENABLE_STEALTH_MODE` | `"true"` でステルスモード有効 |
| `ENVIRONMENT` | `"production"` / `"development"` |

### D1 バインディング

| バインディング名 | database_id |
|----------------|-------------|
| `DB` | `2b9355ee-ddef-45d1-bca1-06a0a029ff83` |

---

## 11. CI/CD パイプライン

### ワークフロー一覧（`.github/workflows/`）

| ファイル | トリガー | 処理 |
|---------|---------|------|
| `deploy-worker.yml` | main push / PR | `pnpm -r build` + `pnpm typecheck` + `wrangler deploy` |
| `ai-review.yml` | PR open / sync | `claude-opus-4-6` によるコードレビュー + APPROVE |
| `auto-merge.yml` | AI レビュー APPROVE 後 | squash merge + ブランチ削除 |
| `pr-preview.yml` | PR open | CF Pages プレビューデプロイ |
| `notify-failure.yml` | CI 失敗 | GitHub Issue 自動作成 + Telegram 通知 |
| `copilot-dispatch.yml` | CI 失敗 Issue | @copilot を自動アサイン |

### 実装フロー（Claude Code の役割）

```
Claude Code（要件定義・Issue 作成）
  → Copilot Coding Agent（自動実装・Draft PR）
    → CI: pnpm -r build + typecheck
      → claude-opus-4-6 AI レビュー
        → 自動 squash merge
```

### パイプライン起動（1 コマンド）

```bash
gh issue create \
  --repo ShunsukeHayashi/line-harness-oss \
  --title "[auto] feat: {機能の概要}" \
  --label "copilot,auto" \
  --body "## やりたいこと
{要件}

## 完了条件
- [ ] pnpm -r build が通る"
```

### パイプライン vs 直接実装の判断

| ケース | 対応 |
|--------|------|
| 新機能・バグ修正・テスト追加・リファクタリング | **パイプライン（デフォルト）** |
| `.github/workflows/` の変更 | Claude Code が直接実施 |
| セキュリティ修正（シークレット・認証） | Claude Code が直接実施 |
| `git merge` / upstream 取り込み | Claude Code が直接実施 |
| `pnpm db:migrate` 実行 | 手動（SQL 確認後） |
| 緊急ホットフィックス（5 分以内） | Claude Code が直接実施 |

---

## 12. 法務要件 (T38)

> **重要**: T38（法務ページ）は T37（Stripe 本番）の前提条件
> 日本の Stripe 本番利用には特商法ページ + プライバシーポリシー URL が必須

### 12.1 特定商取引法に基づく表示

必須記載項目:

- 販売業者名（屋号または法人名）
- 代表者名
- 所在地（市区町村まで）
- 電話番号またはメールアドレス
- 販売価格: Pro ¥2,980/月（税込）、Business ¥9,800/月（税込）
- 支払方法: クレジットカード（Stripe 経由）
- 支払時期: 申込月から毎月自動更新
- サービス提供時期: 申込直後から
- 返品・キャンセルポリシー
- 動作環境（推奨ブラウザ等）

### 12.2 プライバシーポリシー

必須記載項目:

- 取得する情報: LINE ユーザー ID、表示名、プロフィール画像 URL、メッセージ内容、クリック・開封履歴、タグ・スコアリングデータ
- 利用目的: CRM 機能の提供 / AI 自動応答 / マーケティング分析 / サービス改善
- 第三者提供先:
  - Anthropic, PBC（Claude API）: AI 処理、PII 除去後のみ
  - Stripe, Inc.: 決済処理
  - Cloudflare, Inc.: インフラ・D1 ホスティング（米国）
- オプトアウト方法: AI 返信設定からオフ（T38 実装後）
- 問い合わせ先

### 12.3 実装ページ

```
/legal/privacy          # プライバシーポリシー
/legal/tokushoho        # 特定商取引法に基づく表示
/legal/terms            # 利用規約
```

---

## 13. AIデータガバナンス

### PII フィルタリング仕様

> **注意**: `sanitizeForAI()` はベストエフォートの正規表現ベースフィルタ。
> 全ての PII を完全に検出・除去することを保証するものではない。
> 機密性の高い情報は LINE メッセージで送受信しないよう運用ガイドで案内すること。

```typescript
// apps/worker/src/services/pii-filter.ts
export function sanitizeForAI(message: string): string {
  let s = message.replace(/0\d{1,4}-?\d{1,4}-?\d{4}/g, '[電話番号]');
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[メール]');
  s = s.replace(/[都道府県].{1,10}[市区町村]/g, '[住所]');
  s = s.replace(/\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, '[カード番号]');
  return s;
}
```

### AI コンテキスト構築

- `lineUserId` → `hashUserId(lineUserId)` で匿名化してから送信
- `displayName` → 送信しない
- `score`、`tags`、`createdAt` → 送信可

### Anthropic API 適合確認

| 要件 | 状態 |
|------|------|
| API データはモデル学習に使用されない | 確認済み（Anthropic §5.2） |
| データ保持期間 30 日（ログのみ） | プライバシーポリシーに明記 |
| 有害コンテンツフィルター | システムプロンプトでフィルタリング |

### AI 同意（ai_consent）管理

> **重要**: `ai_consent` カラムは **現在の本番 DB には存在しない**。
> T38（法務ページ実装）の前提タスクとして `011_ai_consent.sql` を適用する。

T38 実施時に適用するマイグレーション（`packages/db/migrations/011_ai_consent.sql`）:

```sql
-- T38 で適用。適用前は全ユーザーが AI 返信対象となる
ALTER TABLE friends ADD COLUMN ai_consent INTEGER NOT NULL DEFAULT 1;
ALTER TABLE friends ADD COLUMN ai_consent_updated_at TEXT;
CREATE INDEX idx_friends_ai_consent ON friends(ai_consent);
```

適用後の動作:
- `ai_consent = 1`（デフォルト）: AI 返信有効
- `ai_consent = 0`: AI 返信無効（オプトアウト）
- オプトアウト手順: 管理画面の AI 返信設定、またはプライバシーポリシーに記載の問い合わせ先

---

## 14. マルチエージェント構成

| エージェント | 役割 | 起動方法 |
|------------|------|---------|
| **Claude Code（ローカル）** | 設計・要件定義・レビュー・緊急実装 | 直接 |
| **Copilot Coding Agent** | Issue → Draft PR 自動実装 | `[auto]` + `copilot` ラベルの Issue 作成 |
| **claude-opus-4-6（CI）** | PR コードレビュー・APPROVE | `ai-review.yml` 自動起動 |
| **kotowari-dev（OpenClaw）** | 複雑な実装・D1 操作 | `openclaw agent message kotowari-dev` |
| **Codex（Codex CLI）** | E2E テスト・lint 一括修正 | `%305` ペインに投入 |
| **sns-creator（OpenClaw）** | PPAL β 案内・SNS 投稿 | `openclaw agent message sns-creator` |

---

## 15. 差別化・競合比較

### L-step vs みやびライン

| 機能/コスト | L-step | みやびライン | 優位性 |
|------------|--------|------------|--------|
| **月額費用** | ¥21,780〜 | ¥2,980〜 | **1/7 のコスト** |
| **友だち上限** | プランにより | 無制限（Business） | ○ |
| **AI 自動応答** | なし | あり（Claude）✅ 実装済み | **みやびが優位** |
| **MCP ツール統合** | なし | あり（業界唯一） | **独占的優位** |
| **スコアリング** | 基本的 | 高度（イベント別） | ○ |
| **開発者 API** | なし | REST API 完備 | ○ |
| **カスタマイズ性** | 低 | 高（CF Workers） | ○ |
| **Stripe 内包** | なし | あり（T37 で本番稼働） | ○ |

### BKStock vs みやびライン

| 機能 | BKStock | みやびライン | 評価 |
|------|---------|------------|------|
| AI 自動応答 | Claude Haiku | Claude Haiku / Sonnet ✅ | 同等以上 |
| Stripe 課金 | なし | あり（T37） | **みやびが優位** |
| MCP ツール | なし | あり | **みやびが優位** |
| PPAL 連携 | なし | あり | **みやびが優位** |

---

## 16. ロードマップ

### Phase M0 — ベータフェーズ（現在）

#### 完了済みタスク

| タスク | 完了日 |
|--------|--------|
| T35 本番デプロイ・Workers 再デプロイ | 2026-03-25 |
| T36 AI 自動返信 実装（claude-haiku-4-5-20251001 / claude-sonnet-4-6） | 2026-03-25 |
| T22 event-bus score_threshold バグ修正 | 完了 |
| T01〜T20 基盤実装（認証・DB・Webhook・スコアリング等） | 完了 |

#### 未完了タスク（M0 完了条件）

| タスク | ステータス | 依存 |
|--------|----------|------|
| T38 法務ページ実装（特商法 + プライバシーポリシー） | **PENDING** | — |
| T37 Stripe 本番設定（wrangler secrets + テスト決済） | **PENDING** | T38 |
| T39 LP 改修（L-step 比較・AI デモ・訴求軸刷新） | **PENDING** | T35 |
| T40 オンボーディングウィザード（LINE チャネル接続 3 ステップ） | **PENDING** | T35 |
| T41 PPAL メンバー向け β 案内 + 早期アクセスフロー | **PENDING** | T35, T37, T38, T39 |

### Phase M1 — 公開β（MRR ¥138,100 目標）

| タスク | 説明 |
|--------|------|
| T31 スコアリングルール管理 UI | 管理画面からルール設定 |
| T32 友だちデータ CSV エクスポート | Business プラン機能 |
| T28 E2E テストスイート | 内部品質向上 |
| T24 PPAL コードを ppal/ ディレクトリに分離 | コード整理 |

### Phase M2 — 成長期（MRR ¥494,000 目標）

- 悩みランキング分析 API（`GET /api/analytics/question-ranking`）
- LIFF 会員マイページ
- 口座振替対応（日本市場向け）
- チャーン予測スコア
- 収益ダッシュボード（Stripe 連携後に自動集計）

### MRR 目標

| フェーズ | 目標ユーザー | MRR 目標 |
|---------|------------|---------|
| M0（β） | 10 名 Pro | ¥0（無償） |
| M1（公開β） | 30 名 Pro + 5 名 Business | ¥138,100 |
| M2（成長期） | 100 名 Pro + 20 名 Business | ¥494,000 |
| M3（安定期） | 300 名 Pro + 50 名 Business | ¥1,384,000 |

---

## 17. 用語集

| 用語 | 説明 |
|------|------|
| **みやびライン** | 本プロダクトの名称（LINE Harness OSS フォーク） |
| **PPAL** | 「プロンプトプログラミング for AIライフ」コース（主要顧客層） |
| **友だち（Friend）** | LINE 公式アカウントを友だち追加したユーザー |
| **シナリオ** | 複数ステップからなるメッセージ配信シーケンス |
| **ステップ配信** | 時間差で自動送信するメッセージ配信方式 |
| **スコアリング** | 友だちの行動に応じて数値スコアを付与する仕組み |
| **オートメーション** | スコア閾値・タグ条件に基づく自動アクション |
| **event-bus** | イベント処理の中核。スコアリング → オートメーションの 2 フェーズ実行（T22 修正済み） |
| **MCP** | Model Context Protocol。AI が外部ツールを操作するプロトコル |
| **LIFF** | LINE Front-end Framework。LINE 内で動く Web アプリ |
| **D1** | Cloudflare の SQLite データベースサービス |
| **Workers** | Cloudflare のサーバーレスエッジ実行環境 |
| **wrangler** | Cloudflare Workers の CLI ツール |
| **ai_consent** | AI 返信処理への同意フラグ（T38 実装後に friends テーブルに追加） |
| **PII** | Personally Identifiable Information（個人識別情報） |
| **特商法** | 特定商取引法（日本の EC 規制法） |
| **T37** | Stripe 本番設定タスク（T38 完了後に実施） |
| **T38** | 法務ページ実装タスク（T37 の前提条件） |
| **T36** | AI 自動返信実装タスク（完了済み 2026-03-25） |
| **T35** | 本番デプロイ・Workers 再デプロイタスク（完了済み 2026-03-25） |

---

*最終更新: 2026-03-26 by Claude Code (SPEC v2.1.0)*
