# AGENTS.md — LINE Harness (OSS)

このファイルは、このリポジトリで作業する AI コーディングエージェント（Claude Code, Codex 等）と人間のコントリビューター向けの開発ガイドです。「どう動くか」ではなく「どう変更するか」に焦点を当てています。プロダクト機能の説明は README.md、詳細な実装ガイドは `docs/wiki/` を参照してください。

## プロジェクト概要

LINE公式アカウント向けの完全オープンソース CRM / マーケティングオートメーション。Cloudflare の無料枠だけで動作するように設計されており、全機能が REST API 経由で操作できる（管理画面はその上に乗る UI の一つという位置づけ）。TypeScript SDK と MCP Server も同梱しており、AI エージェントからの自然言語操作を前提としたアーキテクチャになっている。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| API / Webhook | Cloudflare Workers + Hono |
| データベース | Cloudflare D1 (SQLite) |
| 管理画面 | Next.js 15 (App Router) + Tailwind CSS |
| LIFF (ミニアプリ) | Vite。ビルド後は Worker に統合配信（後述） |
| SDK | TypeScript (ESM + CJS, tsup) |
| 定期実行 | Workers Cron Triggers (5分毎) |
| パッケージマネージャ | pnpm 9.15.4 (workspace) |

## モノレポ構成（現状）

```
apps/
  worker/           Cloudflare Workers 本体（API + Webhook + Cron + LIFF配信）
    src/routes/     Hono ルートハンドラ（1ファイル1リソース）
    src/services/   ビジネスロジック（配信処理・BAN監視・イベントバス等）
    src/middleware/ 認証・レート制限
    src/client/     LIFF フロントエンド（旧 apps/liff を統合済み。後述）
  web/              Next.js 15 管理画面
packages/
  db/               D1 スキーマ (schema.sql) + クエリ関数群
  db/migrations/    連番マイグレーション（下記「DB変更の作法」参照）
  line-sdk/         LINE Messaging API の型付きラッパー
  sdk/              公開npmパッケージ `@line-harness/sdk`
  mcp-server/       公開npmパッケージ `@line-harness/mcp-server`（MCP経由のAI操作用）
  shared/           共有型定義
  create-line-harness/  セットアップCLI (`pnpm deploy:setup`)
  plugin-template/  サードパーティ連携プラグインの雛形
docs/wiki/          実装ドキュメント（23ページ）— 変更前にまず確認する
```

> **注意**: README.md や一部の docs/wiki には旧構成の `apps/liff/`（独立 Vite アプリ）が残っているが、現在は `@cloudflare/vite-plugin` により LIFF フロントエンドが `apps/worker` に統合され、`apps/worker/src/client/` として存在する。個別デプロイは不要（`wrangler deploy` だけで一緒に配信される）。コードを読む際は実際のディレクトリ構成（このファイル）を優先すること。

## パッケージ命名の注意（混同しやすい）

- ワークスペース内部パッケージ（`apps/worker` が依存するもの）: `@line-crm/db`, `@line-crm/line-sdk`, `@line-crm/shared`
- 公開npmパッケージ（外部に公開されるもの）: `@line-harness/sdk`, `@line-harness/mcp-server`

新しいパッケージを内部用に追加する場合は `@line-crm/*`、外部公開前提なら `@line-harness/*` の命名規則に合わせる。

## セットアップ（コントリビュート用）

```bash
# 自分の fork を clone
git clone https://github.com/<your-username>/line-harness-oss.git
cd line-harness-oss
pnpm install
pnpm -r build

# ローカル D1 + マイグレーション
pnpm db:migrate:local

# Worker 起動
pnpm dev:worker      # http://localhost:8787
# 管理画面起動
pnpm dev:web         # http://localhost:3001
```

Worker のローカル環境変数は `apps/worker/.dev.vars`（gitignore対象。`.env.example` を参考に作成）。

## テスト・型チェック

```bash
pnpm -r build                                  # 全パッケージビルド
pnpm --filter @line-harness/sdk test           # SDK のテスト (vitest)
pnpm --filter worker typecheck                 # Worker の型チェック
pnpm -r typecheck                              # 全パッケージ型チェック
```

テストは `packages/sdk/tests/*.test.ts`（vitest）と `apps/worker/src/services/*.test.ts` に存在する。新しいロジックを `services/` に追加する場合は同ディレクトリにユニットテストを添えることを推奨。

## DB変更の作法

- `packages/db/schema.sql` は `CREATE TABLE IF NOT EXISTS` で冪等に保つ（既存カラムの変更には使わない）
- 既存テーブルへの変更（カラム追加等）は `packages/db/migrations/NNN_description.sql` を連番で新規追加する（既存ファイルは変更しない）
- 新規テーブルを追加する場合は `schema.sql` と対応する `packages/db/src/*.ts` のクエリ関数の両方を更新する
- クエリは `packages/db/src/*.ts` の関数経由でアクセスする。ルートハンドラに生SQLを直書きしない

## コーディング規約

- TypeScript strict モード・ESM。`tsconfig.base.json` の設定を継承する
- タイムスタンプは **必ず JST 固定**。`new Date().toISOString()` を直接使わず、`packages/db/src/utils.ts` の `jstNow()` / `toJstString()` を使う
- Hono のルートハンドラ（`apps/worker/src/routes/*.ts`）は薄く保ち、業務ロジックは `apps/worker/src/services/*.ts` に分離する
- Webhook はどんな失敗時でも LINE の規約上 `200` を返す（`routes/webhook.ts` の既存パターンに従う）

## シークレット・設定の扱い（重要）

- `apps/worker/wrangler.toml` にはプレースホルダー（`YOUR_ACCOUNT_ID`, `YOUR_D1_DATABASE_ID` 等）が入っている。実際のアカウントID・D1 IDに書き換えたまま **コミットしない**
- シークレット（`API_KEY`, `LINE_CHANNEL_SECRET` 等）は `wrangler secret put` で設定するものであり、リポジトリ内のどのファイルにも平文で書かない
- PRを出す前に、diff に実際のCloudflareアカウントID・D1データベースID・LINEチャネルの実値が紛れ込んでいないか必ず確認する

## コントリビュート手順

1. リポジトリを fork し、機能ブランチを作成する
2. `pnpm install` → 変更 → `pnpm -r build && pnpm -r typecheck`（該当パッケージのテストがあれば実行）
3. 影響範囲を絞った PR を送る。大きな破壊的変更・大規模リファクタは事前に Issue で相談する
4. PR の説明文にシークレットや個人のCloudflareアカウント情報を書かない
5. 該当する場合は `docs/wiki/` のドキュメントも合わせて更新する

## API の既存規約（実装済み・変更時は壊さないこと）

- `apps/worker/src/routes/line-proxy.ts`: LINEへのプッシュ送信で `X-Line-Harness-Source: manual` ヘッダーを付けると `source='manual'`（担当者による手動送信）として記録される。予約通知など自動送信のコードパスではこのヘッダーを付けないこと（自動/手動の区別がログ上で崩れる）
- `apps/worker/src/routes/meet-consultations.ts`: Google Meet の個別相談を確定・変更する処理では、カレンダー更新だけで終わらせず `POST /api/meet-consultations`（Calendar event ID・LINE friend ID・日時・Meet URL）を必ず登録する。これにより前日・1時間前のLINEリマインドが自動セットされる。キャンセル時は `DELETE /api/meet-consultations/:externalEventId` も呼ぶ

## ドキュメント

`docs/wiki/` に Getting Started・Architecture・API Reference・Deployment・Operations 等の全ページがある。実装の詳細や既存の設計判断はまず該当ページを確認してから着手する。
