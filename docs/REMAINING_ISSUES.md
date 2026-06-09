# hyhome harness 残課題台帳

> 7 並列適性監査 (2026-06-07) で発見された全課題を **優先度順** で記録。
> 「使ってない状態のうちに、エラーがなくなるまで何回も潰す」方針の作業台帳。

最終更新: 2026-06-07
状態: 今夜の修正 76+ 件は実装済、追加 25+ 件の致命傷修正済、本番デプロイは保留中

## 凡例

- 🔴 **P1**: 本番で確実に発火する致命傷。次のラウンドで最優先
- 🟡 **P2**: 条件揃えば発火、運用にじわじわ影響
- 🟢 **P3**: 気持ち悪いだけ、将来の負債

---

## 🔴 P1: 構造的なので migration / 設計再考が必要

### 1. multi-account friends UNIQUE 問題

- **症状**: 同じ LINE user が account A と account B 両方を follow すると `friends` 行が collapse。後の follow が前の follow を上書き、A 経由の scenario・配信が消える
- **根本原因**: `friends.line_user_id` に単一 UNIQUE。`upsertFriend` が `line_user_id` 単一を冪等キー
- **対応**:
  1. migration: 旧 friends を rebuild、新 UNIQUE `(line_user_id, line_account_id)`
  2. `upsertFriend(lineUserId, lineAccountId)` 必須化
  3. 全 caller (~50 箇所) に lineAccountId 追加
  4. fallback マイグレーション: 既存 NULL 行を最有力 account にひも付け、または明示で「unknown」アカウントへ
- **工数**: 半日〜1日 (caller の Edit 量が多い)
- **影響面**: 全ホットパス

### 2. broadcast 永久 stuck 問題

- **症状**: Worker eviction が batch 完了直後に起きると `batch_offset = -1` のまま `success_count > 0`。`recoverStalledBroadcasts` は `success_count = 0` のみ対象にしているため**永久に救済されず手動 DB 修正が必要**
- **根本原因**: batch 完了ごとに `batch_offset` を永続化していない、resume 設計が tag/segment broadcast で欠落
- **対応**:
  1. 各 batch 成功直後に `UPDATE broadcasts SET batch_offset = ?, success_count = ?` を atomic に
  2. `recoverStalledBroadcasts` の tag/segment 経路から `success_count = 0` 制約を撤廃
  3. `processQueuedBroadcastBatches` 入口で `batch_offset >= 0` の row も lock 対象に
- **工数**: 半日

### 3. line_accounts 削除 cascade と FK 欠落

- **症状**: D1 default で foreign_keys=OFF。`messages_log` / `scenarios` / `broadcasts` / `reminders` / `automations` / `chats` / `auto_replies` / `account_settings` の `line_account_id` が dangling 化。レポート集計が静かにズレる
- **対応**:
  1. `PRAGMA foreign_keys = ON` を D1 init で発行する `db-pragma.ts` を追加
  2. `deleteLineAccount` を soft delete (`deleted_at`) に変更
  3. 既存 dangling 行を `SELECT line_account_id, COUNT(*) FROM messages_log WHERE line_account_id NOT IN (SELECT id FROM line_accounts)` でクリーンアップ
- **工数**: 半日

### 4. messages_log / crm_forward_logs / link_clicks の retention 未設定

- **症状**: 全部無限増殖。`pruneCrmForwardLogs` は実装ありで未配線。`messages_log` は数ヶ月で 50万行突破 (本人コメントで「30s 超」観測済)。`link_clicks` の未マッチ click は永久残存
- **対応**:
  1. 6h cron tick に `pruneCrmForwardLogs` を追加 (1 行 fix)
  2. `messages_log` の retention 列を account_settings に。default 180日
  3. `link_clicks` で `friend_id IS NULL AND clicked_at < -1 year` を DELETE
- **工数**: 半日

### 5. /api/forms/:id/submit が認証なしで friendId 信頼

- **症状**: 攻撃者が curl で任意の friendId・任意の form に対して `metadata` 上書き / tag 付与 / scenario enroll / Lark 通知発火が可能
- **対応**:
  1. LIFF ID token (`liff.getIDToken()`) を body 必須に
  2. server 側で LINE Login Channel ID で audience 検証
  3. friendId は ID token の `sub` から逆引き、body 値は無視
  4. form の `line_account_id` と friend の `line_account_id` 整合検証
  5. `callFormWebhook` の URL を allow-list 化、private IP / metadata IP deny (SSRF)
- **工数**: 半日

### 6. cron mutex の 6h ジョブ skip

- **症状**: 00:00/06:00/12:00/18:00 JST に `*/5` と `0 */6` の dual-fire → 5min isolate が勝つと `if (event.cron === '0 */6 * * *')` ガードを通れず booking-expirer / event-booking-expirer / fingerprint-purger が**実行されない**
- **対応**: `event.cron` 文字列ガードを廃止、`cron_jobs(job_name, last_run_at)` テーブルで「前回実行から N 時間経ったか」判定方式へ
- **工数**: 半日

### 7. APNs テナント越境ファンアウト

- **症状**: `getDeviceTokensForAccount` が `lineAccountId` を捨てて全 active iOS token に送る。マルチテナント PII 漏洩 (GDPR 級)
- **状態**: 今夜 `APNS_ENABLED` 環境変数で OFF にしたが、根本治療していない
- **対応**:
  1. `staff_members` (または `staff_account_access`) に `line_account_id` カラム/JOIN を追加
  2. `device_tokens.staff_id` JOIN で account 絞り込み
  3. notification_preferences を将来導入
- **工数**: 1日

---

## 🟡 P2: 運用で踏むがすぐ詰まない

### 8. crm_forward_queue の partial-failure 計上

- bulk-tag の `succeeded += chunk.length` は `INSERT OR IGNORE` の skip 分を過大計上。`result.meta.changes` で実 INSERT 数を集計すべき
- **工数**: 半日

### 9. broadcasts `status` CHECK 制約に 'failed' / 'cancelled' 無し

- partial-failure で `status='draft'` に巻き戻し → `success_count` リセットせず → 再送で double-count
- migration で CHECK 制約に `failed`, `cancelled` 追加 + 再送時の reset 強制
- **工数**: 半日

### 10. line_accounts 平文保存される secrets

- Phase 1-G は `channel_access_token` のみ暗号化。`channel_secret` / `login_channel_secret` / `staff_members.api_key` / `incoming_webhooks.secret` / `outgoing_webhooks.secret` / `google_calendar_connections.*` / `external_events.hmac_secret` 全部平文
- 全体を `enc1:` 形式に揃える migration + bulkEncrypt 拡張
- **工数**: 1日

### 11. `friends.metadata` schema drift / key 旧残

- `meet_hearing` 等の機能停止後も古いキーが永久残存。`expandVariables` が古いキー値を配信に使い込む
- metadata key の whitelist 管理 + backfill migration
- **工数**: 半日

### 12. datetime 形式 4 種混在

- `jstNow()` (+09:00 付き) / `strftime(...)` / `datetime('now', '+9 hours')` (JST naive space) / `datetime('now')` (UTC naive)
- migration 069 で `created_at`/`updated_at` 全部 `jstNow()` 形式に backfill
- `meet-callback.ts:193` の UTC `updated_at` 直書きを修正
- **工数**: 半日

### 13. `friends.line_account_id IS NULL` の legacy 救済が境界判定に穴

- 今夜の互換モードで `/api/friends/:id` 等が `(line_account_id = ? OR line_account_id IS NULL)` の OR 経路を残した。UI 側の `lineAccountId` 必須化完了後に厳密化に戻す
- **工数**: 1h (UI 側追従後)

### 14. Stripe purchase の friend_id 不在で副作用 silent skip

- `metadata.line_friend_id` 注入運用が決まってないと、購入完了で何も発火しない
- `stripe_customer_id → friend_id` の fallback マッピングテーブル + 手動紐付け UI
- **工数**: 1日

### 15. APNs `pushToDevices` serial → 30s 超過

- 50 デバイス × 800ms = 40s。`Promise.allSettled` で並列化
- **工数**: 1h

### 16. retry-key と recoverStalledBroadcasts の TTL 不整合

- LINE retry-key TTL 1分 vs cron 5分 = 重複配信窓
- broadcast batch の persistent state に retry-key を格納し、resume 時は同じ key 再利用
- **工数**: 半日

### 17. profile-refresh / dedup-broadcast の env 透過 (今夜 1 周目で済)

- `apps/worker/src/routes/profile-refresh.ts` と `services/dedup-broadcast.ts` で resolveAccessToken 経由に修正済 ✅
- 次は **テストを追加** して将来のリグレッション防止

---

## 🟢 P3: 気持ち悪いだけ

### 18. `tsc --noEmit` 79 件のエラー (apps/worker: 75, mcp-server: 4)

- `c.req.param('id')` の `string | undefined` 問題 68 件
- `lark-client.ts` の `parsed: typeof parsed` バグ → 今夜修正済 ✅
- `Broadcast` interface の欠落カラム → `(broadcast as unknown as Record<string, unknown>).line_account_id` パターン 50 ヶ所
- 全部潰せば `as unknown as` ~70 件削減できる
- **工数**: 1日

### 19. dead code (未呼び出し export) 14 件

- `notifyLarkDailySummary`, `triggerApnsForFollowWebhookEvent`, `attachTagAndFireSideEffects`, `pruneCrmForwardLogs` (←P1#4 で配線したい), etc.
- 削除 or 配線
- **工数**: 半日

### 20. wrangler.toml と wrangler-prod.toml の役割整理

- 今夜 dev の `name = "hyhome-harness-dev"` に変更済 ✅
- 残: ENV 型から「機能別 readiness check」を返す `/api/health` 拡張
- **工数**: 半日

### 21. RUNBOOK の「migration 適用後の `_migrations` 同期」節追加

- 手動 apply と CI 適用の二重実行で `058/059/066` の DROP TABLE が再実行されると staff/log 消失リスク
- **工数**: 30 分

### 22. NEXT_PUBLIC_ADMIN_API_KEY のクライアント漏洩

- 今夜 update-client.ts から削除済 ✅、update banner は disable 済
- 残: self-update 経路を staff Bearer 経由に再設計
- **工数**: 1日

### 23. CSV エクスポートで Excel injection

- 先頭 `=` / `+` / `-` / `@` の友だち名で formula 注入
- `csvEscape` 冒頭で sanitize
- **工数**: 1h

### 24. その他フロントエンド負債

- 全モーダルで ESC で閉じれない
- 「保存中ナビゲーション」 警告なし
- 通知センターの polling guard なし
- 401 後の永久ループ (login redirect なし)
- **工数**: 1日

---

## Round 5 (2026-06-09) で対応済み一覧

| 修正 | 状態 |
|---|---|
| 構造的 P1 #1: multi-account friends UNIQUE 再設計 (migration 073 + caller 11 callsite) | ✅ |
| 構造的 P1 #5: /api/forms/:id/submit LIFF ID token 認証必須化 + SSRF guard | ✅ |
| 構造的 P1 #6: cron 6h ジョブ skip 解消 (cron_jobs テーブル + shouldRunSixHourJob/markCronJobRan) | ✅ |
| 構造的 P1 #7: APNs テナント治療 (staff_members.line_account_id + createStaff/updateStaff 対応) | ✅ |
| Codex 第二回指摘: forms auth skip 復帰 / cron helper 未定義 / forms friend lookup 厳密化 / form 境界検証 / _skipWebhook 無視 / migration 074 partial UNIQUE / SSRF IPv4-mapped IPv6 / schema.sql 追従 | ✅ |
| migration 番号衝突解消 (070 二重 → 073/074 にリネーム) | ✅ |
| pinned_friends 機能 (migration 070 + route) | ✅ (前夜 Codex 由来) |
| device_tokens 認可 (他人 token 削除防止) | ✅ (前夜 Codex 由来) |
| conversations.ts / rate-limit.ts 治療 | ✅ (前夜 Codex 由来) |

## Round 4 (2026-06-07) のラウンドで対応済み一覧

| 修正 | 状態 |
|---|---|
| webhook.ts:609 `c.env` 未定義 | ✅ |
| `/api/friends/:id` / `/api/inbox/unanswered` の互換モード | ✅ |
| 暗号化 token 復号漏れ 13 サイト (meet-callback, forms ×3, profile-refresh, liff ×6, rich-menu-groups ×8, dedup-broadcast) | ✅ |
| 暗号化 token 復号漏れ 追加4サイト (line-accounts:72, events:1059/1216, ban-monitor:64) ※Codex 指摘 | ✅ |
| APNs feature flag で OFF (テナント越境暫定対応) | ✅ |
| Stripe webhook fail-closed | ✅ |
| Lark client `parsed: typeof parsed` バグ | ✅ |
| wrangler.toml dev 化 (`name = "hyhome-harness-dev"`) | ✅ |
| RUNBOOK secret 表補完 | ✅ |
| `NEXT_PUBLIC_ADMIN_API_KEY` クライアント漏洩 | ✅ |
| update-client.ts disable | ✅ |
| crm-forward-retry の "forward disabled" 24h backoff | ✅ |
| UI 側 lineAccountId 伝播 (api.ts + 4 caller) | ✅ |
| tag broadcast の account 絞り込み追加 (越境送信防止) ※Codex 指摘 | ✅ |
| NULL 救済 (`OR line_account_id IS NULL`) 厳密化削除 ※Codex 指摘 | ✅ |

---

## 次のラウンドの進め方 (推奨)

1. **Round N+1**: 構造的 P1 7 件を 1 件ずつ片付ける (1 日 1〜2 件)
2. **Round N+2**: P2 をまとめて
3. **Round N+3**: TS error 79 件 + dead code + UI 負債
4. **Round N+4**: テスト追加でリグレッション固定

「使ってない」状態のうちに全部潰せれば、本番投入時の事故率がゼロに近づく。
