# LINE Harness - 進捗管理

## プロジェクト概要
LINE公式アカウント向けOSS CRM / マーケティングオートメーション
L社/U社代替。AI（CC）ネイティブ設計。

## コンセプト
- **LINE Harness** = AIがLINEを安全に操作するための基盤
- 人間は監視、AIが操作
- 全機能API公開、ダッシュボードは可視化のみ
- 1プロジェクト = 1デプロイ（ステルス性最強）

## デプロイ先
- **API**: https://line-crm-worker.line-crm-api.workers.dev
- **管理画面**: https://line-crm-admin.pages.dev
- **D1**: line-crm (YOUR_D1_DATABASE_ID) APAC/KIX
- **Cron**: 5分毎ステップ配信チェック + リマインダー配信

## 実装状況

### Round 1 (MVP) ✅ 完了 2026-03-21
- [x] pnpm monorepo
- [x] D1スキーマ（friends, tags, scenarios, steps, broadcasts, auto_replies, messages_log）
- [x] Workers API (Hono) - webhook, friends, tags, scenarios, broadcasts
- [x] LINE SDK型付きラッパー
- [x] ステップ配信Cron
- [x] Next.js管理画面（ダッシュボード、友だち、シナリオ、配信）
- [x] 5分デプロイガイドREADME

### Round 2 (拡張) ✅ 完了 2026-03-21
- [x] UUID Cross-Account System (users, line_accounts テーブル)
- [x] LIFF Auth Flow (apps/liff/ Vite app)
- [x] Affiliate & CV Tracking (affiliates, conversion_points, conversion_events)
- [x] Stealth delivery (ジッター、パーソナライズ、時間分散)
- [x] Rich Message builders (Flex, Carousel, ImageMap, QuickReply)
- [x] SDK npm publish prep
- [x] OpenAPI/Swagger (/docs)
- [x] Enhanced Admin UI (Users, Conversions, Affiliates, LINE Accounts)

### Round 3 (フル機能) ✅ 完了 2026-03-22
- [x] Webhook IN/OUT System — 受信/送信Webhook CRUD + イベント連携
- [x] Google Calendar Integration — GCal接続/予約管理テーブル
- [x] Reminder/Countdown Delivery — リマインダー作成/ステップ/友だち登録/配信Cron
- [x] Lead Scoring — スコアリングルールCRUD + 手動/自動スコア加算 + 履歴
- [x] Template Management — テンプレートCRUD (text/flex/image)
- [x] Operator/Multi-user Chat — チャット閲覧/送信API
- [x] Notification System — 通知ルールCRUD + イベント連動
- [x] Stripe Payment Integration — Stripe連携テーブル/ルート（APIキー設定待ち）
- [x] BAN Detection & Recovery — アカウントヘルスモニタリング
- [x] IF-THEN Action Automation — オートメーションCRUD + 条件/アクション定義

### Round 3.5 (追加機能) ✅ 完了 2026-03-22
- [x] フォーム (LIFF) — フォーム定義/回答保存/metadata連携/タグ・シナリオ自動付与
- [x] トラッキングリンク — URL計測/クリック記録/誰がいつクリックしたか/タグ自動付与
- [x] リッチメニュー — LINE API経由 作成/画像アップロード/デフォルト設定/個別紐付け
- [x] エントリールート — 流入元トラッキング
- [x] friends.scoreカラム追加 — マイグレーション漏れ修正

### Round 4 (予定)
- [ ] メール配信連携 (SendGrid/SES)
- [ ] SMS連携
- [ ] Instagram DM連携
- [ ] LTV予測・チャーン予測
- [ ] ポイントシステム
- [ ] 抽選/くじ機能
- [ ] ファネルビルダー（LIFF + CF Pages）

## テスト済み機能 (2026-03-22 周アカウントで実施)

| 機能 | API | LINE送信 | 備考 |
|------|-----|---------|------|
| テンプレート | ✅ 3件 | — | text/flex/image |
| タグ付与 | ✅ 3件 | — | VIP/アクティブ/フォーム回答済み |
| スコアリング | ✅ 35pt | — | ルール4件 + 手動加算 |
| IF-THEN | ✅ 3件 | — | msg/form/followトリガー |
| リマインダー | ✅ | — | 3/25予約で3ステップ登録 |
| 通知ルール | ✅ 2件 | — | follow/form_submitted |
| Webhook | ✅ IN1+OUT1 | — | Zapier連携テスト |
| Text送信 | ✅ | ✅ 到達確認 | APIプッシュ |
| Flex送信 | ✅ | ✅ 到達確認 | ステータスカード |
| フォーム | ✅ | ✅ LIFF | 回答D1保存+metadata連携 |
| トラッキングリンク | ✅ | ✅ 5クリック | friendId紐づけ+タグ自動付与 |
| リッチメニュー | ✅ | ✅ 表示確認 | 3分割メニュー |
| UUID連携 | ✅ | — | friend→user紐づけ済み |

## D1テーブル一覧 (42テーブル)
account_health_logs, account_migrations, admin_users, affiliate_clicks,
affiliates, auto_replies, automation_logs, automations, broadcasts,
calendar_bookings, chats, conversion_events, conversion_points,
entry_routes, form_submissions, forms, friend_reminder_deliveries,
friend_reminders, friend_scenarios, friend_scores, friend_tags, friends,
google_calendar_connections, incoming_webhooks, line_accounts, link_clicks,
messages_log, notification_rules, notifications, operators,
outgoing_webhooks, ref_tracking, reminder_steps, reminders,
scenario_steps, scenarios, scoring_rules, stripe_events, tags,
templates, tracked_links, users

## 技術スタック
| レイヤー | 技術 |
|---------|------|
| API/Webhook | Cloudflare Workers + Hono |
| DB | Cloudflare D1 (SQLite) |
| Cron | Workers Cron Triggers |
| 管理画面 | Next.js 15 + Tailwind on CF Pages |
| LIFF | Vite + vanilla TS |
| LINE連携 | 自作型付きSDK (@line-crm/line-sdk) |

## マネタイズ案
1. ホスティング代行（月3,000〜5,000円）
2. セットアップ代行（5〜10万円）
3. シナリオ構築コンサル（10〜30万円）
4. BAN復旧サービス（5〜15万円）
5. ビジネスオーナーリスト活用

## 設計思想
- コア = LINE配信エンジン + UUID基盤 + CV計測
- 外部連携 = Webhook/APIで繋ぐ（Stripe, GCal, SendGrid等）
- ダッシュボード = 視覚的に見るべきものだけ
- 設定・構築 = CC（Claude Code）経由でAPI操作
- 安全策 = Zodバリデーション, dry_run, audit log, バージョニング, 配信制限

## 参考資料
- SPEC.md - 技術仕様
- LSTEP_FEATURES.md - L社/U社全機能調査
