# Cursor MCP（この環境）

## 1. `.cursor/mcp.json` を埋める

| 変数 | この下書きの値 | 取得方法 |
|------|----------------|----------|
| `LINE_HARNESS_API_URL` | `http://127.0.0.1:8787` | ローカル: `pnpm dev:worker`。本番は `https://<your-worker>.workers.dev` |
| `LINE_HARNESS_API_KEY` | プレースホルダ | 管理画面の API キー、または `create-line-harness` セットアップ時に発行されたキー |
| `LINE_HARNESS_ACCOUNT_ID` | 任意 | LINE アカウントが1つのときだけ設定（MCP 経由の配信が管理画面に表示されやすくなる） |

## 2. Worker を起動

```bash
pnpm dev:worker
```

## 3. Cursor で MCP を再読み込み

設定保存後、Cursor を再起動するか MCP サーバー一覧を更新してください。

## 4. デプロイ後の検証

```bash
node scripts/verify-self-host.mjs
```

本番 Worker URL を設定したあと、上記で `/api/health`・`/api/capabilities`・API キーを確認できます。詳細は `docs/self-host/PHASE-A-DEPLOY.md`。

## 注意

- `.cursor/mcp.json` は **コミットされません**（`.gitignore`）。
- テンプレートは `.cursor/mcp.json.example`（リポジトリに含まれる）。
