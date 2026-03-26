# CI/CD ベストプラクティス完全プラン
# line-harness-oss / Cloudflare Workers + D1 + Next.js 15

**作成日**: 2026-03-25
**対象スタック**: Cloudflare Workers (Hono) · D1 (SQLite) · Next.js 15 · pnpm monorepo
**2026年トレンド対応版**

---

## 目次

1. [概要とゴール](#1-概要とゴール)
2. [5段階パイプライン全体アーキテクチャ](#2-5段階パイプライン全体アーキテクチャ)
3. [2026年世界トップトレンド](#3-2026年世界トップトレンド)
4. [Stage 0: ローカル pre-commit](#4-stage-0-ローカル-pre-commit)
5. [Stage 1: PR CI](#5-stage-1-pr-ci)
6. [Stage 2: PR プレビューデプロイ](#6-stage-2-pr-プレビューデプロイ)
7. [Stage 3: main 自動デプロイ](#7-stage-3-main-自動デプロイ)
8. [Stage 4: AI自己修復ループ](#8-stage-4-ai自己修復ループ)
9. [全ワークフロー YAML 一覧](#9-全ワークフロー-yaml-一覧)
10. [GitHub Secrets 設定一覧](#10-github-secrets-設定一覧)
11. [DORA Metrics 目標値](#11-dora-metrics-目標値)
12. [実装ロードマップ P0/P1/P2](#12-実装ロードマップ-p0p1p2)

---

## 1. 概要とゴール

### なぜ CI/CD が最重要か

> **"コードを書く速度より、コードが本番に届く速度が価値を決める"**

現代のソフトウェア開発において、CI/CD はプロダクトの競争力の根幹。
DORA Research (2024/2025) によると、Elite パフォーマーは以下を達成している：

| DORA Metric | Low Performer | Elite Performer | 本プロジェクト目標 |
|-------------|--------------|-----------------|------------------|
| デプロイ頻度 | 月1回未満 | オンデマンド（1日複数回） | 1日1〜数回 |
| 変更のリードタイム | 6ヶ月〜1年 | 1時間未満 | 30分以内 |
| 変更失敗率 | 46〜60% | 0〜15% | 10%以下 |
| MTTR | 6ヶ月以上 | 1時間未満 | 15分以内 |

### このプロジェクトの設計思想

```
ローカル → PR → プレビュー → main → 本番
  ↑                                    ↓
  └────── AI自己修復ループ ──────────────┘
```

**3つの柱:**
1. **Fail Fast** — ローカルでエラーを検出し、CIを通過させない
2. **Preview First** — 本番前に毎回プレビュー環境で確認
3. **AI-Augmented** — GitHub Copilot + Renovate でエラー修正・依存更新を自動化

---

## 2. 5段階パイプライン全体アーキテクチャ

```
┌──────────────────────────────────────────────────────────────────────┐
│  Stage 0: ローカル pre-commit (lefthook)                              │
│  ・ESLint --fix   ・TypeScript typecheck   ・Conventional Commits     │
│  所要時間: ~5秒   ブロック: コミット前に自動実行                       │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ git push
┌──────────────────────────▼───────────────────────────────────────────┐
│  Stage 1: PR CI (ci.yml)                                              │
│  ・typecheck (worker + web)  ・pnpm -r build  ・npm audit             │
│  ・失敗時 → Copilot Coding Agent に自動アサイン → 修正PR作成           │
│  所要時間: ~3分   並列実行: typecheck ‖ build                         │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ PR 作成
┌──────────────────────────▼───────────────────────────────────────────┐
│  Stage 2: PRプレビューデプロイ (pr-preview.yml)                        │
│  ・wrangler deploy --env preview  ・PR にプレビューURL コメント        │
│  ・D1 preview DB (マイグレーション適用)                                │
│  所要時間: ~2分   URL: https://miyabi-line-crm-pr{N}.workers.dev      │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ PR マージ → main
┌──────────────────────────▼───────────────────────────────────────────┐
│  Stage 3: main 自動デプロイ (deploy-worker.yml)                        │
│  ・D1 migration auto-apply  ・wrangler deploy (本番)                  │
│  ・スモークテスト (curl /health)  ・Telegram 通知                     │
│  所要時間: ~3分   ロールバック: 前バージョンの workers.dev URL         │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ 定期実行 / イベント
┌──────────────────────────▼───────────────────────────────────────────┐
│  Stage 4: AI自己修復ループ                                             │
│  ・Renovate Bot: 依存更新 PR を自動作成 (patch/minor は auto-merge)    │
│  ・Copilot Coding Agent: CI 失敗 Issue に自動アサイン → 修正 PR       │
│  ・Weekly Security Audit: npm audit → CRITICAL は自動 Issue 作成      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. 2026年世界トップトレンド

### 3.1 GitHub Copilot Coding Agent (2025〜2026)

- **仕組み**: GitHub Issue に `assignees: ['Copilot']` を設定 → 自動でブランチ作成・実装・PR提出
- **適用箇所**: CI 失敗時の自動修復 Issue (`ci-failure` ラベル + `auto` ラベル)
- **メモリ機能**: `.github/copilot-instructions.md` でプロジェクト固有の指示を永続化
- **本プロジェクトの実装状況**: ✅ 実装済み (`ci.yml` の `notify-failure` ジョブ)

```yaml
# Copilot に自動アサインするパターン
assignees: ['Copilot']
labels: ['ci-failure', 'bug', 'auto']
```

### 3.2 Cloudflare Workers CI/CD ベストプラクティス

- **Preview deployments**: `wrangler deploy --env preview` で各 PR に独立した環境
- **D1 migration**: `wrangler d1 migrations apply --env preview --remote` で DB も自動移行
- **Workers Secrets**: CI から `wrangler secret put` で Secrets を自動設定
- **Rollback**: Cloudflare Dashboard の「Deployments」から前バージョンにワンクリックロールバック

### 3.3 Renovate Bot（Dependabot の上位互換）

- **GitHub Dependabot との違い**: monorepo対応、グループ設定、自動マージルールが柔軟
- **pnpm workspace 対応**: `"packageManager": "pnpm"` を自動検出
- **推奨設定**: patch/minor は自動マージ、major は PR のみ作成・手動マージ

### 3.4 pnpm monorepo の CI 最適化

- **pnpm store キャッシュ**: `actions/setup-node` の `cache: pnpm` で高速化
- **フィルタービルド**: `pnpm --filter @pkg build` で変更があったパッケージのみビルド
- **turbo/moonrepo**: 大規模 monorepo では分散キャッシュで 50〜80% 高速化可能

### 3.5 OIDC（OpenID Connect）による Secrets レス認証

- **従来**: `CLOUDFLARE_API_TOKEN` を GitHub Secrets に保存
- **OIDC**: GitHub Actions が動的トークンを発行 → Cloudflare が直接検証
- **メリット**: トークン漏洩リスクゼロ、ローテーション不要

```yaml
# OIDC 設定例（将来的な移行先）
permissions:
  id-token: write
  contents: read

- uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    # 将来: apiToken 不要、OIDC で自動認証
```

---

## 4. Stage 0: ローカル pre-commit

### lefthook 設定ファイル

**`lefthook.yml`** (リポジトリルートに配置):

```yaml
# lefthook.yml
# インストール: pnpm add -D lefthook && pnpm lefthook install
pre-commit:
  parallel: true
  commands:
    typecheck:
      glob: "apps/worker/src/**/*.{ts,tsx}"
      run: pnpm --filter worker typecheck
    lint:
      glob: "**/*.{ts,tsx}"
      run: pnpm -r lint --if-present
    format-check:
      glob: "**/*.{ts,tsx,json}"
      run: pnpm -r format:check --if-present

commit-msg:
  commands:
    conventional-commits:
      run: |
        MSG=$(cat {1})
        if ! echo "$MSG" | grep -qE "^(feat|fix|docs|style|refactor|test|chore|ci|build|perf|revert)(\(.+\))?: .+"; then
          echo "ERROR: Conventional Commits 形式に従ってください"
          echo "例: feat(worker): ユーザー登録エンドポイント追加"
          exit 1
        fi
```

### インストール手順

```bash
# lefthook インストール
pnpm add -D lefthook

# Git hooks を有効化
pnpm lefthook install

# 手動実行テスト
pnpm lefthook run pre-commit
```

---

## 5. Stage 1: PR CI

### 設計方針

- `typecheck` と `build` を**並列実行**（直列より ~50% 高速）
- エラーログは **GitHub Output** にキャプチャ（`error_log<<DELIM...DELIM`）
- 失敗時は **Copilot Coding Agent** に自動アサイン

### ci.yml の完全仕様

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    outputs:
      error_log: ${{ steps.run.outputs.error_log }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-crm/db build
      - id: run
        name: Typecheck worker
        run: |
          if ! pnpm --filter worker typecheck 2>&1 | tee /tmp/tc.log; then
            {
              echo 'error_log<<DELIM'
              grep -E "error TS|error:" /tmp/tc.log | head -30
              echo 'DELIM'
            } >> "$GITHUB_OUTPUT"
            exit 1
          fi
      - name: Typecheck web
        run: pnpm --filter web typecheck
        continue-on-error: true

  build:
    name: Build Check
    runs-on: ubuntu-latest
    outputs:
      error_log: ${{ steps.run.outputs.error_log }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - id: run
        name: Build all packages
        run: |
          if ! pnpm -r build 2>&1 | tee /tmp/build.log; then
            {
              echo 'error_log<<DELIM'
              grep -E "error TS|error:|Error:" /tmp/build.log | head -30
              echo 'DELIM'
            } >> "$GITHUB_OUTPUT"
            exit 1
          fi

  notify-failure:
    name: Auto-fix Dispatch
    runs-on: ubuntu-latest
    needs: [typecheck, build]
    if: |
      always() &&
      (needs.typecheck.result == 'failure' || needs.build.result == 'failure')
    permissions:
      issues: write
      contents: read
    steps:
      - name: Create Issue and assign to Copilot
        uses: actions/github-script@v7
        env:
          TYPECHECK_ERROR: ${{ needs.typecheck.outputs.error_log }}
          BUILD_ERROR:     ${{ needs.build.outputs.error_log }}
          TYPECHECK_RESULT: ${{ needs.typecheck.result }}
          BUILD_RESULT:     ${{ needs.build.result }}
        with:
          script: |
            // ... (ci.yml に実装済みのスクリプト)
```

---

## 6. Stage 2: PR プレビューデプロイ

### 設計方針

- PR がオープン/更新されるたびに自動でプレビュー環境をデプロイ
- PR コメントにプレビュー URL を自動投稿
- D1 preview 環境も自動マイグレーション
- PR クローズ時にプレビュー環境を削除（オプション）

### wrangler.toml に preview 環境を追加

```toml
# apps/worker/wrangler.toml に追記
[env.preview]
name = "miyabi-line-crm-preview"
workers_dev = true

[[env.preview.d1_databases]]
binding      = "DB"
database_name = "miyabi-line-crm-preview"
database_id  = "YOUR_PREVIEW_DB_ID"  # wrangler d1 create miyabi-line-crm-preview
```

### pr-preview.yml の完全仕様

```yaml
name: PR Preview

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  deploy-preview:
    name: Deploy Preview
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-crm/db build

      # D1 preview マイグレーション
      - name: Apply D1 migrations (preview)
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/worker
          command: d1 migrations apply miyabi-line-crm-preview --env preview --remote
        continue-on-error: true

      # Worker デプロイ
      - name: Deploy to preview
        id: deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/worker
          command: deploy --env preview

      # PR にコメント
      - name: Comment preview URL
        uses: actions/github-script@v7
        env:
          WORKER_URL: https://miyabi-line-crm-preview.YOUR_SUBDOMAIN.workers.dev
        with:
          script: |
            const body = [
              '## Preview Deployment',
              '',
              '| 項目 | 値 |',
              '|------|-----|',
              `| Worker URL | ${process.env.WORKER_URL} |`,
              `| コミット | \`${context.sha.slice(0, 7)}\` |`,
              `| デプロイ時刻 | ${new Date().toISOString()} |`,
              '',
              '> このコメントは PR 更新のたびに自動更新されます',
            ].join('\n');

            // 既存のコメントを更新（重複防止）
            const comments = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.data.find(c =>
              c.body.includes('## Preview Deployment')
            );
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }
```

---

## 7. Stage 3: main 自動デプロイ

### 設計方針

- `main` ブランチへの push で自動トリガー
- **D1 migration を自動適用**（必須）
- デプロイ後に**スモークテスト**（`/health` エンドポイントへ curl）
- 成功/失敗を **Telegram 通知**
- 手動実行も維持（`workflow_dispatch`）

### deploy-worker.yml の完全仕様

```yaml
name: Deploy Worker

on:
  push:
    branches: [main]
    paths:
      - "apps/worker/**"
      - "packages/**"
  workflow_dispatch:

jobs:
  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-crm/db build

      # D1 本番マイグレーション
      - name: Apply D1 migrations (production)
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/worker
          command: d1 migrations apply miyabi-line-crm --remote

      # Worker 本番デプロイ
      - name: Deploy to production
        id: deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/worker
          command: deploy

      # スモークテスト
      - name: Smoke test
        run: |
          sleep 10  # Worker の起動を待つ
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
            https://miyabi-line-crm.YOUR_SUBDOMAIN.workers.dev/health)
          if [ "$STATUS" != "200" ]; then
            echo "Smoke test FAILED: HTTP $STATUS"
            exit 1
          fi
          echo "Smoke test PASSED: HTTP $STATUS"

      # 成功通知
      - name: Telegram notification (success)
        if: success() && env.BOT_TOKEN != ''
        env:
          BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          CHAT_ID:   ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          SHA7="${GITHUB_SHA:0:7}"
          RUN_URL="https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
          MSG="✅ デプロイ成功: line-harness-oss
Commit: ${SHA7}
Log: ${RUN_URL}"
          curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
            -d "chat_id=${CHAT_ID}" \
            --data-urlencode "text=${MSG}" > /dev/null

      # 失敗通知
      - name: Telegram notification (failure)
        if: failure() && env.BOT_TOKEN != ''
        env:
          BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          CHAT_ID:   ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          SHA7="${GITHUB_SHA:0:7}"
          RUN_URL="https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
          MSG="❌ デプロイ失敗: line-harness-oss
Commit: ${SHA7}
Log: ${RUN_URL}"
          curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
            -d "chat_id=${CHAT_ID}" \
            --data-urlencode "text=${MSG}" > /dev/null
```

---

## 8. Stage 4: AI自己修復ループ

### 8.1 GitHub Copilot Coding Agent フロー

```
CI 失敗
  ↓
notify-failure ジョブ
  ↓
GitHub Issue 自動作成
  - assignees: ['Copilot']
  - labels: ['ci-failure', 'bug', 'auto']
  - body: エラーログ + 修正指示
  ↓
Copilot Coding Agent が起動
  ↓
エラーを分析
  ↓
修正ブランチ作成 → コミット → PR 提出
  ↓
CI が通過 → マージ可能状態
  ↓
開発者がレビュー → マージ
```

### 8.2 Copilot の記憶ファイル (`.github/copilot-instructions.md`)

Copilot がプロジェクトを理解するための永続的なコンテキスト。

**現在の内容**: プロジェクト概要、スタック、パッケージ構成、TypeScript 設定、コーディング規約、確認コマンド。

**追加推奨事項**:
```markdown
## よくあるエラーと修正方法

### `error TS2552: Cannot find name 'URL'`
原因: tsconfig.json の lib に DOM が含まれていない
修正: `"lib": ["ES2022", "DOM"]` を tsconfig.json に追加

### `error TS2304: Cannot find name 'URLSearchParams'`
同上
```

### 8.3 Renovate Bot 設定 (`renovate.json`)

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:base", ":dependencyDashboard"],
  "packageManager": "pnpm",
  "pnpmfile": true,
  "labels": ["dependencies"],
  "automerge": true,
  "automergeType": "pr",
  "automergeStrategy": "squash",
  "platformAutomerge": true,
  "packageRules": [
    {
      "matchUpdateTypes": ["patch", "minor"],
      "matchPackagePatterns": ["*"],
      "automerge": true,
      "automergeType": "pr"
    },
    {
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "labels": ["dependencies", "breaking-change"]
    },
    {
      "matchPackageNames": ["cloudflare", "wrangler", "@cloudflare/*"],
      "groupName": "Cloudflare packages",
      "automerge": false
    },
    {
      "matchPackageNames": ["hono"],
      "groupName": "Hono",
      "automerge": false
    }
  ],
  "schedule": ["after 3am and before 5am on monday"],
  "timezone": "Asia/Tokyo",
  "prConcurrentLimit": 5,
  "prHourlyLimit": 2
}
```

---

## 9. 全ワークフロー YAML 一覧

| ファイル | トリガー | 目的 | 所要時間 |
|---------|---------|------|---------|
| `.github/workflows/ci.yml` | PR / push to main | typecheck + build + Copilot dispatch | ~3分 |
| `.github/workflows/pr-preview.yml` | PR open/sync | preview デプロイ + URL コメント | ~2分 |
| `.github/workflows/deploy-worker.yml` | push to main / 手動 | 本番デプロイ + D1 migration + smoke test | ~3分 |
| `renovate.json` | 定期（月曜 AM3〜5時） | 依存更新 PR 自動作成 | - |

---

## 10. GitHub Secrets 設定一覧

### 必須 Secrets

| Secret 名 | 用途 | 取得方法 |
|-----------|------|---------|
| `CLOUDFLARE_API_TOKEN` | Worker デプロイ | Cloudflare Dashboard → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Worker デプロイ | Cloudflare Dashboard → Right sidebar |

### 任意 Secrets（設定で通知が有効化）

| Secret 名 | 用途 | 取得方法 |
|-----------|------|---------|
| `TELEGRAM_BOT_TOKEN` | デプロイ成功/失敗通知 | @BotFather |
| `TELEGRAM_CHAT_ID` | デプロイ通知の送信先 | @userinfobot |

### GitHub Actions に必要な Permissions

```yaml
# Issue 自動作成ジョブに必要
permissions:
  issues: write
  contents: read

# PR コメントに必要
permissions:
  contents: read
  pull-requests: write
```

### Secrets の設定コマンド

```bash
# GitHub CLI で設定
gh secret set CLOUDFLARE_API_TOKEN --body "YOUR_TOKEN" --repo ShunsukeHayashi/line-harness-oss
gh secret set CLOUDFLARE_ACCOUNT_ID --body "YOUR_ID" --repo ShunsukeHayashi/line-harness-oss
gh secret set TELEGRAM_BOT_TOKEN --body "YOUR_TOKEN" --repo ShunsukeHayashi/line-harness-oss
gh secret set TELEGRAM_CHAT_ID --body "YOUR_CHAT_ID" --repo ShunsukeHayashi/line-harness-oss
```

---

## 11. DORA Metrics 目標値

| Metric | 現状 | 3ヶ月後 | 6ヶ月後 |
|--------|------|---------|---------|
| デプロイ頻度 | 手動/不定期 | 週複数回 | 1日1回以上 |
| 変更リードタイム | 数時間〜数日 | 1時間以内 | 30分以内 |
| 変更失敗率 | 不明 | 20%以下 | 10%以下 |
| MTTR | 数時間 | 30分以内 | 15分以内 |

### 計測方法

```yaml
# GitHub Actions での計測（将来の改善）
- name: Record deployment metrics
  run: |
    # Deploy time = commit time → deploy complete time
    echo "DEPLOY_TIME=$(date -u +%s)" >> $GITHUB_ENV
    # → BigQuery / Datadog / Grafana Cloud に送信
```

---

## 12. 実装ロードマップ P0/P1/P2

### P0（今すぐ実施 - 本日〜今週）

| 作業 | 内容 | ファイル | 状態 |
|------|------|---------|------|
| P0-1 | TypeScript lib fix | `packages/sdk/tsconfig.json` | ✅ 完了 |
| P0-2 | CI 失敗キャッチ + Copilot dispatch | `.github/workflows/ci.yml` | ✅ 完了 |
| P0-3 | Copilot メモリファイル | `.github/copilot-instructions.md` | ✅ 完了 |
| P0-4 | main 自動デプロイ (D1 migration + smoke) | `.github/workflows/deploy-worker.yml` | 🔄 実装中 |

### P1（今週〜来週）

| 作業 | 内容 | ファイル | 状態 |
|------|------|---------|------|
| P1-1 | PR プレビューデプロイ | `.github/workflows/pr-preview.yml` | 📋 未着手 |
| P1-2 | Renovate Bot 設定 | `renovate.json` | 📋 未着手 |
| P1-3 | lefthook pre-commit | `lefthook.yml` + `pnpm add -D lefthook` | 📋 未着手 |
| P1-4 | /health エンドポイント追加 | `apps/worker/src/index.ts` | 📋 未着手 |

### P2（来月以降 - 改善フェーズ）

| 作業 | 内容 | 効果 |
|------|------|------|
| P2-1 | OIDC 認証 | Secrets レス化、セキュリティ強化 |
| P2-2 | Bundle size monitoring | バンドルサイズを PR ごとに計測・コメント |
| P2-3 | Turbo/moonrepo 導入 | CI を 50% 以上高速化（大規模化後） |
| P2-4 | Playwright E2E テスト | 管理画面の UI 自動テスト |
| P2-5 | DORA Metrics ダッシュボード | デプロイ頻度・リードタイムの可視化 |
| P2-6 | Weekly security audit | `npm audit` 結果を自動 Issue 化 |

---

## 付録: よくある質問

### Q1. Copilot が修正 PR を作成しない場合は？

- GitHub 設定で `Copilot Coding Agent` が有効になっているか確認
- リポジトリが Public または GitHub Copilot Enterprise プランか確認
- Issue の `labels` に `auto` が含まれているか確認

### Q2. D1 migration を間違えてデプロイしてしまったら？

```bash
# 現状確認
wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type='table'"

# 前のマイグレーションを手動で巻き戻す場合
wrangler d1 execute DB --remote --file=rollback.sql
```

### Q3. プレビューデプロイ環境の D1 は何を使う？

- 本番と**別の D1 データベース**を作成する（`wrangler d1 create miyabi-line-crm-preview`）
- wrangler.toml の `[env.preview]` セクションに別の `database_id` を指定

### Q4. lefthook と Husky の違いは？

| ツール | 速度 | monorepo 対応 | 設定 |
|--------|------|--------------|------|
| lefthook | 高速（並列実行） | ◎ | YAML |
| Husky | 普通 | △ | shell |
| lint-staged | 高速（変更ファイルのみ） | △ | JS |

lefthook は並列実行とグロブ対応が強力で、pnpm monorepo に最適。

---

*このドキュメントは `project_memory/` 内の Single Source of Truth として管理する。*
*更新時は末尾に変更履歴を追記すること。*

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-03-25 | 初版作成 |
