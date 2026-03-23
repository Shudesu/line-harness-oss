# 22. 運用ガイド

LINE Harness の日常運用、監視、バックアップ、トラブルシューティングの完全ガイド。

---

## 日常モニタリングチェックリスト

### 毎日確認すべき項目

- [ ] **アカウントヘルス**: `/api/accounts/{id}/health` で riskLevel が `normal` であること
- [ ] **未読チャット**: `/api/chats?status=unread` で放置されている問い合わせがないこと
- [ ] **配信状態**: `/api/broadcasts` で `sending` のまま止まっている配信がないこと
- [ ] **自動化ログ**: `/api/automations/{id}/logs` で `failed` ステータスがないこと
- [ ] **通知**: `/api/notifications?status=failed` で未送信通知がないこと

### 週次確認

- [ ] **CV レポート**: `/api/conversions/report` でコンバージョン推移を確認
- [ ] **アフィリエイトレポート**: `/api/affiliates-report` でパフォーマンス確認
- [ ] **スコア分布**: 高スコア友だちのフォローアップ
- [ ] **D1 ストレージ使用量**: Cloudflare Dashboard で確認 (5GB 制限)

### モニタリング curl コマンド

```bash
API="https://your-worker.your-subdomain.workers.dev"
KEY="YOUR_API_KEY"

# アカウントヘルスチェック
curl -s -H "Authorization: Bearer $KEY" "$API/api/accounts/{lineAccountId}/health" | jq '.data.riskLevel'

# 友だち総数
curl -s -H "Authorization: Bearer $KEY" "$API/api/friends/count" | jq '.data.count'

# 未読チャット数
curl -s -H "Authorization: Bearer $KEY" "$API/api/chats?status=unread" | jq '.data | length'

# 今週の CV
curl -s -H "Authorization: Bearer $KEY" "$API/api/conversions/report?startDate=$(date -v-7d +%Y-%m-%d)" | jq '.data'

# 失敗した自動化ログ
curl -s -H "Authorization: Bearer $KEY" "$API/api/notifications?status=failed&limit=10" | jq '.data'
```

---

## アカウントヘルスモニタリング

### 自動チェック (Cron)

5分毎に `checkAccountHealth()` が実行され、以下を行う:
1. 全アクティブ LINE アカウントの LINE API へヘルスチェック
2. `account_health_logs` テーブルに結果を記録
3. `danger` 検出時にコンソールログ出力

### リスクレベル対応フロー

| レベル | 意味 | 対応 |
|--------|------|------|
| `normal` | 正常 | 対応不要 |
| `warning` | レート制限 or 大量送信 | 送信頻度を下げる、配信間隔を広げる |
| `danger` | BAN の可能性 (403) | 即座に確認、必要に応じてアカウント移行開始 |

### アラート自動化の設定例

```bash
# danger 検出時にSlack通知する自動化ルール
curl -X POST "$API/api/automations" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "BAN検知アラート",
    "eventType": "health_check",
    "conditions": {"riskLevel": "danger"},
    "actions": [
      {"type": "send_notification", "channel": "webhook", "url": "https://hooks.slack.com/..."}
    ]
  }'
```

---

## バックアップ戦略

### D1 データベースエクスポート

Cloudflare D1 はマネージドサービスのため、自動バックアップは Cloudflare 側で管理される。手動エクスポートは以下の方法で行う:

```bash
# テーブル単位でエクスポート
wrangler d1 execute line-crm --command "SELECT * FROM friends" --json > friends_backup.json
wrangler d1 execute line-crm --command "SELECT * FROM tags" --json > tags_backup.json
wrangler d1 execute line-crm --command "SELECT * FROM scenarios" --json > scenarios_backup.json
wrangler d1 execute line-crm --command "SELECT * FROM scenario_steps" --json > scenario_steps_backup.json
wrangler d1 execute line-crm --command "SELECT * FROM broadcasts" --json > broadcasts_backup.json
wrangler d1 execute line-crm --command "SELECT * FROM friend_tags" --json > friend_tags_backup.json
wrangler d1 execute line-crm --command "SELECT * FROM conversion_events" --json > conversion_events_backup.json
```

### バックアップスクリプト例

```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
BACKUP_DIR="backups/$DATE"
mkdir -p "$BACKUP_DIR"

TABLES=(friends tags scenarios scenario_steps broadcasts friend_tags friend_scenarios messages_log conversion_points conversion_events affiliates affiliate_clicks users line_accounts)

for TABLE in "${TABLES[@]}"; do
  wrangler d1 execute line-crm --command "SELECT * FROM $TABLE" --json > "$BACKUP_DIR/$TABLE.json"
done

echo "Backup completed: $BACKUP_DIR"
```

### リストア

```bash
# schema.sql で空テーブル作成
wrangler d1 execute line-crm --file=packages/db/schema.sql

# JSON からデータ復元（手動 INSERT が必要）
```

---

## スケーリング考慮事項

### D1 の制限

| 項目 | 制限 |
|------|------|
| DB サイズ | 2GB (Free) / 10GB (Paid) |
| 読み取り | 5M/日 (Free) / 25B/月 (Paid) |
| 書き込み | 100K/日 (Free) / 50M/月 (Paid) |
| 最大行サイズ | 1MB |
| 最大テーブル数 | 無制限 |

### ボトルネック対策

1. **messages_log の肥大化**: 古いログの定期削除
   ```sql
   DELETE FROM messages_log WHERE created_at < date('now', '-90 days')
   ```

2. **friend_scores の肥大化**: 古いスコア履歴の削除
   ```sql
   DELETE FROM friend_scores WHERE created_at < date('now', '-180 days')
   ```

3. **account_health_logs の肥大化**: 古いヘルスログの削除
   ```sql
   DELETE FROM account_health_logs WHERE created_at < date('now', '-30 days')
   ```

4. **automation_logs の肥大化**: 古い自動化ログの削除
   ```sql
   DELETE FROM automation_logs WHERE created_at < date('now', '-60 days')
   ```

### Cron 実行の負荷

5分毎のCronで4つの処理が並列実行される:
- `processStepDeliveries` -- シナリオステップ配信
- `processScheduledBroadcasts` -- 予約配信
- `processReminderDeliveries` -- リマインダー配信
- `checkAccountHealth` -- ヘルスチェック

友だち数が増えるとステップ配信の処理時間が増加する。Cloudflare Workers の実行時間制限 (30秒 / 無制限 with Cron) に注意。

---

## セキュリティベストプラクティス

### API キーローテーション

```bash
# 1. 新しい API キーを生成
NEW_KEY=$(openssl rand -hex 32)

# 2. Worker に設定
wrangler secret put API_KEY
# => 新しいキーを入力

# 3. SDK クライアント側のキーを更新
# LineHarness({ apiKey: NEW_KEY })
```

### 管理パネル認証

`admin_users` テーブルでパスワードハッシュベースの認証を管理。

### API アクセスの原則

- API キーは1つのサービスにつき1つ
- 管理パネル用と外部連携用でキーを分ける (将来の拡張)
- CORS は現在 `*` (MVP) -- 本番では適切なオリジンに制限推奨

### 機密データの取り扱い

- `channelAccessToken`, `channelSecret` は DB に保存される (line_accounts テーブル)
- 一覧 API ではシークレットを省略 (詳細 API のみ返す)
- Stripe のシークレットは環境変数のみ

---

## トラブルシューティング

### よくある問題と対処法

#### 1. Webhook が反応しない

```bash
# LINE Webhook URL が正しいか確認
# LINE Developers Console > Messaging API > Webhook URL
# => https://your-worker.your-subdomain.workers.dev/webhook

# Webhook の検証
curl -X POST "https://your-worker.your-subdomain.workers.dev/webhook" \
  -H "Content-Type: application/json" \
  -d '{"events":[]}'
# => 200 OK が返ればルーティングは正常
```

#### 2. 配信が実行されない

- `broadcasts` テーブルの `status` を確認 -- `scheduled` のまま止まっている場合は cron が動いていない
- Cloudflare Dashboard > Workers > Cron Triggers で cron の実行状態を確認
- `sending` のまま止まっている場合は LINE API エラー -- ヘルスチェックを確認

#### 3. シナリオステップが配信されない

- `friend_scenarios` テーブルの `status` が `active` であること
- `next_delivery_at` が過去の日時であること
- cron が正常に実行されていること

#### 4. 401 Unauthorized エラー

```bash
# API キーが正しいか確認
curl -v -H "Authorization: Bearer YOUR_KEY" \
  https://your-worker.your-subdomain.workers.dev/api/friends/count
```

#### 5. D1 ストレージ上限

```bash
# テーブルサイズ確認
wrangler d1 execute line-crm --command "
  SELECT name,
    (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=m.name) as row_count
  FROM sqlite_master m
  WHERE type='table'
  ORDER BY name"
```

---

## ログ分析

### Cloudflare Workers ログ

```bash
# リアルタイムログ
wrangler tail

# フィルタ付き
wrangler tail --format=json | jq 'select(.logs[].message | contains("error"))'
```

### アプリケーションログ

全てのルートハンドラーは `console.error` でエラーをログ出力する。フォーマット:
```
{METHOD} {PATH} error: {Error details}
```

### 自動化ログ

```bash
# 特定の自動化ルールの実行ログ
curl -s -H "Authorization: Bearer $KEY" \
  "$API/api/automations/{automationId}/logs?limit=50" | jq '.data'
```

---

## パフォーマンス最適化

### クエリ最適化

D1 のインデックスは schema.sql で適切に設定済み:
- `idx_friends_line_user_id` -- Webhook 受信時の友だち検索
- `idx_friend_scenarios_next_delivery_at` -- ステップ配信のスケジュール検索
- `idx_messages_log_created_at` -- メッセージログの時系列検索
- `idx_conversion_events_affiliate` -- アフィリエイトレポートの集計

### 送信の最適化

- ステルスモードが自動的に送信を最適化 (ジッター、バリエーション、レート制限)
- 一斉配信は500件単位でバッチ処理
- 大量配信時は自動的に5分間に分散

### レスポンスキャッシュ

現在は全レスポンスがキャッシュなし。将来的には以下のキャッシュ戦略を検討:
- タグ一覧: 60秒キャッシュ
- テンプレート一覧: 300秒キャッシュ
- CV レポート: 60秒キャッシュ
