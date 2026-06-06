# hyhome Harness 運用ランブック

> 「困った時にここを見れば最短で復旧できる」を目指したシステマチックなドキュメント。
> 2026-06-07 作成・以後 Phase 追加ごとに更新。

## 環境サマリ

| 項目 | 値 |
|---|---|
| 本番ドメイン (admin) | https://hyhome-harness-admin-0cdf2440.pages.dev |
| 本番ドメイン (worker) | https://hyhome-harness.kashiyu-mina-iezukurisoudan.workers.dev |
| LIFF | https://hyhome-harness-liff.pages.dev |
| Cloudflare account | Kashiyu (`3048ba5bd6789dbf21204b466fbf4c8b`) |
| D1 database | `hyhome-harness` (`02e337a1-5fd3-426b-ba6d-d2f9085c20da`) |
| GitHub | https://github.com/maedayasao-tech/line-harness-oss (fork) |
| LINE 公式 | `@qNG7n2` (みな｜家づくり相談窓口) |

## デプロイ

### Worker (API) のデプロイ

```bash
cd ~/hyhome/ads/line/harness/fork/apps/worker
pnpm run build
pnpm exec wrangler deploy --config wrangler-prod.toml
```

### Admin (apps/web) のデプロイ

```bash
cd ~/hyhome/ads/line/harness/fork/apps/web
pnpm run build
CLOUDFLARE_ACCOUNT_ID=3048ba5bd6789dbf21204b466fbf4c8b \
  pnpm exec wrangler pages deploy out \
  --project-name=hyhome-harness-admin-0cdf2440 --branch=main
```

### D1 マイグレーション

新規 migration 追加時：

```bash
cd ~/hyhome/ads/line/harness/fork/apps/worker
pnpm exec wrangler d1 execute hyhome-harness --remote \
  --file=../../packages/db/migrations/0XX_xxx.sql \
  --config wrangler-prod.toml
```

確認 (適用済 migration 一覧):

```bash
pnpm exec wrangler d1 execute hyhome-harness --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" \
  --config wrangler-prod.toml
```

## Worker secrets 管理

| Secret 名 | 用途 | 設定方法 |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API push (フォールバック) | `wrangler secret put` |
| `LINE_CHANNEL_SECRET` | LINE webhook 署名検証 | 同上 |
| `API_KEY` | admin から worker への認証 | 同上 |
| `LARK_APP_ID` | Phase 3-F1 Lark 通知 (任意) | 同上 |
| `LARK_APP_SECRET` | 同上 | 同上 |
| `LINE_TOKEN_ENC_KEY` | Phase 1-G トークン暗号化 (任意・ベータ) | `openssl rand -base64 32` で生成 |
| `META_*` | Meta CAPI 連携 | 同上 |
| `CF_API_TOKEN` | Phase 5 self-update (現在使ってない) | 同上 |

例:

```bash
cd ~/hyhome/ads/line/harness/fork/apps/worker
pnpm exec wrangler secret put LARK_APP_ID --config wrangler-prod.toml
# プロンプトに値を入力 (チャットに貼り付けない)
```

## トラブルシュート

### 友だち追加されたのに何も起きない

1. **webhook URL が正しいか確認**
   - LINE Developers Console → Messaging API → Webhook URL
   - 期待値: `https://hyhome-harness.kashiyu-mina-iezukurisoudan.workers.dev/webhook`
2. **Worker のログを見る**

   ```bash
   cd ~/hyhome/ads/line/harness/fork/apps/worker
   pnpm exec wrangler tail --config wrangler-prod.toml
   ```
3. **friends テーブルにレコードが入っているか**

   ```bash
   pnpm exec wrangler d1 execute hyhome-harness --remote \
     --command="SELECT COUNT(*) FROM friends WHERE created_at > datetime('now','-1 hour','+9 hours')" \
     --config wrangler-prod.toml
   ```
4. **CRM forward (外部CRM転送) が原因で遅延していないか** → /crm-forwards で確認

### あいさつメッセージが届かない

1. /greeting で本文が設定されているか確認 (空欄なら LINE 公式のあいさつが使われる)
2. friend に referralRoute が付いている場合は entry_routes 側の intro_template_id が使われる
3. Worker tail でログ `[follow] default greeting sent friend=...` が出ているか確認

### Lark に通知が来ない

1. `/lark-notifications` 画面で「✅ Lark 認証 OK」が出るか確認
2. 出ていない場合は `LARK_APP_ID` / `LARK_APP_SECRET` secrets を再設定
3. 通知設定の「テスト送信」で疎通確認
4. 送信先 (chat_id) に Bot がメンバーで入っているか Lark 側で確認

### fingerprint の保存量が想定より多い

1. `/fingerprint-policy` で「保存中の件数」を確認
2. 「いますぐ古いデータを削除」で即時実行
3. 自動削除は 6h cron で動作

### CRM forward が止まっている (エルメに転送されない)

1. `/crm-forwards` 画面でステータスを確認 (有効/無効、最近のログ)
2. 無効化されていれば有効化
3. ログにエラーが出ている場合は webhook URL が正しいか確認

### Worker のレート制限/エラー多発

1. `pnpm exec wrangler tail` でリアルタイムログ
2. /health で BAN 検知の最新ステータスを確認
3. /emergency で緊急停止可能

## 定期メンテナンス

| 頻度 | 内容 |
|---|---|
| 毎日 | (自動) fingerprint データ 6h cron で古いものクリア |
| 毎週 | /chats で未対応会話を確認 |
| 毎月 | 月初に LINE_CHANNEL_ACCESS_TOKEN の有効期限確認 (token-refresh が自動更新するが念のため) |
| 半年 | LARK_APP_SECRET / API_KEY のローテーション検討 |

## 監査ログの場所

| 種類 | 場所 |
|---|---|
| 友だちイベント | `friends`, `messages_log` テーブル |
| CRM forward 履歴 | `crm_forward_logs` テーブル |
| Lark 通知履歴 | `lark_notification_logs` テーブル |
| fingerprint 削除履歴 | `fingerprint_retention_audit` テーブル |
| Worker 実行ログ | Cloudflare Dashboard → Workers → ログ (1週間保持) |

## バックアップ・リストア

### D1 のフルダンプ

```bash
cd ~/hyhome/ads/line/harness/fork/apps/worker
pnpm exec wrangler d1 export hyhome-harness --remote \
  --output=backup-$(date +%Y%m%d).sql --config wrangler-prod.toml
```

dump ファイルは秘密情報を含むため、コミットしないこと。

### リストア

新規 D1 を作って `--file=backup-*.sql` で execute。

## 上流 (Shudesu/line-harness-oss) 追従

月次でチェック：

```bash
cd ~/hyhome/ads/line/harness/fork
git fetch upstream
git log --oneline main..upstream/main | head -30
```

セキュリティ修正 (CVE 等) を含む commit があれば cherry-pick または手動マージ。
日常の機能追加は ack のみで取り込まない (独自カスタマイズと衝突するため)。

## オンコール時の判断早見表

| 症状 | 1分以内のアクション |
|---|---|
| LINE に push されない (全体) | `/emergency` で緊急停止 → wrangler tail で原因確認 |
| 友だち情報が表示されない | admin の Cloudflare Pages デプロイ状況確認 |
| 特定アカウントだけ動かない | `/accounts` で該当アカウントの is_active と channel_secret 確認 |
| webhook 署名検証エラー多発 | LINE Developers Console で channel_secret 変わってないか確認 |
| エルメから移行中の友だち情報が二重 | `/crm-forwards` を一時停止 → 移行ポリシー再検討 |

## 連絡先

- Shudesu (本家) Issue: https://github.com/Shudesu/line-harness-oss/issues
- Cloudflare サポート: dashboard 経由
- LINE 公式アカウント連絡: LYC Biz manager
