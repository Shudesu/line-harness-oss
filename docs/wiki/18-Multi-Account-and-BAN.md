# 18. マルチアカウント管理 & BAN 検知

LINE公式アカウントの複数管理、UUID によるクロスアカウントリンキング、BAN 検知・アカウント移行の完全リファレンス。

---

## アーキテクチャ概要

```
[LINE アカウント A] --friends--> [friends テーブル]
                                      |
                                      v
                              [users テーブル] <-- UUID でクロスリンク
                                      ^
                                      |
[LINE アカウント B] --friends--> [friends テーブル]

[Cron (5分毎)] --> checkAccountHealth() --> account_health_logs
                                              |
                                              v (danger 検出)
                                      [アカウント移行開始]
                                              |
                                              v
                                      account_migrations
```

---

## LINE アカウント管理 (Multi-Account)

### データモデル (line_accounts テーブル)

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| channel_id | TEXT UNIQUE NOT NULL | LINE チャネルID |
| name | TEXT NOT NULL | アカウント名 (表示用) |
| channel_access_token | TEXT NOT NULL | チャネルアクセストークン |
| channel_secret | TEXT NOT NULL | チャネルシークレット |
| is_active | INTEGER DEFAULT 1 | 有効フラグ |
| created_at, updated_at | TEXT | JST タイムスタンプ |

### API エンドポイント

#### アカウント一覧取得

一覧レスポンスではセキュリティのため `channelAccessToken` と `channelSecret` を省略する。

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/line-accounts" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス:
```json
{
  "success": true,
  "data": [
    {
      "id": "acc-uuid",
      "channelId": "1234567890",
      "name": "メインアカウント",
      "isActive": true,
      "createdAt": "2026-03-20T10:00:00.000+09:00",
      "updatedAt": "2026-03-20T10:00:00.000+09:00"
    }
  ]
}
```

#### アカウント詳細取得 (シークレット含む)

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/line-accounts/{id}" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンスには `channelAccessToken` と `channelSecret` が含まれる。

#### アカウント登録

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/line-accounts" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "1234567890",
    "name": "サブアカウント",
    "channelAccessToken": "token-here",
    "channelSecret": "secret-here"
  }'
```

全フィールド必須。

#### アカウント更新

```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/line-accounts/{id}" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "新アカウント名",
    "channelAccessToken": "new-token",
    "channelSecret": "new-secret",
    "isActive": false
  }'
```

全フィールドオプション。

#### アカウント削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/line-accounts/{id}" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## UUID クロスアカウントリンキング

### 概要

LINE の `line_user_id` はアカウントごとに異なるため、同一ユーザーが複数の公式アカウントを友だち追加しても、デフォルトでは紐付けができない。

LINE Harness では `users` テーブルを中間テーブルとして使用し、`friends.user_id` カラムで友だちをUUIDにリンクする。

### データモデル

```
users テーブル:
  id (UUID), email, phone, external_id, display_name

friends テーブル:
  id, line_user_id, user_id (→ users.id), ...
```

### リンク手順

1. ユーザー作成 (またはメール/電話で検索)
2. 友だちをユーザーにリンク

```bash
# 1. ユーザー作成
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/users" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "displayName": "田中太郎"}'

# 2. 友だちをリンク
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/users/{userId}/link" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"friendId": "friend-uuid"}'

# 3. UUID紐付き友だち一覧取得
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/users/{userId}/accounts" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### メール/電話でユーザー検索

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/users/match" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

メール → 電話の順で検索。見つからない場合は 404。

---

## アカウントヘルスモニタリング

### BAN 検知メカニズム

Cloudflare Workers の cron トリガー (`*/5 * * * *` = 5分毎) で `checkAccountHealth()` が実行される。

**検知ロジック:**

1. 全アクティブ LINE アカウントをループ
2. 各アカウントで `https://api.line.me/v2/bot/info` にリクエスト
3. レスポンスに基づきリスクレベルを判定:

| ステータス | リスクレベル | 意味 |
|-----------|-------------|------|
| 200 OK | `normal` | 正常 |
| 403 Forbidden | `danger` | BAN の可能性が高い |
| 429 Too Many Requests | `warning` | レート制限超過 |
| 直近1時間で5000通以上送信 | `warning` | 大量送信警告 |
| ネットワークエラー | error_code=0 として記録 | 接続失敗 |

4. `account_health_logs` テーブルに結果を記録
5. `danger` 検出時はコンソールにエラーログ出力

### データモデル (account_health_logs テーブル)

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| line_account_id | TEXT NOT NULL | LINE アカウントID |
| error_code | INTEGER | HTTP ステータスコード (0=ネットワークエラー) |
| error_count | INTEGER DEFAULT 0 | エラー回数 |
| check_period | TEXT | チェック時刻 |
| risk_level | TEXT | `normal` / `warning` / `danger` |
| created_at | TEXT | JST タイムスタンプ |

### ヘルス状態取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/accounts/{lineAccountId}/health" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

レスポンス:
```json
{
  "success": true,
  "data": {
    "lineAccountId": "acc-uuid",
    "riskLevel": "normal",
    "logs": [
      {
        "id": "log-uuid",
        "errorCode": null,
        "errorCount": 0,
        "checkPeriod": "2026-03-20T10:30:00.000+09:00",
        "riskLevel": "normal",
        "createdAt": "2026-03-20T10:30:00.000+09:00"
      }
    ]
  }
}
```

`riskLevel` は最新のログエントリから取得される。ログが存在しない場合は `normal`。

---

## アカウント移行

BAN 検出時に、友だちを新アカウントに移行するための仕組み。

### データモデル (account_migrations テーブル)

| カラム | 型 | 説明 |
|--------|------|------|
| id | TEXT PK | UUID |
| from_account_id | TEXT NOT NULL | 移行元アカウントID |
| to_account_id | TEXT NOT NULL | 移行先アカウントID |
| status | TEXT | `pending` / `in_progress` / `completed` / `failed` |
| migrated_count | INTEGER DEFAULT 0 | 移行済み数 |
| total_count | INTEGER DEFAULT 0 | 移行対象総数 |
| created_at | TEXT | 作成日時 |
| completed_at | TEXT | 完了日時 |

### 移行開始

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/accounts/{fromAccountId}/migrate" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"toAccountId": "new-account-uuid"}'
```

レスポンス (201):
```json
{
  "success": true,
  "data": {
    "id": "migration-uuid",
    "fromAccountId": "old-acc-uuid",
    "toAccountId": "new-acc-uuid",
    "status": "in_progress",
    "totalCount": 1500,
    "createdAt": "2026-03-20T10:30:00.000+09:00"
  }
}
```

**移行の仕組み:**
- `is_following=1` の全友だちを移行対象としてカウント
- 実際の移行は UUID ベース -- ユーザーが新アカウントを友だち追加した時に `users.id` で自動マッチされる
- ステータスは即座に `in_progress` に更新

### 移行一覧取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/accounts/migrations" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 移行詳細取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/accounts/migrations/{migrationId}" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## ステルスモード機能

BAN を防ぐための送信パターン最適化。`apps/worker/src/services/stealth.ts` に実装。

### 機能一覧

#### 1. ジッター付きディレイ

```typescript
addJitter(baseMs: number, jitterRangeMs: number): number
// 例: addJitter(1000, 500) => 1000 + random(0, 500) ms
```

#### 2. メッセージバリエーション

一斉配信時に各メッセージにゼロ幅文字を挿入して、同一メッセージの大量送信を回避:
- `\u200B` (zero-width space)
- `\u200C` (zero-width non-joiner)
- `\u200D` (zero-width joiner)
- `\uFEFF` (zero-width no-break space)

```typescript
addMessageVariation(text: string, index: number): string
```

#### 3. スタッガードディレイ

送信規模に応じて配信を時間分散:
- 100通以下: 100ms + jitter(500ms)
- 1000通以下: 2分間に分散
- 1000通超: 5分間に分散

```typescript
calculateStaggerDelay(totalMessages: number, batchIndex: number): number
```

#### 4. ステップ配信ジッター

シナリオのステップ配信時刻に -5分 ~ +5分 のランダムオフセットを追加:

```typescript
jitterDeliveryTime(scheduledAt: Date): Date
```

#### 5. レート制限

```typescript
const limiter = new StealthRateLimiter(1000, 60_000);
// 1分あたり最大1000コール
await limiter.waitForSlot();
```

LINE API のレート制限は 100,000 msg/min だが、安全マージンとして 1,000/min に制限。

---

## BAN 防止ベストプラクティス

1. **大量配信は時間分散** -- `calculateStaggerDelay` が自動で適用される
2. **メッセージバリエーション** -- 一斉配信では `addMessageVariation` が自動適用
3. **5分毎のヘルスチェック** -- `danger` 検出時は即座に送信を停止
4. **アカウント分散** -- 複数 LINE アカウントで負荷分散
5. **レート制限の遵守** -- `StealthRateLimiter` で API コール数を制限
6. **403 エラー即応** -- BAN の兆候を早期発見し、アカウント移行を開始
7. **友だち追加直後の大量送信回避** -- シナリオのディレイ設定を活用
8. **Webhook 通知設定** -- `danger` 検出時に外部通知を送る自動化ルールを設定

---

## 環境変数

| 変数名 | 用途 | 設定方法 |
|--------|------|----------|
| LINE_CHANNEL_ACCESS_TOKEN | メインアカウントのトークン | `wrangler secret put` |
| LINE_CHANNEL_SECRET | メインアカウントのシークレット | `wrangler secret put` |
| API_KEY | API 認証キー | `wrangler secret put` |

追加アカウントは `line_accounts` テーブルに格納し、DB から動的に読み込む。
