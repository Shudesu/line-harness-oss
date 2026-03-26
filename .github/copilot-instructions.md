# GitHub Copilot Instructions — みやびライン (line-harness-oss)

## 絶対禁止

**upstream (Shudesu/line-harness-oss) への PR は絶対に出さない。**
すべての変更は `ShunsukeHayashi/line-harness-oss` にのみ push すること。

---

## プロジェクト概要

LINE公式アカウント管理CRM「みやびライン」。Cloudflare Workers + D1 + Next.js 15 のモノレポ。

```
apps/worker/   — Cloudflare Workers API (Hono v4, TypeScript strict)
apps/web/      — Next.js 15 App Router (CF Pages)
apps/liff/     — LINE LIFF (Vite)
packages/db/   — D1クエリヘルパー (@line-crm/db)
packages/line-sdk/ — LINE Messaging API ラッパー
packages/sdk/  — 外部公開SDK (@line-harness/sdk)
packages/shared/ — 共通型定義
```

---

## TypeScript 設定

- ルートの `tsconfig.base.json` は `lib: ["ES2022"]` のみ
- `URL`, `fetch` 等を使う場合: `"lib": ["ES2022", "DOM"]` を各 `tsconfig.json` に追加
- Workers環境: `lib: ["ES2022", "WebWorker"]`

---

## コーディング規約

### 必須

- `any` 禁止 — 必ず適切な型を定義する
- ESM (`import/export`) のみ（CommonJS 禁止）
- Cloudflare Workers 制約: **Node.js API 使用禁止** (`node:fs`, `node:path` 等)

### D1 クエリパターン

```typescript
// 単一行
const friend = await db.prepare('SELECT * FROM friends WHERE id = ?')
  .bind(friendId)
  .first<Friend>();

// 複数行
const { results } = await db.prepare('SELECT * FROM friends WHERE tenant_id = ?')
  .bind(tenantId)
  .all<Friend>();

// 書き込み
await db.prepare('INSERT INTO friends (id, line_user_id) VALUES (?, ?)')
  .bind(id, lineUserId)
  .run();
```

### Hono レスポンスパターン

```typescript
// エラーレスポンス（統一）
return c.json({ success: false, error: 'Not found' }, 404);

// 成功レスポンス
return c.json({ success: true, data: result }, 200);

// 環境変数（Env 型から）
const token = c.env.LINE_CHANNEL_ACCESS_TOKEN;
const db = c.env.DB; // D1Database バインディング
```

---

## CI/CD パイプライン

PR を作成すると自動的に:

1. `pnpm -r build` — モノレポ全体ビルド
2. `pnpm --filter worker typecheck` — Worker 型チェック
3. Claude Opus 4.6 による AI コードレビュー
4. APPROVE → 自動 squash merge

### 修正時の確認コマンド

```bash
pnpm install --frozen-lockfile
pnpm -r build
pnpm --filter worker typecheck
```

---

## 重要ファイル

| ファイル | 役割 |
|---------|------|
| `apps/worker/src/index.ts` | エントリーポイント・ルーティング |
| `apps/worker/src/routes/webhook.ts` | LINE Webhook 処理 |
| `apps/worker/src/services/event-bus.ts` | イベント駆動オートメーション |
| `apps/worker/src/services/miyabi-ai-router.ts` | AI返信ルーター |
| `apps/worker/wrangler.toml` | CF Workers設定（バインディング定義） |
| `packages/db/migrations/` | D1マイグレーション（001〜010） |

---

## DB スキーマ

マイグレーション `packages/db/migrations/` 参照:
- `001` friends, scenarios, steps, tags, automations
- `002` segment_conditions, segment_sends, broadcasts
- `003` entry_routes
- `004` friend_metadata
- `005` step_branching
- `006` tracked_links
- `007` forms
- `008` rate_limit
- `009` beta_feedback
- `010` token_expiry

---

## 環境変数（コードにハードコード禁止）

```
LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN
API_KEY （Bearer認証）
STRIPE_WEBHOOK_SECRET / STRIPE_PRO_PRICE_ID / STRIPE_BUSINESS_PRICE_ID
GITHUB_TOKEN / GITHUB_REPO="ShunsukeHayashi/line-harness-oss"
TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
```

Workers では `c.env.VAR_NAME` でアクセス。**絶対にコードに直書きしない。**

---

## PR 作成時の注意

1. タイトルは Conventional Commits: `feat:`, `fix:`, `chore:` 等
2. `Closes #XX` で Issue を紐付ける
3. Draft PR は CI 通過後に Ready に変更する
4. `wrangler.toml` の変更は必ずレビューを受ける
5. **upstream (Shudesu/line-harness-oss) への PR は出さない**
