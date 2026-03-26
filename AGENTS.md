# AGENTS.md — みやびライン (line-harness-oss) エージェント定義

## 🚨 絶対禁止事項（全エージェント共通・例外なし）

**upstream (Shudesu/line-harness-oss) への PR は永久禁止。**

- `git remote add upstream` + push → 禁止
- upstream の Issue へのコメント → 禁止
- このリポジトリの変更は `ShunsukeHayashi/line-harness-oss` にのみ push する
- CI/CD ワークフロー（`.github/workflows/`）の変更 → 手動レビュー必須

---

## プロジェクト概要

LINE公式アカウント管理CRM「みやびライン」。Cloudflare Workers + D1 のモノレポ。

```
apps/
  worker/   — Cloudflare Workers API (Hono v4)
  web/      — Next.js 15 管理画面 (CF Pages)
  liff/     — LINE LIFF (Vite)
packages/
  db/       — D1クエリヘルパー (@line-crm/db)
  line-sdk/ — LINE Messaging API ラッパー
  sdk/      — 外部公開SDK (@line-harness/sdk)
  shared/   — 共通型定義 (@line-crm/shared)
```

---

## Codex (GitHub Copilot Coding Agent)

### 役割

Issue に `[auto]` プレフィックスを付けて作成すると、Copilot Coding Agent が自動実装してDraft PRを作成する。

### 実装可能タスク (推奨)

| カテゴリ | 具体例 |
|---------|--------|
| 新機能実装（仕様明確） | APIエンドポイント追加、UIコンポーネント追加 |
| バグ修正（再現手順あり） | エラーメッセージと原因が明確なもの |
| リファクタリング（範囲限定） | 型整理、命名統一、コンポーネント分割 |
| テスト追加 | ユニットテスト、E2Eテスト |
| ドキュメント更新 | README、CHANGELOG |

### 禁止タスク

- `.github/workflows/` の変更
- `wrangler.toml` の直接変更（バインディング定義）
- 環境変数・シークレットを含む変更
- セキュリティ修正
- upstream との差分取り込み（rebase/cherry-pick）

### Issue 作成フォーマット

```bash
gh issue create \
  --repo ShunsukeHayashi/line-harness-oss \
  --title "[auto] feat: 機能の概要" \
  --body "## やりたいこと
要件を箇条書きで記述。

## 技術仕様
- スタック: Cloudflare Workers (Hono v4) / D1 (SQLite) / Next.js 15
- 対象ファイル: apps/worker/src/routes/*.ts
- コーディング規約: any禁止、ESM only、Node.js API禁止

## 完了条件
- [ ] pnpm -r build が通ること
- [ ] pnpm --filter worker typecheck が通ること"
```

---

## Claude Code (ローカル)

### 役割

設計・レビュー・複雑な実装・マルチエージェント連携の設計。

### 得意領域

- アーキテクチャ設計・技術選定
- 複雑なビジネスロジック（AI返信ルーター、ステップ配信）
- PR レビュー（AI Review CI が Claude Opus 4.6 を使用）
- upstream cherry-pick / rebase
- セキュリティ修正

### コーディング規約（必須遵守）

```typescript
// NG: Node.js API / any 型
import { readFileSync } from 'node:fs';
const data: any = {};

// OK: Workers互換 / 型定義
const result = await db.prepare('SELECT * FROM friends WHERE id = ?')
  .bind(friendId)
  .first<Friend>();
return c.json({ success: false, error: 'Not found' }, 404);
const token = c.env.LINE_CHANNEL_ACCESS_TOKEN;
```

---

## OpenClaw (main エージェント)

### 役割

リモートタスク実行・通知・モニタリング。

### 送信方法

```bash
# mainエージェントにタスク送信
ssh macbook "openclaw agent -m 'みやびライン: [タスク内容]' --agent main"

# Copilot にIssue経由でタスクを投げる
gh issue create --repo ShunsukeHayashi/line-harness-oss \
  --title "[auto] feat: [機能名]" \
  --body "[要件]"
```

---

## GitHub Automated Pipeline

```
1. Issue作成（[auto] prefix）
2. @copilot アサイン → Copilot が Draft PR 作成
3. pnpm -r build + pnpm --filter worker typecheck (CI)
4. CI失敗 → Issue自動作成 → Copilot が修正PR
5. CI通過 → Claude Opus 4.6 がコードレビュー (ai-review.yml)
6. APPROVE → 自動squash merge (auto-merge.yml)
```

---

## 共通コーディング規約

| 規約 | 内容 |
|------|------|
| `any` 禁止 | 適切な型を定義する |
| Node.js API 禁止 | `node:fs`, `node:path` 等は使わない |
| D1クエリ | `db.prepare('SQL').bind(...).run()/.first()/.all()` |
| エラーレスポンス | `c.json({ success: false, error: 'message' }, statusCode)` |
| モジュール形式 | ESM (`import/export`) のみ |
| 環境変数 | `c.env.VAR_NAME` でアクセス |

---

## 重要ファイル

| ファイル | 役割 |
|---------|------|
| `apps/worker/src/index.ts` | Workers エントリーポイント |
| `apps/worker/src/routes/webhook.ts` | LINE Webhook 処理 |
| `apps/worker/src/services/event-bus.ts` | イベント駆動オートメーション |
| `apps/worker/src/services/miyabi-ai-router.ts` | AI返信ルーター |
| `apps/worker/wrangler.toml` | CF Workers設定 |
| `packages/db/migrations/` | D1マイグレーションSQL |

---

## 環境変数（Wrangler Secrets）

```
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
API_KEY
STRIPE_WEBHOOK_SECRET / STRIPE_PRO_PRICE_ID / STRIPE_BUSINESS_PRICE_ID
GITHUB_TOKEN / GITHUB_REPO="ShunsukeHayashi/line-harness-oss"
TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
```

- D1 バインディング名: `DB`
- CF Workers デプロイ名: `miyabi-line-crm`
- CF D1 database_id: `2b9355ee-ddef-45d1-bca1-06a0a029ff83`

---

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
