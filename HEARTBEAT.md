# HEARTBEAT — みやびライン (line-harness-oss)

OpenClaw エージェントが参照するプロジェクト状態ファイル。

---

## プロジェクト基本情報

- **リポジトリ**: `ShunsukeHayashi/line-harness-oss`
- **プロダクト名**: みやびライン
- **スタック**: Cloudflare Workers (Hono v4) + D1 (SQLite) + Next.js 15
- **デプロイ先**: CF Workers `miyabi-line-crm` / CF Pages

## 禁止事項（エージェント共通）

- **upstream (Shudesu/line-harness-oss) への PR は絶対禁止**
- push 先は `ShunsukeHayashi/line-harness-oss` のみ

---

## 自動パイプライン状態

| ワークフロー | ファイル | 状態 |
|------------|--------|------|
| CI Build | `.github/workflows/ci.yml` | 有効 |
| AI Review | `.github/workflows/ai-review.yml` | 有効（Claude Opus 4.6） |
| Auto Merge | `.github/workflows/auto-merge.yml` | 有効 |

### パイプライン動作

```
[auto] Issue → @copilot → Draft PR → CI → AI Review → APPROVE → squash merge
```

---

## 現在の開発状態 (2026-03-26 更新)

### 実装完了（コード済み）

- T01-T09: 基本CRM機能（友だち管理・タグ・シナリオ・オートメーション）
- T11: AI返信 (miyabi-ai-router.ts)
- T12: Stripe課金基盤
- T14: スコアリングエンジン
- T17: イベント駆動オートメーション
- T18: セグメント配信
- T19: ランディングページ (apps/web/src/app/landing/page.tsx)
- T20: Subscriptions + Stripe Webhook
- T22: event-bus.ts score_threshold バグ修正
- T35: 管理画面・LP 再デプロイ
- T36: Claude API 実接続 (CcPromptButton → /api/ai/analyze)

### アクティブタスク (P7スプリント)

- **T42 [CRITICAL]**: /health バージョン注入 (Issue #44/#46) → Copilot投入待ち
- **T43 [HIGH]**: ログイン同意チェックボックス (Issue #45) → Copilot投入待ち
- **T38 [HIGH/in_progress]**: 法務ページ完成 → 新規Issue投入予定
- **T37 [HIGH]**: Stripe本番設定 → 林（手動）作業
- **T39 [HIGH]**: LP改修 → T38完了後
- **T40 [MEDIUM]**: オンボーディングウィザード → T38完了後
- **T41 [MEDIUM]**: PPALメンバーβ案内 → T37+T38+T39+T40完了後

### Identity Hub フェーズ (後続)

- T44 (#47): unified_profiles migration
- T45 (#48): Discord OAuth
- T46 (#49): Teachable Webhook LIFF連携
- T47 (#52): getPlan() ミドルウェア

### タスク分解ドキュメント

- `project_memory/TASK_DECOMPOSITION.md` — 完全なDAG・インパクト試算・アサイン表

---

## エージェントへの指示

### mainエージェントへの送信方法

```bash
ssh macbook "openclaw agent -m 'みやびライン: [指示内容]' --agent main"
```

### Issue 作成（Copilot自動実装）

```bash
gh issue create --repo ShunsukeHayashi/line-harness-oss \
  --title "[auto] feat: [機能名]" \
  --body "[要件]"
```

### よく使うコマンド

```bash
pnpm dev:worker              # Workers ローカル
pnpm dev:web                 # Next.js dev
pnpm -r build                # 全体ビルド
pnpm --filter worker typecheck
pnpm deploy:worker
pnpm db:migrate
pnpm db:migrate:local
```

---

## 監視項目

- CI/CD: GitHub Actions の状態
- AI Review: `.github/workflows/ai-review.yml` の実行結果
- Workers: CF Dashboard `miyabi-line-crm`
- D1: database_id `2b9355ee-ddef-45d1-bca1-06a0a029ff83`

---

*最終更新: 2026-03-26*
