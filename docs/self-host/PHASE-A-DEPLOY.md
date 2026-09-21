# Phase A — 自前デプロイ（OSS）

動画「集客を完全0円で自動化」相当の機能を使うための **最初の一歩** です。Google ワンクリックのクラウド版は [L Harness Cloud](https://lharness.cloud/)（別製品）です。OSS ではこの手順で Cloudflare 上にテナントを立てます。

## 前提

- Node.js 22+、`pnpm`（リポジトリルートで `pnpm install` 済み）
- Cloudflare アカウント（`npx wrangler login`）
- LINE Messaging API チャネル +（ウェビナー/LIFF 利用時）LINE Login チャネル

## 手順

### 1. セットアップ CLI

リポジトリ外の空ディレクトリでも、**このリポジトリのルート**でも実行できます。

```bash
npx create-line-harness
```

またはモノレポ内:

```bash
pnpm deploy:setup
```

（`packages/create-line-harness` をビルド済みであること）

Step 14 で **Cursor** を選ぶと `.cursor/mcp.json` と `.cursor/rules/l-harness.mdc` が生成されます。

### 2. MCP（Cursor）の完成

[`.cursor/SETUP.md`](../../.cursor/SETUP.md) に従い、次を実値に置き換えます。

| 変数 | 説明 |
|------|------|
| `LINE_HARNESS_API_URL` | デプロイした Worker URL（末尾スラッシュなし） |
| `LINE_HARNESS_API_KEY` | セットアップ時に発行された API キー |
| `LINE_HARNESS_ACCOUNT_ID` | LINE アカウントが 1 つのとき推奨 |

### 3. 検証

```bash
node scripts/verify-self-host.mjs
```

オプション: `node scripts/verify-self-host.mjs --api-url https://xxx.workers.dev --api-key lh_...`

### 4. LINE 側の必須設定

セットアップ完了画面のチェックリストに従い、少なくとも以下を確認します。

- Webhook URL → `{WORKER_URL}/webhook`、利用 ON
- 応答設定: チャット / あいさつ / 応答メッセージ OFF、Webhook ON
- LIFF エンドポイント（ウェビナー・フォーム利用時）

## ローカル開発のみ

```bash
pnpm dev:worker   # http://127.0.0.1:8787
pnpm dev:web      # http://localhost:3001
```

`.cursor/mcp.json` の URL を `http://127.0.0.1:8787` にし、ローカル D1 にマイグレーション済みであることを確認してください。

## 次のステップ

[30-Video-Feature-Playbook.md](../wiki/30-Video-Feature-Playbook.md)（ウェビナー・マイル・プール）
