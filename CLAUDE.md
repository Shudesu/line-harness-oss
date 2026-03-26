<!-- contribution-rules:start -->
# このフォークは独立運用 (2026-03-25 オーナー決定)

upstream (Shudesu/line-harness-oss) への PR 提出は**永久停止**。
このリポジトリは「みやびライン」として完全独立で開発する。
upstream への PR は一切出さない。
<!-- contribution-rules:end -->

<!-- project:start -->
# line-harness-oss (みやびライン) — Claude Code ガイド

## プロジェクト概要

LINE公式アカウント管理CRM。Cloudflare Workers + D1 のモノレポ。
独自機能（AI返信・Stripe課金・スコアリング・セグメント配信）を「みやびライン」として開発中。

## 絶対禁止事項

- **upstream (Shudesu/line-harness-oss) への PR は絶対に出さない**
- `git remote add upstream` してから `push` するのも禁止
- upstream の Issue にコメントするのも禁止
- このリポジトリの変更は ShunsukeHayashi/line-harness-oss にのみ push する

## スタック

| 層 | 技術 |
|----|------|
| API | Cloudflare Workers, Hono v4, TypeScript strict |
| DB | Cloudflare D1 (SQLite) — 生SQL, ORM不使用 |
| Admin | Next.js 15 App Router (CF Pages) |
| LIFF | Vite vanilla TypeScript |
| パッケージ管理 | pnpm workspace |
| CI/CD | GitHub Actions + Copilot Coding Agent + Claude AI Review |

## パッケージ構成

```
apps/
  worker/   — Cloudflare Workers API (Hono)
  web/      — Next.js 15 管理画面 (CF Pages)
  liff/     — LINE LIFF (Vite)
packages/
  db/       — D1クエリヘルパー (@line-crm/db)
  line-sdk/ — LINE Messaging API ラッパー (@line-crm/line-sdk)
  sdk/      — 外部公開SDK (@line-harness/sdk)
  shared/   — 共通型定義 (@line-crm/shared)
```

## 重要ファイル

| ファイル | 役割 |
|---------|------|
| `apps/worker/src/index.ts` | Workers エントリーポイント・ルーティング |
| `apps/worker/src/routes/webhook.ts` | LINE Webhook 処理 |
| `apps/worker/src/services/event-bus.ts` | イベント駆動オートメーション |
| `apps/worker/src/services/miyabi-ai-router.ts` | AI返信ルーター |
| `apps/worker/src/services/step-delivery.ts` | シナリオステップ配信 |
| `apps/worker/wrangler.toml` | CF Workers設定（DB bindings含む） |
| `packages/db/migrations/` | D1マイグレーションSQL (001〜010) |

## よく使うコマンド

```bash
# 開発サーバー
pnpm dev:worker    # Workers ローカル (wrangler dev)
pnpm dev:web       # Next.js dev server

# ビルド・型チェック
pnpm -r build                         # モノレポ全体ビルド
pnpm --filter worker typecheck        # Worker 型チェック
pnpm --filter @line-crm/web typecheck # Web 型チェック

# デプロイ
pnpm deploy:worker  # CF Workers デプロイ
pnpm deploy:web     # CF Pages デプロイ

# DB
pnpm db:migrate          # 本番 D1 マイグレーション
pnpm db:migrate:local    # ローカル D1 マイグレーション
```

## コーディング規約

- `any` 禁止 — 適切な型を定義する
- Cloudflare Workers では Node.js API 使用禁止 (`node:fs`, `node:path` 等)
- D1クエリ: `db.prepare('SQL').bind(...).run()` / `.first()` / `.all()` パターン
- エラーレスポンス: `c.json({ success: false, error: 'message' }, statusCode)` で統一
- ESM (`import/export`) のみ
- 環境変数は `c.env.VAR_NAME` でアクセス (Workers の `Env` 型から)

## TypeScript 設定の注意点

- ルートの `tsconfig.base.json` は `lib: ["ES2022"]` のみ
- `URL`, `fetch`, `Response` 等を使う場合は各 `tsconfig.json` に `"lib": ["ES2022", "DOM"]` を追加
- Workers環境は `lib: ["ES2022", "WebWorker"]`

## DB スキーマ概要

マイグレーション `packages/db/migrations/` 参照:
- `001` friends, scenarios, steps, tags, automations
- `002` segment_conditions, segment_sends, broadcasts
- `003` entry_routes (登録経路)
- `004` friend_metadata (LINE profile同期)
- `005` step_branching (条件分岐)
- `006` tracked_links (クリック追跡)
- `007` forms (フォーム機能)
- `008` rate_limit (API制限)
- `009` beta_feedback
- `010` token_expiry (LINE token自動更新)

## 環境変数（Wrangler Secrets）

```
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
API_KEY                    # Bearer認証
STRIPE_WEBHOOK_SECRET
STRIPE_PRO_PRICE_ID
STRIPE_BUSINESS_PRICE_ID
GITHUB_TOKEN               # CI Issue自動作成用
GITHUB_REPO                # "ShunsukeHayashi/line-harness-oss"
TELEGRAM_BOT_TOKEN         # 通知（任意）
TELEGRAM_CHAT_ID
```

## 実装フロー（必須）— Claude Code はコードを書かない

**このプロジェクトでは Claude Code が `apps/` や `packages/` のコードを直接書くことを禁止する。**
新機能・バグ修正はすべて以下のパイプラインに通す。

```
Claude Code (要件定義・Issue作成)
  → Copilot Coding Agent (自動実装・Draft PR)
    → CI: pnpm -r build + typecheck
      → Claude Opus 4.6 AI レビュー
        → 自動 squash merge
```

### パイプライン起動コマンド（1コマンドで完了）

```bash
gh issue create \
  --repo ShunsukeHayashi/line-harness-oss \
  --title "[auto] feat: {機能の概要}" \
  --label "copilot,auto" \
  --body "## やりたいこと
{1行の概要}

## 要件
- {具体的な要件1}
- {具体的な要件2}

## 対象ファイル（わかる場合）
- \`apps/worker/src/routes/...\`

## 完了条件
- [ ] pnpm -r build が通る
- [ ] {動作確認の条件}"
```

**ラベルは必ず `copilot,auto` を両方付けること。**

### パイプライン vs 直接実装の判断

| ケース | 対応 |
|--------|------|
| 新機能・バグ修正・テスト追加・リファクタリング | **パイプライン（デフォルト）** |
| `.github/workflows/` の変更 | Claude Code が直接実施（Security Gate回避） |
| セキュリティ修正（シークレット・認証） | Claude Code が直接実施 |
| `git merge upstream/main` | Claude Code が直接実施 |
| `pnpm db:migrate` 実行 | 手動（SQL確認後） |
| 緊急ホットフィックス（5分以内） | Claude Code が直接実施 |

### よい Issue の書き方

```
## やりたいこと
友だち一覧APIにページネーションを追加する

## 要件
- GET /api/friends に page と limit クエリパラメータを追加（デフォルト: page=1, limit=20）
- レスポンスに { data, total, page, limit, hasNext } を含める
- apps/worker/src/routes/friends.ts を修正
- D1クエリに LIMIT/OFFSET を使う

## 完了条件
- [ ] pnpm -r build が通る
- [ ] GET /api/friends?page=2&limit=10 が正しいデータを返す
```

### パイプライン確認コマンド

```bash
# PR 一覧
gh pr list --repo ShunsukeHayashi/line-harness-oss

# CI 状態
gh pr checks {PR番号} --repo ShunsukeHayashi/line-harness-oss

# Copilot が動いていない場合 → ラベルを付け直す
gh issue edit {ISSUE番号} --add-label "copilot" --repo ShunsukeHayashi/line-harness-oss
```

---

## GitHub ワークフロー（自動パイプライン）

1. Issue作成 → `@copilot` アサイン → Copilot が Draft PR 作成
2. `pnpm -r build` + `pnpm --filter worker typecheck` (CI)
3. CI失敗 → Issue自動作成 → Copilot が修正PR
4. CI通過 → Claude Opus 4.6 がコードレビュー (ai-review.yml)
5. APPROVE → 自動squash merge (auto-merge.yml)
6. 手動で Issue を作る場合: `[auto]` prefix で Copilot がPR作成

## マルチエージェント構成

| エージェント | 役割 | 使い方 |
|------------|------|--------|
| Claude Code (ローカル) | 設計・レビュー・複雑な実装 | 直接 |
| Copilot Coding Agent | Issue → PR 自動実装 | `[auto]` Issue作成 |
| Claude Opus 4.6 (CI) | PR コードレビュー | 自動（ai-review.yml） |
| OpenClaw main agent | リモートタスク・通知 | `ssh macbook "openclaw agent -m '...' --agent main"` |

## OpenClaw との連携

```bash
# mainエージェントにタスク送信
ssh macbook "openclaw agent -m 'みやびライン: [タスク内容]' --agent main"

# Copilot にIssue経由でタスクを投げる
gh issue create --repo ShunsukeHayashi/line-harness-oss \
  --title "[auto] feat: [機能名]" \
  --body "[要件]"
```

## 注意事項

- Workers の `fetch-depth: 0` が必要なCIはすでに設定済み
- D1 バインディング名: `DB` (`wrangler.toml` の `binding = "DB"`)
- CF Workers デプロイ名: `miyabi-line-crm`
- CF D1 database_id: `2b9355ee-ddef-45d1-bca1-06a0a029ff83`
<!-- project:end -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **line-harness-oss** (1351 symbols, 2638 relationships, 91 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/line-harness-oss/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/line-harness-oss/context` | Codebase overview, check index freshness |
| `gitnexus://repo/line-harness-oss/clusters` | All functional areas |
| `gitnexus://repo/line-harness-oss/processes` | All execution flows |
| `gitnexus://repo/line-harness-oss/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
