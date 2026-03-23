# LINE Harness Wiki

## LINE Harness とは

LINE Harness は、LINE公式アカウント向けのオープンソース CRM / マーケティングオートメーションツールです。L-step や Utage の代替として、無料（または低コスト）で運用できます。

**コンセプト**: AIがLINEを安全に操作するための基盤。人間は監視し、AI（Claude Code等）がAPIを通じて操作します。全機能がREST APIとして公開されており、管理画面はデータの可視化専用です。

## 主要機能

| 機能 | 説明 |
|------|------|
| 友だち管理 | Webhook自動登録、タグ付け、セグメント分け、カスタムメタデータ |
| ステップ配信 | シナリオ作成、遅延配信、条件分岐、friend_add/tag_added/manualトリガー |
| 一斉配信 | 全員/タグ/セグメント絞り込み、予約配信、バッチ送信 |
| 自動応答 | キーワードマッチ（exact/contains）による自動返信 |
| UUID連携 | 複数LINE公式アカウント間でのユーザー統合、BAN復旧対応 |
| アフィリエイト・CV計測 | 流入元トラッキング、コンバージョンポイント定義、成果計測 |
| ステルス配信 | ジッター、メッセージバリエーション、時間分散によるLINE規約準拠 |
| リッチメニュー | LINE API経由での作成/画像アップロード/個別紐付け |
| フォーム | LIFFフォーム定義、回答保存、タグ・シナリオ自動付与 |
| トラッキングリンク | URL計測、クリック記録、タグ自動付与 |
| IF-THENオートメーション | イベント駆動のアクション自動実行 |
| リマインダー | 日付ベースのカウントダウン配信 |
| リードスコアリング | イベントベースのスコア加算/減算 |
| テンプレート | text/flex/image テンプレート管理 |
| チャット | オペレーター向けチャット閲覧/送信 |
| 通知システム | イベント連動の通知ルール |
| Webhook IN/OUT | 受信/送信Webhook、外部システム連携 |
| Google Calendar | GCal接続、予約管理 |
| Stripe連携 | 決済イベント連携（テーブル準備済み） |
| BANモニタリング | アカウントヘルスチェック |

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| API/Webhook | Cloudflare Workers + Hono |
| データベース | Cloudflare D1 (SQLite) — 42テーブル |
| 定期実行 | Workers Cron Triggers (5分毎) |
| 管理画面 | Next.js 15 (App Router) + Tailwind CSS on CF Pages |
| LIFF | Vite + vanilla TypeScript |
| LINE連携 | 自作型付きSDK (@line-crm/line-sdk) |
| SDK | @line-harness/sdk (npm publish対応) |

## デプロイ先

| コンポーネント | URL |
|---------------|-----|
| API | `https://your-worker.your-subdomain.workers.dev` |
| 管理画面 | `https://your-admin.pages.dev` |
| D1 | `line-crm` (APAC/KIX) |

## L-step / Utage との比較

| 項目 | L-step | Utage | LINE Harness |
|------|--------|-------|-------------|
| 月額 | 2,980円〜 | 9,700円〜 | 無料〜$5 |
| ステップ配信 | あり | あり | あり |
| セグメント配信 | あり | あり | あり（AND/OR条件） |
| フォーム | あり | あり | あり（LIFF） |
| アフィリエイト計測 | なし | なし | あり |
| UUID連携（BAN対策） | なし | なし | あり |
| ステルス配信 | なし | なし | あり |
| AI/API操作 | 非対応 | 非対応 | 全機能API公開 |
| セルフホスト | 不可 | 不可 | 可 |
| ソースコード | 非公開 | 非公開 | MIT |

## Wiki ページ一覧

### 基本

1. **[Getting Started](Getting-Started.md)** — インストール、環境構築、初回デプロイ
2. **[Architecture](Architecture.md)** — モノレポ構造、データフロー、認証、DB設計
3. **[Configuration](Configuration.md)** — wrangler.toml、環境変数、Cron、CORS、JST

### コア機能

4. **[Friends](Friends.md)** — 友だち管理、Webhook登録、メタデータ、API
5. **[Scenarios](Scenarios.md)** — ステップ配信、シナリオ、条件分岐、Cron配信
6. **[Broadcasts](Broadcasts.md)** — 一斉配信、予約配信、バッチ送信、セグメント
7. **[Tags](Tags.md)** — タグCRUD、友だちタグ、シナリオトリガー連携

### 拡張機能

8. **[Rich Menus](09-Rich-Menus.md)** — リッチメニュー作成、画像アップロード、ユーザー紐付け
9. **[Tracked Links](10-Tracked-Links.md)** — URLトラッキング、クリック計測、タグ自動付与
10. **[Forms and LIFF](11-Forms-and-LIFF.md)** — LIFFフォーム、回答保存、メタデータ連携
11. **[Reminders](12-Reminders.md)** — リマインダー配信、カウントダウン、日付トリガー
12. **[Scoring](13-Scoring.md)** — リードスコアリング、ルール定義、スコア履歴
13. **[Automation](14-Automation.md)** — IF-THENオートメーション、条件/アクション定義
14. **[Webhooks and Notifications](15-Webhooks-and-Notifications.md)** — 受信/送信Webhook、通知ルール
15. **[Chat and AutoReply](16-Chat-and-AutoReply.md)** — オペレーターチャット、自動返信
16. **[CV Tracking and Affiliates](17-CV-Tracking-and-Affiliates.md)** — コンバージョン計測、アフィリエイト
17. **[Multi-Account and BAN](18-Multi-Account-and-BAN.md)** — UUID連携、マルチアカウント、BAN復旧

### リファレンス

18. **[SDK Reference](19-SDK-Reference.md)** — @line-harness/sdk 全API
19. **[API Reference](20-API-Reference.md)** — REST API 全エンドポイント一覧
20. **[Deployment](21-Deployment.md)** — 本番デプロイ、スケーリング
21. **[Operations](22-Operations.md)** — 運用、監視、トラブルシューティング
22. **[Claude Code Integration](23-Claude-Code-Integration.md)** — AI連携、プロンプト例

## D1テーブル一覧（42テーブル）

```
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
```

## ライセンス

MIT
