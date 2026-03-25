# 13. スコアリング (Scoring / Lead Scoring)

## 概要

スコアリング機能は、友だちの行動に基づいてスコア（点数）を自動的に加算・減算し、リードの関心度・エンゲージメントレベルを数値化する。高スコアの友だちに対して優先的にアプローチする、スコア閾値で自動アクションを実行するなどの運用が可能。

L社の「スコアリング」に相当する機能。

## アーキテクチャ

```
イベント発生（友だち追加、メッセージ受信、URLクリック等）
    ↓
イベントバス (event-bus.ts)
    ↓
processScoring() → scoring_rules テーブルから一致するルールを検索
    ↓
applyScoring() → friend_scores に記録 + friends.score を更新
```

スコアリングはイベントバス経由で自動実行される。手動でのスコア加算APIも提供。

## データモデル

### scoring_rules テーブル

```sql
CREATE TABLE scoring_rules (
  id TEXT PRIMARY KEY,           -- UUID
  name TEXT NOT NULL,            -- ルール名（例: 「URLクリック」）
  event_type TEXT NOT NULL,      -- トリガーイベントタイプ
  score_value INTEGER NOT NULL,  -- 加算スコア（負数も可能）
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### friend_scores テーブル（スコア履歴）

```sql
CREATE TABLE friend_scores (
  id TEXT PRIMARY KEY,                                            -- UUID
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  scoring_rule_id TEXT REFERENCES scoring_rules (id) ON DELETE SET NULL,
  score_change INTEGER NOT NULL,    -- 加算/減算値
  reason TEXT,                       -- 理由テキスト
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_friend_scores_friend ON friend_scores (friend_id);
CREATE INDEX idx_friend_scores_created ON friend_scores (created_at);
```

### friends.score カラム（キャッシュ）

```sql
-- friendsテーブルにスコアキャッシュ列が追加されている
ALTER TABLE friends ADD COLUMN score INTEGER NOT NULL DEFAULT 0;
```

`friends.score` は `friend_scores` の合計値のキャッシュ。スコア加算時にリアルタイムで更新される。

## イベントタイプ

スコアリングルールの `event_type` に設定可能な値:

| event_type | 発生タイミング | 推奨スコア |
|---|---|---|
| `friend_add` | 友だち追加時 | +5 |
| `message_received` | ユーザーからメッセージ受信 | +3 |
| `url_click` | トラッキングリンクのクリック | +10 |
| `form_submit` | フォーム送信 | +20 |
| `tag_added` | タグ付与時 | +5 |
| `tag_change` | タグ変更時 | 条件次第 |
| `cv_fire` | コンバージョン発生 | +50 |
| `purchase` | 購入完了 | +100 |
| `calendar_booked` | カレンダー予約 | +30 |
| `score_threshold` | スコア閾値到達 | - |
| `incoming_webhook.*` | 外部Webhook受信 | 条件次第 |

これらはイベントバスの `fireEvent` で発火されるイベントタイプと一致する。

## スコアリングの自動実行

イベントバス内の `processScoring` 関数がイベント発生時に自動実行される:

```typescript
// event-bus.ts 内のロジック
async function processScoring(db, eventType, payload) {
  if (!payload.friendId) return;
  await applyScoring(db, payload.friendId, eventType);
}

// scoring.ts 内のロジック
async function applyScoring(db, friendId, eventType) {
  // 1. event_typeが一致するアクティブなルールを全取得
  const rules = await getActiveRulesByEvent(db, eventType);
  // 2. 各ルールについてスコアを加算
  for (const rule of rules) {
    await addScore(db, {
      friendId,
      scoringRuleId: rule.id,
      scoreChange: rule.score_value,
      reason: `${eventType} → ${rule.name}`,
    });
  }
}
```

### addScore の内部処理

```typescript
async function addScore(db, input) {
  // 1. friend_scores に履歴レコードを追加
  await db.prepare(`INSERT INTO friend_scores (...) VALUES (...)`)
    .bind(id, input.friendId, input.scoringRuleId, input.scoreChange, input.reason, now).run();

  // 2. friends.score キャッシュを更新
  await db.prepare(`UPDATE friends SET score = score + ?, updated_at = ? WHERE id = ?`)
    .bind(input.scoreChange, now, input.friendId).run();
}
```

## スコア閾値アクション

オートメーション機能（14-Automation.md参照）と組み合わせて、スコアが閾値に達した時にアクションを実行できる:

```json
{
  "eventType": "score_threshold",
  "conditions": { "score_threshold": 100 },
  "actions": [
    { "type": "add_tag", "params": { "tagId": "hot-lead-tag-uuid" } },
    { "type": "send_message", "params": { "content": "特別オファーをご用意しました！", "messageType": "text" } }
  ]
}
```

---

## APIエンドポイント

### スコアリングルール一覧取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/scoring-rules" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": [
    {
      "id": "rule-uuid-1",
      "name": "友だち追加ボーナス",
      "eventType": "friend_add",
      "scoreValue": 5,
      "isActive": true,
      "createdAt": "2026-03-20T10:00:00.000",
      "updatedAt": "2026-03-20T10:00:00.000"
    },
    {
      "id": "rule-uuid-2",
      "name": "URLクリック",
      "eventType": "url_click",
      "scoreValue": 10,
      "isActive": true,
      "createdAt": "2026-03-20T10:05:00.000",
      "updatedAt": "2026-03-20T10:05:00.000"
    },
    {
      "id": "rule-uuid-3",
      "name": "フォーム送信",
      "eventType": "form_submit",
      "scoreValue": 20,
      "isActive": true,
      "createdAt": "2026-03-20T10:10:00.000",
      "updatedAt": "2026-03-20T10:10:00.000"
    }
  ]
}
```

### スコアリングルール詳細取得

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/scoring-rules/RULE_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": {
    "id": "rule-uuid-1",
    "name": "友だち追加ボーナス",
    "eventType": "friend_add",
    "scoreValue": 5,
    "isActive": true,
    "createdAt": "2026-03-20T10:00:00.000"
  }
}
```

### スコアリングルール作成

```bash
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/scoring-rules" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "メッセージ返信",
    "eventType": "message_received",
    "scoreValue": 3
  }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "id": "new-rule-uuid",
    "name": "メッセージ返信",
    "eventType": "message_received",
    "scoreValue": 3
  }
}
```

### スコアリングルール更新

```bash
curl -X PUT "https://line-crm-worker.line-crm-api.workers.dev/api/scoring-rules/RULE_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "scoreValue": 15, "isActive": true }'
```

**レスポンス:**

```json
{
  "success": true,
  "data": {
    "id": "RULE_UUID",
    "name": "URLクリック",
    "eventType": "url_click",
    "scoreValue": 15,
    "isActive": true
  }
}
```

### スコアリングルール削除

```bash
curl -X DELETE "https://line-crm-worker.line-crm-api.workers.dev/api/scoring-rules/RULE_UUID" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 友だちのスコア取得（現在値+履歴）

```bash
curl -X GET "https://line-crm-worker.line-crm-api.workers.dev/api/friends/FRIEND_UUID/score" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**レスポンス:**

```json
{
  "success": true,
  "data": {
    "friendId": "FRIEND_UUID",
    "currentScore": 38,
    "history": [
      {
        "id": "score-uuid-3",
        "scoringRuleId": "rule-uuid-3",
        "scoreChange": 20,
        "reason": "form_submit → フォーム送信",
        "createdAt": "2026-03-22T15:00:00.000"
      },
      {
        "id": "score-uuid-2",
        "scoringRuleId": "rule-uuid-2",
        "scoreChange": 10,
        "reason": "url_click → URLクリック",
        "createdAt": "2026-03-22T12:00:00.000"
      },
      {
        "id": "score-uuid-1",
        "scoringRuleId": null,
        "scoreChange": 5,
        "reason": "手動ボーナス: VIP候補",
        "createdAt": "2026-03-21T10:00:00.000"
      },
      {
        "id": "score-uuid-0",
        "scoringRuleId": "rule-uuid-1",
        "scoreChange": 3,
        "reason": "friend_add → 友だち追加ボーナス",
        "createdAt": "2026-03-20T08:00:00.000"
      }
    ]
  }
}
```

### 手動スコア加算/減算

```bash
# 加算
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/friends/FRIEND_UUID/score" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "scoreChange": 50, "reason": "セミナー参加ボーナス" }'

# 減算
curl -X POST "https://line-crm-worker.line-crm-api.workers.dev/api/friends/FRIEND_UUID/score" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "scoreChange": -10, "reason": "30日間未活動" }'
```

**レスポンス (201):**

```json
{
  "success": true,
  "data": {
    "friendId": "FRIEND_UUID",
    "currentScore": 88
  }
}
```

---

## 運用パターン

### パターン1: 基本スコアリングルール一式

```bash
KEY="YOUR_API_KEY"
BASE="https://line-crm-worker.line-crm-api.workers.dev"

# 友だち追加: +5
curl -X POST "$BASE/api/scoring-rules" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"友だち追加","eventType":"friend_add","scoreValue":5}'

# メッセージ返信: +3
curl -X POST "$BASE/api/scoring-rules" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"メッセージ返信","eventType":"message_received","scoreValue":3}'

# URLクリック: +10
curl -X POST "$BASE/api/scoring-rules" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"URLクリック","eventType":"url_click","scoreValue":10}'

# フォーム送信: +20
curl -X POST "$BASE/api/scoring-rules" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"フォーム送信","eventType":"form_submit","scoreValue":20}'

# 購入: +100
curl -X POST "$BASE/api/scoring-rules" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"購入完了","eventType":"purchase","scoreValue":100}'
```

### パターン2: ホットリード自動検出

オートメーション + スコアリングの組み合わせ（14-Automation.md参照）:

```bash
# スコア50以上で「ホットリード」タグを自動付与
curl -X POST "$BASE/api/automations" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ホットリード検出",
    "eventType": "score_threshold",
    "conditions": { "score_threshold": 50 },
    "actions": [
      { "type": "add_tag", "params": { "tagId": "HOT_LEAD_TAG_ID" } },
      { "type": "send_message", "params": { "content": "ありがとうございます！特別オファーをご用意しました。", "messageType": "text" } }
    ]
  }'
```

## ソースコード参照

- Worker APIルート: `apps/worker/src/routes/scoring.ts`
- DB クエリ: `packages/db/src/scoring.ts`
- イベントバス統合: `apps/worker/src/services/event-bus.ts` (`processScoring` 関数)
- マイグレーション: `packages/db/migrations/002_round3.sql` (111-138行目)
