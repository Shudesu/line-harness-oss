# 今すぐ実行する手順（Phase A）

エージェントからは **Cloudflare OAuth を完了できません**。Cursor の **統合ターミナル**で次を実行してください。

## 1. Cloudflare ログイン（2 分以内にブラウザで許可）

```powershell
cd "C:\Users\user\Desktop\Cursor Date\line-harness-oss"
npx wrangler login
```

ブラウザが開いたら **Allow** → ターミナルにアカウント名が表示されるまで待つ。

## 2. 本番セットアップ（LINE チャネル情報を手元に用意）

```powershell
pnpm continue:phase-a
```

（`pnpm bootstrap:self-host` でも可。`continue:phase-a` はログイン済み前提で `deploy:setup` まで進めます。）

## 3. `.cursor/mcp.json` を更新

セットアップ完了画面の **Worker URL** と **API キー** を貼る。

```json
"LINE_HARNESS_API_URL": "https://xxxx.workers.dev",
"LINE_HARNESS_API_KEY": "lh_...."
```

Cursor で MCP を再読み込み。

## 4. 検証

```powershell
pnpm verify:self-host
```

## 5. 管理画面（ローカル）

別ターミナル:

```powershell
pnpm dev:web
```

→ http://localhost:3001 の **動画機能セットアップ**（本番 API を向ける場合は `apps/web/.env.local` に `NEXT_PUBLIC_API_URL` を設定）

詳細: [30-Video-Feature-Playbook.md](../wiki/30-Video-Feature-Playbook.md)
