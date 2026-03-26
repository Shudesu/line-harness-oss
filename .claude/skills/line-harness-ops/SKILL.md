# line-harness-ops — みやびライン 自動パイプライン実行スキル

**Triggers**: 実装して, 追加して, 修正して, バグ直して, 〇〇したい, feature, fix, implement

---

## 最重要ルール: Claude Code はコードを書かない

このプロジェクトでは **Claude Code が直接 `apps/` や `packages/` のコードを書くことを禁止する。**
新機能・バグ修正はすべて以下のパイプラインに通す。

```
Claude Code (要件定義・Issue作成)
  → Copilot Coding Agent (自動実装・Draft PR)
    → CI: pnpm -r build + typecheck
      → Claude Opus 4.6 AI レビュー
        → 自動 squash merge
```

---

## 実装依頼の手順（これだけ覚えればいい）

### 1. Issue を作る（1コマンドで完了）

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
- {具体的な要件3}

## 対象ファイル（わかる場合）
- \`apps/worker/src/routes/...\`
- \`packages/db/migrations/...\`

## 完了条件
- [ ] pnpm -r build が通る
- [ ] {動作確認の条件}"
```

**ラベルは必ず `copilot,auto` を両方付ける。**

### 2. 待つ（全自動）

| ステップ | 担当 | 所要時間 |
|---------|------|---------|
| Draft PR 作成 | Copilot Coding Agent | 5〜15分 |
| CI (build + typecheck) | GitHub Actions | 3〜5分 |
| CI失敗なら自動修正 | Copilot | 5〜10分 |
| AI コードレビュー | Claude Opus 4.6 | 1〜3分 |
| APPROVE → 自動マージ | auto-merge.yml | 即時 |

### 3. 確認（任意）

```bash
# PR 一覧
gh pr list --repo ShunsukeHayashi/line-harness-oss

# CI 状態
gh pr checks {PR番号} --repo ShunsukeHayashi/line-harness-oss

# PRの差分確認
gh pr diff {PR番号} --repo ShunsukeHayashi/line-harness-oss
```

---

## パイプラインを使う・使わないの判断

### パイプライン（デフォルト）
- 新機能追加（APIエンドポイント、UI、DB列）
- バグ修正（再現手順が明確）
- リファクタリング（範囲明確）
- テスト追加
- ドキュメント更新

### Claude Code が直接やる（例外のみ）
- `.github/workflows/` の変更（Security Gate でブロックされる）
- セキュリティ修正（シークレット・認証）
- `git merge upstream/main`（upstream sync）
- `pnpm db:migrate` の実行（SQL 確認後の手動実行）
- 緊急ホットフィックス（5分以内に直す必要がある）

---

## Issue 本文の書き方（Copilot に伝わるポイント）

### よい例
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

### よくない例（Copilot が迷う）
```
友だち一覧をもっとよくして  ← NG: 曖昧すぎる
```

---

## 止まったときの対処

```bash
# Copilot が動いていない → copilot ラベルを付け直す
gh issue edit {ISSUE番号} --add-label "copilot" --repo ShunsukeHayashi/line-harness-oss

# AI レビューが来ない → ai-review ラベルを付ける
gh pr edit {PR番号} --add-label "ai-review" --repo ShunsukeHayashi/line-harness-oss

# CI ログを見る
gh run list --repo ShunsukeHayashi/line-harness-oss --limit 5
gh run view {RUN_ID} --repo ShunsukeHayashi/line-harness-oss --log-failed

# 手動マージ（どうしても自動マージされない場合）
gh pr merge {PR番号} --squash --delete-branch --repo ShunsukeHayashi/line-harness-oss
```

---

## 開発・運用コマンド

```bash
# 作業ディレクトリ
cd ~/dev/tools/line-harness-oss

# ビルド・型チェック
pnpm -r build
pnpm --filter worker typecheck

# ローカル開発
pnpm dev:worker   # Wrangler dev (Workers)
pnpm dev:web      # Next.js

# デプロイ
pnpm deploy:worker   # CF Workers (miyabi-line-crm)
pnpm deploy:web      # CF Pages

# D1
pnpm db:migrate        # 本番
pnpm db:migrate:local  # ローカル
wrangler d1 execute miyabi-line-crm-db --command "SELECT count(*) FROM friends"
wrangler d1 execute miyabi-line-crm-db --local --command "SELECT count(*) FROM friends"

# ログ
wrangler tail miyabi-line-crm --format=pretty

# Issue 確認
gh issue list --repo ShunsukeHayashi/line-harness-oss --state open
```

---

## Wrangler 設定

| 項目 | 値 |
|-----|-----|
| Workers 名 | `miyabi-line-crm` |
| D1 database_id | `2b9355ee-ddef-45d1-bca1-06a0a029ff83` |
| D1 バインディング | `DB` |
| 設定ファイル | `apps/worker/wrangler.toml` |

### Secret 設定

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put API_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put STRIPE_PRO_PRICE_ID
wrangler secret put STRIPE_BUSINESS_PRICE_ID
wrangler secret put GITHUB_TOKEN        # CI Issue自動作成用
wrangler secret put GITHUB_REPO         # "ShunsukeHayashi/line-harness-oss"
```

---

## OpenClaw 連携

```bash
ssh macbook "openclaw agent -m 'みやびライン: {内容}' --agent main"
```

---

## 禁止事項（絶対）

- `Shudesu/line-harness-oss` への PR（永久禁止）
- `git push` で upstream に push
- Claude Code が `apps/` や `packages/` のコードを直接書く（パイプライン外で）
