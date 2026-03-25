# Sprint P7 — ギャップ解消・マネタイズ基盤構築

**作成日**: 2026-03-25
**目的**: 現状と訴求のギャップを埋め、実際に有料ユーザーを獲得できる状態にする

---

## 現状ギャップまとめ

| ギャップ | 実態 | 影響 |
|---------|------|------|
| /landing が404 | T19実装後に再デプロイ未実施 | LP誰にも見えない |
| AI統合が嘘 | CcPromptButton = clipboardコピーのみ | 最大の訴求ポイントが虚偽 |
| Stripe未稼働 | wrangler secrets未設定 | 課金できない |
| 法務ページなし | Privacy/利用規約/特商法ページなし | 有料販売できない |
| 非技術者が使えない | Cloudflare/wrangler知識必須 | L-step競合に届かない |

---

## DAG（依存関係）

```
T35(再デプロイ) ─┬─→ T36(AI統合)
                ├─→ T37(Stripe)
                ├─→ T38(法務ページ)
                └─→ T40(オンボーディング)

T38 ──────────→ T39(LP改修)
T35 ──────────→ T39(LP改修)
T36 ──────────→ T39(LP改修) ← T36完了後にデモGIF追加

T35 + T37 + T38 + T39 ──→ T41(PPALβ案内)
```

---

## フェーズ別実行計画

### Phase 7-A: 即時修正（今日 / 1時間以内）

| タスク | 内容 | 工数 | agent |
|--------|------|------|-------|
| **T35** | apps/web再ビルド→Cloudflare Pages再デプロイ | 0.5h | kotowari-dev |

**T35実行コマンド:**
```bash
cd /Users/shunsukehayashi/dev/tools/line-harness-oss/apps/web
pnpm build
npx wrangler pages deploy out --project-name line-harness-admin
# 確認
curl -s -o /dev/null -w "%{http_code}" https://line-harness-admin.pages.dev/landing
```

---

### Phase 7-B: 本物の価値を作る（今週 / 並行実行可）

T35完了後、以下3つを並行実行:

| タスク | 内容 | 工数 | agent |
|--------|------|------|-------|
| **T37** | Stripe secrets設定 + テスト決済 | 3h | kotowari-dev |
| **T38** | 法務3ページ（privacy/terms/tokutei） | 4h | kotowari-dev |
| **T40** | オンボーディングウィザード3ステップ | 8h | kotowari-dev |

**T37実行コマンド:**
```bash
# Stripe Dashboardで作成したPrice IDを設定
wrangler secret put STRIPE_PRO_PRICE_ID    # price_xxx
wrangler secret put STRIPE_BUSINESS_PRICE_ID  # price_xxx
wrangler secret put STRIPE_WEBHOOK_SECRET  # whsec_xxx
```

**T38の法務ページ必須記載事項（合同会社みやび）:**
- 会社名: 合同会社みやび
- 代表: 林駿甫
- 住所: 愛知県一宮市（設立後正式住所）
- メール: support@ambitiousai.co.jp
- 返金ポリシー: 月額サブスク・初月返金可
- データ所在地: 米国（Cloudflare）

---

### Phase 7-C: 最重要差別化（今週後半）

| タスク | 内容 | 工数 | agent |
|--------|------|------|-------|
| **T36** | Claude API実接続 → 本物のAI統合 | 8h | kotowari-dev |

**T36実装仕様:**
```
POST /api/ai/analyze
  ├── D1から友だち一覧・タグ・シナリオ・配信履歴取得
  ├── コンテキストJSON構築（最大4000トークン）
  ├── Anthropic API呼び出し（claude-sonnet-4-6）
  └── ストリーミングレスポンスをSSEで返却

CcPromptButton改修:
  ├── ボタン押下 → モーダル表示
  ├── プロンプト選択 → POST /api/ai/analyze 呼び出し
  └── ストリーミングでAI回答をリアルタイム表示
```

---

### Phase 7-D: LP改修（T36完了後）

| タスク | 内容 | 工数 | agent |
|--------|------|------|-------|
| **T39** | LP改修（L-step比較・AI統合デモ・PPAL割引） | 6h | kotowari-dev |

**T39のLP訴求軸（PPALノウハウ転用）:**
```
Hero: 「L-stepに月3万払い続けますか？」
      → 変身ストーリー（L-step依存 → 自社CRM保有）

Feature: L-step vs みやびライン 比較表
         L-step: ¥3,000〜/月・ベンダーロックイン・AI連携なし
         みやびライン: OSS・¥2,980〜/月・Claude AI統合・セルフホスト可

AI Demo: GIF動画「CCに依頼でCRM分析」
         → T36完了後に画面録画してGIF化

PPAL Section: 「PPALメンバー限定 Pro初月無料」
              → クーポンコード配布
              → 「L-stepをすでに使っている人向け乗り換えガイド」リンク

CTA: 「L-stepを卒業する」「無料で始める」
```

---

### Phase 7-E: β案内（全前提タスク完了後）

| タスク | 内容 | 工数 | agent |
|--------|------|------|-------|
| **T41** | PPALメンバーへのβ案内 + 早期アクセスフロー | 2h | main |

**T41実行コマンド（discord-community スキル + LINE配信）:**
```
Discord投稿先: PPALチャンネル
LINE配信先: PPAL会員リスト
内容: 「みやびライン Pro 初月無料」
特典: PPAL会員クーポンコード「PPAL2026」
目標: β申込10名・フィードバック5件
```

---

## 実行優先順位マトリクス

```
高インパクト × 低工数 → 今すぐやる
  T35: 再デプロイ（30分）
  T37: Stripe secrets（1時間）

高インパクト × 高工数 → 今週中に着手
  T36: AI統合（最重要）
  T38: 法務ページ
  T40: オンボーディング

中インパクト × 中工数 → T36完了後
  T39: LP改修

完了条件が揃ったら → ユーザー獲得
  T41: PPALβ案内
```

---

## 成功指標（KPI）

| 指標 | 現在 | 目標（2週間後） |
|------|------|----------------|
| LP表示 | 404 | 200・表示確認 |
| AI統合 | コピーボタン | 実APIコール・回答表示 |
| Stripe | 未稼働 | テスト決済通過 |
| β申込数 | 0 | 10名以上 |
| 有料転換 | 0 | 1件以上 |

---

## agent割り当て

| agent | タスク | ノード |
|-------|--------|--------|
| kotowari-dev | T35, T36, T37, T38, T39, T40 | MacBook Pro |
| main (OpenClaw) | T41 | Gateway |
| 林（手動） | Stripe Dashboard操作・LINE配信承認 | — |
