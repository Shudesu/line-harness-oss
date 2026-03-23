# Architecture — LINE Harness アーキテクチャ

## 全体構成図

```
┌─────────────────┐      ┌─────────────────────────────────┐
│  LINE Platform   │      │       Cloudflare Workers         │
│                  │      │                                   │
│  ユーザーの LINE ├─────►│  POST /webhook                   │
│  アプリ          │      │    ↓ verifySignature()           │
│                  │◄─────┤    ↓ handleEvent()               │
│                  │ push │    ↓ upsertFriend() / fireEvent()│
│                  │      │                                   │
└─────────────────┘      │  GET/POST /api/*                  │
                          │    ↓ authMiddleware (Bearer)      │
┌─────────────────┐      │    ↓ route handlers               │
│  管理画面        │      │                                   │
│  (Next.js)      ├─────►│  Cron (*/5 * * * *)              │
│  CF Pages /     │ API  │    ↓ processStepDeliveries()     │
│  Vercel         │      │    ↓ processScheduledBroadcasts()│
└─────────────────┘      │    ↓ processReminderDeliveries() │
                          │    ↓ checkAccountHealth()        │
┌─────────────────┐      │                                   │
│  SDK / Claude   │      │          ┌──────────┐            │
│  Code / curl    ├─────►│          │ D1 (SQLite)│           │
│                  │ API  │          │ 42 tables  │           │
└─────────────────┘      │          └──────────┘            │
                          │                                   │
┌─────────────────┐      │  LIFF (/api/liff/*, /api/forms/*) │
│  LIFF アプリ     │      │    ↓ 認証なし (LIFF IDトークン)    │
│  (Vite)         ├─────►│                                   │
└─────────────────┘      └─────────────────────────────────┘
```

## モノレポ構造

```
line-harness/
├── apps/
│   ├── worker/           # Cloudflare Workers API + Webhook
│   │   ├── src/
│   │   │   ├── index.ts          # Hono アプリ + Cron ハンドラ
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts       # Bearer トークン認証
│   │   │   ├── routes/
│   │   │   │   ├── webhook.ts    # LINE Webhook 受信
│   │   │   │   ├── friends.ts    # 友だち CRUD + メッセージ送信
│   │   │   │   ├── tags.ts       # タグ CRUD
│   │   │   │   ├── scenarios.ts  # シナリオ CRUD + ステップ + 登録
│   │   │   │   ├── broadcasts.ts # 配信 CRUD + 実行 + セグメント
│   │   │   │   ├── users.ts      # UUID ユーザー管理
│   │   │   │   ├── line-accounts.ts  # LINE アカウント管理
│   │   │   │   ├── conversions.ts    # CV ポイント + イベント
│   │   │   │   ├── affiliates.ts     # アフィリエイト管理
│   │   │   │   ├── webhooks.ts       # Webhook IN/OUT CRUD
│   │   │   │   ├── calendar.ts       # Google Calendar 連携
│   │   │   │   ├── reminders.ts      # リマインダー管理
│   │   │   │   ├── scoring.ts        # リードスコアリング
│   │   │   │   ├── templates.ts      # テンプレート管理
│   │   │   │   ├── chats.ts          # オペレーターチャット
│   │   │   │   ├── notifications.ts  # 通知システム
│   │   │   │   ├── stripe.ts         # Stripe 連携
│   │   │   │   ├── health.ts         # ヘルスチェック
│   │   │   │   ├── automations.ts    # IF-THEN オートメーション
│   │   │   │   ├── rich-menus.ts     # リッチメニュー管理
│   │   │   │   ├── tracked-links.ts  # トラッキングリンク
│   │   │   │   ├── forms.ts          # フォーム管理
│   │   │   │   ├── liff.ts           # LIFF 認証ルート
│   │   │   │   └── openapi.ts        # OpenAPI /docs
│   │   │   └── services/
│   │   │       ├── step-delivery.ts      # ステップ配信処理
│   │   │       ├── broadcast.ts          # 一斉配信処理
│   │   │       ├── reminder-delivery.ts  # リマインダー配信
│   │   │       ├── ban-monitor.ts        # BAN監視
│   │   │       ├── stealth.ts            # ジッター・レート制御
│   │   │       ├── event-bus.ts          # イベントバス
│   │   │       ├── segment-query.ts      # セグメントSQL生成
│   │   │       ├── segment-send.ts       # セグメント配信
│   │   │       └── google-calendar.ts    # GCal API
│   │   └── wrangler.toml
│   ├── web/              # Next.js 15 管理画面
│   │   └── src/
│   │       ├── app/      # App Router ページ
│   │       ├── components/  # UI コンポーネント
│   │       └── lib/api.ts   # API クライアント
│   └── liff/             # LIFF Vite アプリ
│       └── src/
│           ├── main.ts      # エントリ
│           ├── form.ts      # フォーム表示
│           └── booking.ts   # 予約機能
├── packages/
│   ├── db/               # D1 スキーマ & クエリ関数
│   │   └── src/
│   │       ├── index.ts       # 全モジュール re-export
│   │       ├── utils.ts       # jstNow(), toJstString()
│   │       ├── friends.ts     # Friend 型 + CRUD
│   │       ├── tags.ts        # Tag 型 + CRUD + friend_tags
│   │       ├── scenarios.ts   # Scenario 型 + CRUD + enrollment
│   │       ├── broadcasts.ts  # Broadcast 型 + CRUD + status
│   │       └── ...            # 他 15+ モジュール
│   ├── line-sdk/         # LINE Messaging API 型付きラッパー
│   │   └── src/
│   │       ├── client.ts      # LineClient (push/reply/multicast/broadcast)
│   │       ├── webhook.ts     # verifySignature()
│   │       ├── messages.ts    # メッセージ型ビルダー
│   │       └── types.ts       # LINE API 型定義
│   ├── sdk/              # @line-harness/sdk クライアントSDK
│   │   └── src/
│   │       ├── client.ts      # LineHarness メインクラス
│   │       ├── http.ts        # HttpClient (fetch ラッパー)
│   │       ├── delay.ts       # parseDelay ("30m", "1h", "1d")
│   │       ├── errors.ts      # LineHarnessError
│   │       ├── workflows.ts   # 高レベルワークフロー
│   │       ├── types.ts       # 全型定義
│   │       └── resources/     # リソースクラス群
│   └── shared/           # 共有型定義
│       └── src/
│           ├── index.ts
│           └── types.ts
```

## データフロー

### Webhook 受信フロー

```
LINE Platform
  │ POST /webhook
  │ Headers: X-Line-Signature
  ▼
verifySignature(channelSecret, rawBody, signature)
  │ 失敗 → return 200 (常に200を返す、LINE規約)
  ▼
JSON.parse(rawBody) → WebhookRequestBody
  │
  ▼
c.executionCtx.waitUntil(processingPromise)
  │ ← 即座に 200 を返す（LINE は 1秒以内のレスポンスを要求）
  ▼
handleEvent() — イベントタイプ別処理:

  follow:
    ├─ lineClient.getProfile(userId) → プロフィール取得
    ├─ upsertFriend(db, {...}) → friends テーブルに INSERT/UPDATE
    ├─ friend_add シナリオ検索 → enrollFriendInScenario()
    │   └─ delay_minutes=0 の場合は即時配信（pushMessage）
    └─ fireEvent(db, 'friend_add', {...})
        ├─ 送信Webhook通知
        ├─ スコアリングルール適用
        ├─ IF-THENオートメーション実行
        └─ 通知ルール処理

  unfollow:
    └─ updateFriendFollowStatus(db, userId, false)

  message (text):
    ├─ messages_log に受信記録
    ├─ upsertChatOnMessage() → チャット更新
    ├─ auto_replies チェック → replyMessage() (無料枠)
    └─ fireEvent(db, 'message_received', {...})
```

### Cron 配信フロー（5分毎）

```
Workers Cron Trigger (*/5 * * * *)
  │
  ▼
scheduled() — 4つの処理を並列実行:

  1. processStepDeliveries(db, lineClient)
     ├─ getFriendScenariosDueForDelivery(db, jstNow())
     │   └─ status='active' AND next_delivery_at <= now
     ├─ for each friend_scenario:
     │   ├─ ステルス: addJitter(50, 200)ms のランダム遅延
     │   ├─ getScenarioSteps() → 次のステップ取得
     │   ├─ evaluateCondition() → 条件チェック
     │   │   ├─ tag_exists / tag_not_exists
     │   │   ├─ metadata_equals / metadata_not_equals
     │   │   └─ 条件不一致 → next_step_on_false にジャンプ or スキップ
     │   ├─ buildMessage() → LINE メッセージ構築
     │   ├─ lineClient.pushMessage() → 配信
     │   ├─ messages_log に記録
     │   └─ advanceFriendScenario() or completeFriendScenario()
     │       └─ ステルス: jitterDeliveryTime(±5分)
     └─ エラー時は該当 friend_scenario のみスキップし続行

  2. processScheduledBroadcasts(db, lineClient)
     ├─ status='scheduled' AND scheduled_at <= now の配信を取得
     └─ processBroadcastSend() を実行

  3. processReminderDeliveries(db, lineClient)
     └─ 期日到来のリマインダーを配信

  4. checkAccountHealth(db)
     └─ LINE API ヘルスチェック → account_health_logs に記録
```

### イベントバス

```
fireEvent(db, eventType, payload)
  │
  ├─ fireOutgoingWebhooks()
  │   └─ outgoing_webhooks テーブルから eventType マッチを取得
  │       └─ fetch(wh.url, {...}) + HMAC署名 (X-Webhook-Signature)
  │
  ├─ processScoring()
  │   └─ applyScoring(db, friendId, eventType)
  │       └─ scoring_rules テーブルでマッチするルール適用
  │
  ├─ processAutomations()
  │   └─ getActiveAutomationsByEvent(db, eventType)
  │       ├─ matchConditions() → 条件チェック
  │       └─ executeAction() → アクション実行
  │           ├─ add_tag / remove_tag
  │           ├─ start_scenario
  │           ├─ send_message (pushMessage)
  │           ├─ send_webhook
  │           ├─ switch_rich_menu / remove_rich_menu
  │           └─ set_metadata
  │
  └─ processNotifications()
      └─ notification_rules テーブルでマッチ → notifications 作成
```

## 認証フロー

### 3つの認証方式

| 方式 | 対象 | ヘッダー/検証 |
|------|------|-------------|
| API Key (Bearer) | 管理画面/SDK/curl | `Authorization: Bearer {API_KEY}` |
| LINE Signature | Webhook | `X-Line-Signature` (HMAC-SHA256) |
| LIFF ID Token | LIFFアプリ | `/api/liff/*` ルートで検証 |

### API Key 認証ミドルウェア

```typescript
// apps/worker/src/middleware/auth.ts
// 以下のパスは認証スキップ:
//   /webhook           — LINE署名検証で保護
//   /docs, /openapi.json — 公開ドキュメント
//   /api/affiliates/click — クリックトラッキング（公開）
//   /t/*               — トラッキングリンクリダイレクト（公開）
//   /api/liff/*        — LIFF IDトークン認証
//   /auth/*            — LINE Login フロー
//   /api/integrations/stripe/webhook — Stripe Webhook
//   /api/webhooks/incoming/*/receive — 受信Webhook
//   /api/forms/*/submit — フォーム送信（公開）
//   /api/forms/*       — フォーム定義取得（LIFF用、公開）

// それ以外: Authorization: Bearer {API_KEY} が必須
```

### LINE Webhook 署名検証

```typescript
// packages/line-sdk/src/webhook.ts
// verifySignature(channelSecret, rawBody, signature)
//   1. channelSecret を HMAC-SHA256 のキーとして使用
//   2. rawBody のダイジェストを計算
//   3. X-Line-Signature ヘッダーと比較
//   4. 不一致でも 200 を返す（LINE規約）
```

## D1 データベーススキーマ概要

### コアテーブル（友だち管理）

| テーブル | 説明 | 主キー |
|---------|------|--------|
| `friends` | LINE友だち情報 | id (UUID) |
| `tags` | タグ定義 | id (UUID) |
| `friend_tags` | 友だち-タグ多対多 | (friend_id, tag_id) |

### シナリオ・配信

| テーブル | 説明 |
|---------|------|
| `scenarios` | シナリオ定義（trigger_type, is_active） |
| `scenario_steps` | シナリオのステップ（delay_minutes, message_type, condition_type） |
| `friend_scenarios` | 友だちのシナリオ進行状況（current_step_order, status, next_delivery_at） |
| `broadcasts` | 一斉配信（status: draft/scheduled/sending/sent） |
| `messages_log` | 送受信メッセージログ |

### UUID・マルチアカウント

| テーブル | 説明 |
|---------|------|
| `users` | 内部UUID（LINE userId とは別） |
| `line_accounts` | LINE公式アカウント設定 |

### 自動化・スコアリング

| テーブル | 説明 |
|---------|------|
| `automations` | IF-THENルール |
| `automation_logs` | 実行ログ |
| `scoring_rules` | スコアリングルール |
| `friend_scores` | スコア履歴 |
| `auto_replies` | 自動返信ルール |

### CV・アフィリエイト

| テーブル | 説明 |
|---------|------|
| `conversion_points` | CVポイント定義 |
| `conversion_events` | CVイベント記録 |
| `affiliates` | アフィリエイター |
| `affiliate_clicks` | クリック記録 |
| `ref_tracking` | 流入元トラッキング |
| `entry_routes` | エントリールート |

### その他

| テーブル | 説明 |
|---------|------|
| `forms` / `form_submissions` | LIFFフォーム |
| `tracked_links` / `link_clicks` | URLトラッキング |
| `reminders` / `reminder_steps` / `friend_reminders` | リマインダー |
| `templates` | メッセージテンプレート |
| `chats` / `operators` | チャット機能 |
| `notification_rules` / `notifications` | 通知 |
| `incoming_webhooks` / `outgoing_webhooks` | Webhook |
| `google_calendar_connections` / `calendar_bookings` | GCal |
| `stripe_events` | Stripe |
| `account_health_logs` / `account_migrations` | BAN監視 |
| `admin_users` | 管理者 |

## タイムスタンプ規約

全タイムスタンプは **JST (UTC+9)** で統一。フォーマット: `YYYY-MM-DDTHH:mm:ss.sss+09:00`

```typescript
// packages/db/src/utils.ts
function jstNow(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60_000);
  return jst.toISOString().slice(0, -1) + '+09:00';
}
```

## ステルス設計

LINE Harness は全操作が通常のLINE公式アカウント使用に見えるように設計:

1. **ジッター配信**: ステップ配信の `next_delivery_at` に ±5分のランダムオフセット
2. **バッチ間遅延**: 一斉配信で500件ずつバッチ処理、バッチ間にステルス遅延
3. **メッセージバリエーション**: ゼロ幅文字挿入でバッチごとに微妙に異なるメッセージ
4. **レート制限**: 自主的に1000呼び出し/分に制限（LINE上限は100,000/分）
5. **1デプロイ=1アカウント**: アカウントごとに独立したWorkerデプロイ
