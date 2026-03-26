# みやびライン 完全マスタープラン v2.0
# ShunsukeHayashi/line-harness-oss — 独自SaaS路線

**作成日**: 2026-03-26
**バージョン**: 2.0.0 (Upstream貢献戦略を完全削除・独自路線に再構成)
**ステータス**: ACTIVE
**方針**: Upstream への PR・貢献は永久停止。みやびライン独自SaaSとして単独開発。

---

## 1. ビジョン & ポジショニング

```
Lステップ (¥21,780/月)  ← 非技術者向けSaaS
         ↕ 上位互換
みやびライン (月額従量)  ← PPAL × AI × Stripe × MCP
  - PPAL受講生 → βユーザー
  - AI自動応答（Claude Haiku）
  - LINE CRM MCP Tools
  - スコアリング & セグメント配信
```

**3つの独自性**:
| 差別化軸 | 内容 | 競合にあるか |
|---------|------|------------|
| MCPツール統合 | LINE CRM操作をAIから直接実行 | NO（唯一） |
| PPAL連携 | AI教育コース受講生への自動LINEフォロー | NO |
| AI診断シナリオ | 7問診断 → プロダクトマッチング → ステップ配信 | BKStockのみ |

---

## 2. アーキテクチャ全体図

```
┌─────────────────────────────────────────────────────────────┐
│  LINE ユーザー                                               │
│  (友だち登録 → LIFF → Webhook → Worker)                     │
└─────────────────────────┬───────────────────────────────────┘
                           │ HTTPS
┌─────────────────────────▼───────────────────────────────────┐
│  Cloudflare Workers (Hono v4)                               │
│  miyabi-line-crm.supernovasyun.workers.dev                  │
│                                                             │
│  routes/                                                    │
│  ├─ webhook.ts     ← LINE Webhookハンドラ                   │
│  ├─ friends.ts     ← 友だち管理API                         │
│  ├─ scenarios.ts   ← シナリオ・ステップ管理                  │
│  ├─ automations.ts ← オートメーション設定                   │
│  ├─ stripe.ts      ← Stripe課金API ← T37                   │
│  └─ liff.ts        ← LIFF API                              │
│                                                             │
│  services/                                                  │
│  ├─ event-bus.ts   ← コアイベント処理 [BUG: score_threshold]│
│  ├─ scoring.ts     ← スコアリングエンジン                   │
│  ├─ step-delivery.ts ← シナリオ配信                        │
│  └─ miyabi-ai-router.ts ← AI返信ルーター                   │
└─────────────────────────┬───────────────────────────────────┘
                           │ D1 SQL
┌─────────────────────────▼───────────────────────────────────┐
│  Cloudflare D1 (SQLite)                                     │
│  ID: 2b9355ee-ddef-45d1-bca1-06a0a029ff83                   │
│  migrations/001〜010 (friends/scenarios/stripe/forms...)    │
└─────────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────▼───────────────────────────────────┐
│  Next.js 15 管理画面 (Cloudflare Pages)                     │
│  ├─ 友だち一覧・詳細・タグ管理                               │
│  ├─ シナリオ・ステップ管理                                   │
│  ├─ スコアリングルール管理UI ← T31                          │
│  └─ CSVエクスポート ← T32                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. GNIコードグラフ概要 (2026-03-26)

| 指標 | 値 |
|------|-----|
| シンボル数 | 2,528 |
| リレーション数 | 3,901 |
| 実行フロー数 | 102 |
| ファイル数 | 218 |
| コミット (HEAD) | 7dc6c91 |

**コアシンボル (影響度HIGH)**:

```
fireEvent (event-bus.ts)
  ├── processScoring          ← BUG: 並列実行でcurrentScoreが渡らない
  ├── processAutomations      ← score_threshold が常にundefinedを評価
  ├── processNotifications
  └── fireOutgoingWebhooks

handleWebhook (webhook.ts)
  ├── fireEvent
  ├── Onboarding:Started タグ付与 (L148-161)
  └── step-delivery

miyabiAiRouter (miyabi-ai-router.ts)
  └── LINE Messaging API → AI返信
```

---

## 4. 緊急バグ修正 (独立タスク — 最優先)

### event-bus.ts score_threshold バグ

**発見者**: meomao fork (michisirube)
**重要度**: CRITICAL (scoring条件が全て機能しない)

```typescript
// ❌ 現在 (apps/worker/src/services/event-bus.ts L39-44)
await Promise.allSettled([
  fireOutgoingWebhooks(db, eventType, payload),
  processScoring(db, eventType, payload),      // 並列 → currentScore未確定
  processAutomations(db, eventType, payload),  // score_threshold = undefined
  processNotifications(db, eventType, payload),
]);

// ✅ 修正後
await Promise.allSettled([
  fireOutgoingWebhooks(db, eventType, payload),
  processScoring(db, eventType, payload),
]);
// scoringが確定してからautomationsを実行
if (payload.friendId) {
  const currentScore = await getFriendScore(db, payload.friendId);
  payload.eventData = { ...payload.eventData, currentScore };
}
await Promise.allSettled([
  processAutomations(db, eventType, payload, lineAccessToken, lineAccountId),
  processNotifications(db, eventType, payload, lineAccountId),
]);
```

**アクション**: Copilotに `[auto] fix(event-bus): score_threshold バグ修正` Issueとして投入

---

## 5. タスク依存関係グラフ

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  みやびライン アクティブタスク 依存関係グラフ (2026-03-26)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【即時着手可能 — 依存なし】

  [BUG]  event-bus バグ修正 ─────────────────────┐
         (score_threshold / CRITICAL)             │
                                                   ▼
  [T37]  Stripe本番設定 ────────────────────────► [T38] 法務ページ ──► [T39] LP改修
         wrangler secrets                          プライバシーポリシー    L-step比較
         テスト決済通過                             特定商取引法          AI統合デモ
         [HIGH / P7]                               [HIGH / P7]          [HIGH / P7]
                │                                         │
                │                                         │
                ▼                                         ▼
  [T40] オンボーディングウィザード ◄──────────────────────┘
        LINEチャネル接続3ステップ
        [MEDIUM / P7]
                │
                ▼
  [T41] PPALメンバー β案内
        早期アクセスフロー
        [MEDIUM / P7]
                │
                ▼
  [T34] PPALユーザー β案内
        早期アクセス提供
        [HIGH / P4]


【機能追加フェーズ (P6) — T37完了後に着手可能】

  [T31] スコアリングルール管理UI ─────────────────┐
        管理画面に編集UI追加                        │
        [MEDIUM / P6]                              │
                                                    ▼
  [T32] 友だちCSVエクスポート                [全機能揃う]
        管理画面ボタン + APIエンドポイント          │
        [MEDIUM / P6]                              ▼
                                          [SaaS正式公開]
  [T28] E2Eテストスイート
        vitest / 60%+カバレッジ
        [MEDIUM / P6]


【コード整備 (P5) — 並行可】

  [T24] PPAL固有コードを ppal/ に分離
        ディレクトリ構造整理
        [MEDIUM / P5]


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  実行優先度マトリクス
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  CRITICAL ─── BUG (event-bus)         → 今すぐ Copilot Issue
  HIGH     ─── T38 (法務) → T37(Stripe)→ 今週中
             └─ T39 (LP改修)            → 今週中
  HIGH     ─── T34 (PPALβ案内)         → 法務完了後
  MEDIUM   ─── T40/T41 (オンボード/β)  → LP完成後
  MEDIUM   ─── T31/T32/T28             → SaaSリリース後の強化フェーズ

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 6. SaaSリリースロードマップ（時系列）

```
Week 1 (今週)
├── [Day 1]  event-bus バグ修正 → Copilot Issue投入
├── [Day 2]  T38: 法務ページ (プライバシーポリシー・特商法)
├── [Day 3]  T37: Stripe本番 secrets設定 + テスト決済
└── [Day 5]  T39: LP改修 (L-step比較表・AI統合デモ)

Week 2
├── T40: オンボーディングウィザード (LINEチャネル3ステップ)
├── T41: PPALメンバーβ案内 + 早期アクセスフロー
└── T34: PPALユーザーへの正式β案内

Week 3〜4 (SaaS強化)
├── T31: スコアリングルール管理UI
├── T32: 友だちCSVエクスポート
├── T28: E2Eテストスイート
└── [NEW] AI自動応答機能 (Claude Haiku, BKStock参考)

Month 2
├── T24: PPAL固有コード分離 (リファクタリング)
├── [NEW] LIFF会員マイページ (daisukeishioka参考)
├── [NEW] 収益ダッシュボード (BKStock参考)
└── 正式リリース・価格設定公開
```

---

## 7. CI/CDパイプライン (現状)

```
ローカル変更
    │
    ▼ git push
Stage1: CI (ci.yml)
  ├── typecheck (worker + web) 並列
  ├── pnpm -r build
  └── 失敗 → Copilot Coding Agent に自動アサイン → 修正PR

    │ PR作成
    ▼
Stage2: PR Preview (pr-preview.yml) ← 未着手(P1-1)
  └── wrangler deploy --env preview

    │ PRマージ → main
    ▼
Stage3: 本番デプロイ (deploy-worker.yml)
  ├── D1 migration auto-apply
  ├── wrangler deploy (本番)
  ├── スモークテスト curl /health
  └── Telegram通知

    │ 定期
    ▼
Stage4: AI自己修復ループ
  ├── Renovate Bot (patch/minor auto-merge)
  └── Copilot Coding Agent (CI失敗 → 修正PR)
```

**CI/CDPending作業** (CI_CD_BEST_PRACTICES.md P1より):
- `P1-1`: PR プレビューデプロイ (`pr-preview.yml`)
- `P1-2`: Renovate Bot (`renovate.json`) ← 既に追加済み
- `P1-3`: lefthook pre-commit
- `P1-4`: `/health` エンドポイント追加

---

## 8. マルチエージェント実行体制

```
Claude Code (ローカル MacBook)
  │ 設計・レビュー・Issue作成
  │
  ├──► Copilot Coding Agent (GitHub Cloud)
  │    Issue → 自動実装 → Draft PR
  │    適任: バグ修正・機能追加・E2Eテスト・法務ページHTML
  │
  ├──► kotowari-dev (OpenClaw MacBook Worker)
  │    KOTOWARI専属だが line-harness の複雑な実装も対応可
  │    適任: event-bus修正・Stripe実装・AI統合
  │
  └──► Claude Opus 4.6 (CI: ai-review.yml)
       PR → 自動レビュー → APPROVE → auto-merge
```

### Copilot投入コマンドテンプレート

```bash
gh issue create \
  --repo ShunsukeHayashi/line-harness-oss \
  --title "[auto] fix(event-bus): score_threshold バグ修正" \
  --label "copilot,auto,bug" \
  --body "## 問題
processScoring と processAutomations が並列実行されるため、
score_threshold 条件評価時に currentScore が undefined になる。

## 修正内容
apps/worker/src/services/event-bus.ts の Promise.allSettled を
2フェーズに分割 (Phase1: scoring, Phase2: automations)

## 完了条件
- [ ] pnpm -r build が通る
- [ ] score_threshold >= N のオートメーションが正しく発火する"
```

---

## 9. 競合差別化マトリクス

| 機能 | BKStock | daisukeishioka | meomao | **みやびライン** |
|------|---------|----------------|--------|----------------|
| AI自動応答 | ✅ (Haiku) | — | — | 🔜 (Phase2) |
| Stripe課金 | — | ✅ 口座振替も | — | ✅ (T37) |
| LIFF会員ページ | — | ✅ | — | 🔜 (Month2) |
| 収益ダッシュボード | ✅ | — | — | 🔜 (Month2) |
| チャーン予測 | ✅ | — | — | 🔜 (Month2) |
| MCP統合 | ❌ | ❌ | ❌ | ✅ **唯一** |
| PPAL連携 | ❌ | ❌ | ❌ | ✅ **唯一** |
| score_threshold修正 | — | — | ✅ | ✅ (今週) |
| E2Eテスト | — | — | — | 🔜 (T28) |

---

## 10. 成功指標 (KPI)

| 指標 | 1ヶ月目標 | 3ヶ月目標 |
|------|----------|----------|
| PPALβユーザー | 5社 | 20社 |
| 月次収益 (MRR) | ¥0 → ¥50,000 | ¥150,000 |
| PPAL月2万削減達成 | ✅ | — |
| デプロイ頻度 | 週複数回 | 1日1回+ |
| テストカバレッジ | 40% | 60%+ |

---

## 11. リポジトリ情報

| 項目 | 値 |
|------|-----|
| **Our Fork** | https://github.com/ShunsukeHayashi/line-harness-oss |
| **ローカルパス** | `~/dev/tools/line-harness-oss/` |
| **Upstream** | 参照のみ。PR・コントリビューション**永久禁止** |
| **本番Worker** | `miyabi-line-crm.supernovasyun.workers.dev` |
| **D1 database_id** | `2b9355ee-ddef-45d1-bca1-06a0a029ff83` |
| **CF Pages (Admin)** | Next.js 15 (CF Pages) |

---

## 12. 変更履歴

| 日付 | バージョン | 変更内容 |
|------|----------|---------|
| 2026-03-25 | 1.0.0 | 初版作成 (Upstream貢献戦略含む) |
| 2026-03-26 | 2.0.0 | **Upstream貢献戦略を完全削除**。みやびライン独自SaaS路線に再構成。T23/T27/T29/T30/T33をキャンセル。依存関係グラフ追加。 |
