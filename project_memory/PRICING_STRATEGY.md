# みやびライン — 価格戦略 (PRICING_STRATEGY)

**作成日**: 2026-03-26
**根拠**: OpenClaw main エージェント (みやび) レコメンデーション

---

## 価格ポジショニング

```
L-step       ¥21,780/月 (スタンダード)
              ↑ 圧倒的コスト優位
みやびライン  Free / Pro / Business + コンサル
              + PPAL受講生割引
```

---

## プラン定義

### Free（無料 / 永久）

| 項目 | 制限 |
|------|------|
| 友だち数 | 最大100名 |
| 月間メッセージ | 500通 |
| シナリオ | 3本 |
| AI返信 | なし |
| Stripe課金 | なし |

**Stripe Product ID**: なし（課金なし）
**対象**: 試用・個人ブロガー・スタートアップ初期

---

### Pro（¥2,980/月）

| 項目 | 制限 |
|------|------|
| 友だち数 | 最大3,000名 |
| 月間メッセージ | 無制限 |
| シナリオ | 無制限 |
| AI返信 | Claude Haiku 月1,000回 |
| Stripe課金 | あり（Checkout / Portal） |
| MCP Tools | あり（LINE操作をAIから） |

**Stripe Product ID**: `prod_miyabi_pro` (要作成)
**Stripe Price ID**: `price_2980_jpy_monthly` (要作成)
**対象**: 個人事業主・小規模ECサイト・コーチ・コンサル

---

### Business（¥9,800/月）

| 項目 | 制限 |
|------|------|
| 友だち数 | 無制限 |
| 月間メッセージ | 無制限 |
| シナリオ | 無制限 |
| AI返信 | Claude Sonnet 無制限 |
| セグメント配信 | 高度スコアリング |
| CSVエクスポート | あり |
| 優先サポート | あり |

**Stripe Product ID**: `prod_miyabi_business` (要作成)
**Stripe Price ID**: `price_9800_jpy_monthly` (要作成)
**対象**: 中小企業・ECサイト・サロン・スクール

---

### PPALメンバー割引（限定オファー）

| 対象 | 特典 | 期限 |
|------|------|------|
| PPAL受講生 (βテスト10名) | Pro 初月無料 | 2026-04-30 |
| PPAL受講生 (通常) | Pro 20%OFF永続 | 2026-12-31 |
| PPAL Alumni | Business 初月50%OFF | 2026-06-30 |

**Stripe Coupon ID**: `miyabi_ppal_beta` / `miyabi_ppal_discount` (要作成)

---

### コンサル・高額セット（法人向け）

| パッケージ | 価格 | 内容 |
|-----------|------|------|
| スタータセット | ¥98,000 (一括) | 初期設定 + Business 3ヶ月 + 個別サポート5時間 |
| 年間コンサル | ¥480,000/年 | Business 12ヶ月 + 月次レビュー + 優先実装 |
| LINE集客設計 | ¥198,000 (一括) | シナリオ設計 + AI診断 + 研修 |

**対象**: L-step 乗り換え企業・初めてLINE公式を導入する中小企業

---

## 機能制限の境界線

```
Free       → Pro: AI返信 / 無制限メッセージ / MCPツール
Pro        → Business: Sonnet / セグメント高度化 / CSV / 優先サポート
Business   → コンサル: 個別実装 / 研修 / SLAサポート
```

---

## Stripe 設定手順（T37 実施時）

```bash
# 1. 商品作成
stripe products create --name "みやびライン Pro" --description "AI LINE CRM Pro"
stripe products create --name "みやびライン Business" --description "AI LINE CRM Business"

# 2. 価格作成
stripe prices create --unit-amount 2980 --currency jpy --recurring[interval]=month --product prod_xxxxx
stripe prices create --unit-amount 9800 --currency jpy --recurring[interval]=month --product prod_yyyyy

# 3. wrangler secrets 設定
wrangler secret put STRIPE_PRO_PRICE_ID
wrangler secret put STRIPE_BUSINESS_PRICE_ID
```

---

## 月次収益目標

| フェーズ | 目標ユーザー | MRR目標 |
|---------|------------|--------|
| M0 (βテスト) | 10名 Pro | ¥0 (無償) |
| M1 (公開β) | 30名 Pro + 5名 Business | ¥138,100 |
| M2 (成長期) | 100名 Pro + 20名 Business | ¥494,000 |
| M3 (安定期) | 300名 Pro + 50名 Business | ¥1,384,000 |

**ブレークイーブン**: L-step月額¥21,780 → M0完了時点で即黒字化（コスト¥0）
