# みやびライン マスタープラン
# Miyabi Line — AI × LINE 垂直ビジネス自動化プラットフォーム

**Version**: 1.0.0
**作成**: 2026-03-25
**ステータス**: PLANNING → EXECUTION

---

## ゴール（1行）

> **LINEを入口に、AIエージェントが業務を全自動化するB2B SaaSを2026Q2にリリース。**

---

## なぜ今か

| 既存資産 | 状態 |
|---------|------|
| line-harness-oss | 完成（CF Workers + D1 + Next.js） |
| OpenClaw 39エージェント | 稼働中 |
| Miyabi MCP Bundle (172ツール) | 稼働中 |
| Agent Skill Bus | 稼働中 |
| みやびライン発想 | 本日 (2026-03-25) |

**接続するだけで製品になる**。ゼロからは作らない。

---

## ビジネスモデル

```
みやびライン SaaS
├── Starter  ¥9,800/月  — 1業種テンプレ + AI返答500件
├── Pro      ¥29,800/月 — 全業種 + AI無制限 + カスタム
└── Agency   ¥98,000/月 — ホワイトラベル + 代理店向け
```

**Year 1 目標収益**: 50社 × ¥29,800 = **¥1,490万/月**

---

## 製品アーキテクチャ

```
LINEユーザー
  │ (メッセージ/友達追加/ボタンタップ)
  ▼
LINE Platform
  │ Webhook
  ▼
┌─────────────────────────────────────────────────┐
│  みやびライン Gateway (Cloudflare Workers)       │
│  ├── 意図解析 (どの業種モードか)                  │
│  ├── ユーザー状態管理 (D1)                        │
│  └── エージェントルーター                         │
└─────────────────────────────────────────────────┘
  │ タスクディスパッチ (OpenClaw ACP)
  ▼
┌─────────────────────────────────────────────────┐
│  Miyabi Agent Hub (OpenClaw)                    │
│  ├── 業種エージェント (gyosei/scholar/等)        │
│  ├── 共通エージェント (writer/ctx-eng/等)         │
│  └── KPI記録 (Miyabi League連携)                 │
└─────────────────────────────────────────────────┘
  │ 返答生成
  ▼
LINE ユーザーに返信 / 管理者ダッシュボード更新
```

---

## マイルストーン

```
2026-03-25  ← 今日
    │
    ▼
[M0] 基盤接続完了 ────────────── 2026-04-07 (2週間)
  LINE Harness → OpenClaw ブリッジ完成
  1メッセージ → 1エージェント → 1返答 が動く

    │
    ▼
[M1] 士業MVP稼働 ──────────────── 2026-04-28 (4週間)
  行政書士/税理士向け verticalが動く
  β利用者 3社で実証

    │
    ▼
[M2] 3業種展開 + 課金 ─────────── 2026-05-26 (8週間)
  士業 + 美容サロン + 医療クリニック
  Stripe課金 + LP + 申込フロー完成
  有料契約 10社達成

    │
    ▼
[M3] プラットフォーム v1.0 ────── 2026-06-30 (14週間)
  セルフサービス申込
  業種テンプレートマーケット
  代理店パートナー 3社契約
  MRR ¥300万達成
```

---

## 全エージェントアサイン（4トラック並行）

### TRACK A — 技術実装 (MacBook Pro + MainMini)

**担当**: LINE × Miyabi ブリッジ + AI機能実装

| Agent | Node | 役割 | M0タスク | M1タスク |
|-------|------|------|---------|---------|
| **kotowari-dev** | MacBook Pro | リード実装 | LINEブリッジ本体実装 | 業種別ハンドラー実装 |
| **dev-architect** | MainMini | システム設計 | ブリッジアーキテクチャ設計 | スケーラビリティ設計 |
| **dev-coder** | MainMini | 機能実装 | OpenClaw ACP接続実装 | 自動返答フロー実装 |
| **dev-reviewer** | MainMini | コードレビュー | PR全件レビュー | セキュリティレビュー |
| **dev-tester** | MainMini | テスト | 統合テスト作成 | 業種別E2Eテスト |
| **dev-deployer** | MainMini | デプロイ | CF Workers本番デプロイ | 3業種同時デプロイ |
| **dev-documenter** | MainMini | ドキュメント | API仕様書 | 業種設定ガイド |
| **cc-hayashi** | MacBook Pro | CC連携 | Claude Code自律実装 | Codexとの並行実装 |

### TRACK B — ビジネス設計 (MacMini2)

**担当**: 業種モデル設計 + 市場調査

| Agent | Node | 役割 | M0タスク | M1タスク |
|-------|------|------|---------|---------|
| **scholar** | MacMini2 | 市場調査 | L-step/Utage競合分析 | 士業市場規模調査 |
| **gyosei** | MainMini | 士業設計 | 行政書士業務フロー設計 | 税理士対応追加 |
| **ppal-coordinator** | MacMini2 | PM | タスク管理・依存整理 | スプリント管理 |
| **ppal-curriculum** | MacMini2 | オンボーディング | 初期設定ウィザード設計 | 業種別セットアップ手順 |
| **sensei** | MacMini2 | 教育設計 | 管理者向けチュートリアル | 利用者向けFAQ |
| **ppal-analytics** | MacMini2 | 分析 | KPI定義 | β利用者フィードバック分析 |
| **ppal-support** | MacMini2 | サポート設計 | サポートフロー設計 | チャットサポート実装 |

### TRACK C — マーケティング・コンテンツ (MainMini + MacBook Pro)

**担当**: GTM戦略 + LP + SNS展開

| Agent | Node | 役割 | M1タスク | M2タスク |
|-------|------|------|---------|---------|
| **ppal-marketing** | MacMini2 | GTM戦略 | β獲得戦略立案 | 3業種LP展開 |
| **writer (Quill)** | MacMini2 | コピー | LP文章・訴求設計 | 業種別LPコピー |
| **sns-strategist** | MainMini | SNS戦略 | Xで士業向けバズり戦略 | 業種別SNS展開 |
| **sns-analytics** | MacBook Pro | SNS分析 | 競合LINE Bot分析 | 反響測定 |
| **sns-creator** | MainMini | SNSコンテンツ | 週3投稿 (みやびライン紹介) | キャンペーン素材 |
| **content (Pulse)** | MacMini2 | コンテンツ | note記事「AIでLINE自動化」 | メルマガ配信設計 |
| **creator** | MacBook Pro | クリエイティブ | サービスロゴ・バナー | 業種別ビジュアル |
| **x-ops** | Gateway | X運用 | X告知投稿 | キャンペーン自動化 |

### TRACK D — AI機能設計 (MacBook Pro + MainMini)

**担当**: 業種別プロンプト + AI品質

| Agent | Node | 役割 | M0タスク | M1タスク |
|-------|------|------|---------|---------|
| **ctx-eng** | MacBook Pro | プロンプト設計 | 業種別systemPrompt設計 | 返答品質チューニング |
| **promptpro** | MacMini2 | 品質改善 | 士業返答プロンプト改善 | 全業種プロンプト最適化 |
| **architect (Forge)** | MacMini2 | AIフロー | 会話フロー設計 | マルチターン対話設計 |
| **sigma** | MainMini | 分析 | 返答品質メトリクス設計 | 改善効果測定 |
| **cc-agent-1** | MainMini | CC連携 | AIルーティング実装 | 業種判定精度向上 |
| **main** | Gateway | 統括 | 全体調整 + Telegram報告 | 週次進捗報告 |

### TRACK E — セキュリティ・インフラ (MainMini)

**担当**: LINEポリシー準拠 + 安定稼働

| Agent | Node | 役割 | タスク |
|-------|------|------|--------|
| **guardian** | MainMini | セキュリティ | LINE個人情報取扱ポリシー準拠確認 |
| **github-hook** | MainMini | GitHub/CI | PR自動チェック + デプロイパイプライン |
| **dev-deployer** | MainMini | 本番管理 | Cloudflare監視 + エラー対応 |

---

## M0 詳細タスク — 2週間スプリント (2026-03-25 ~ 04-07)

### Week 1 (3/25-3/31): ブリッジ実装

```
Day 1-2: 設計フェーズ
  ├── dev-architect: LINE Harness → OpenClaw 接続設計書作成
  ├── ctx-eng: 業種別意図解析プロンプト v1 作成
  └── scholar: 競合3社 (L-step/Utage/sinkan) 機能比較レポート

Day 3-5: 実装フェーズ
  ├── kotowari-dev + cc-hayashi: LINEブリッジ本体実装
  │   apps/worker/src/ai-router.ts 作成
  │   OpenClaw ACP呼び出し実装
  ├── dev-coder: D1に conversation_sessions テーブル追加
  └── dev-reviewer: PR #44 レビュー

Day 6-7: テスト
  ├── dev-tester: 統合テスト (LINEメッセージ → エージェント → 返答)
  └── guardian: LINE Messaging API利用規約確認
```

### Week 2 (4/1-4/7): 士業プロト

```
Day 1-3: 士業モデル設計
  ├── gyosei: 行政書士の典型的問い合わせ20件リストアップ
  ├── promptpro: 士業向けsystemPrompt最適化
  └── ppal-curriculum: 管理者オンボーディングフロー設計

Day 4-6: プロト完成
  ├── kotowari-dev: 士業ハンドラー実装
  ├── writer: LP初稿作成
  └── dev-deployer: ステージング環境デプロイ

Day 7: M0レビュー
  └── main: 全トラック進捗集計 → Telegram報告
```

---

## M1 詳細タスク — 4週間スプリント (2026-04-08 ~ 04-28)

```
Week 3: β利用者獲得
  ├── ppal-marketing: 士業向け無料β募集 (X + LinkedIn)
  ├── sns-creator: 週3投稿 (「AIが法律相談に答えてみた」)
  └── content: note記事「行政書士事務所の問い合わせを9割自動化した話」

Week 4-5: β実証
  ├── β3社でライブ稼働
  ├── sigma: 返答品質スコアリング
  └── ppal-support: β利用者サポート対応

Week 6: M1レビュー + M2設計
  ├── ppal-analytics: β結果分析レポート
  ├── scholar: 次の2業種 (美容サロン/医療) 市場調査
  └── dev-architect: M2スケーラビリティ設計
```

---

## 技術的な新規実装 (M0で必要なもの)

### 1. ai-router.ts (kotowari-dev担当)

```typescript
// apps/worker/src/ai-router.ts
// LINE Webhook → OpenClaw エージェント → LINE返答

export async function routeToMiyabiAgent(
  userId: string,
  message: string,
  industry: IndustryType // 'gyosei' | 'salon' | 'clinic' | 'general'
): Promise<string> {
  // OpenClaw ACP経由でエージェントにディスパッチ
  const agentId = INDUSTRY_AGENT_MAP[industry]
  const response = await openclaw.agent(agentId, {
    message,
    context: await getUserContext(userId),  // D1から会話履歴
    systemPrompt: INDUSTRY_PROMPTS[industry]
  })
  await saveConversation(userId, message, response)
  return response
}

const INDUSTRY_AGENT_MAP = {
  gyosei:  'gyosei',     // 行政書士/法務
  salon:   'sensei',     // 美容サロン
  clinic:  'sensei',     // 医療クリニック
  general: 'scholar',    // 汎用
} as const
```

### 2. 新規D1テーブル (dev-coder担当)

```sql
-- 会話セッション
CREATE TABLE conversation_sessions (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  industry TEXT NOT NULL,
  messages JSON NOT NULL DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- テナント(業者)設定
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  line_channel_id TEXT NOT NULL,
  agent_config JSON NOT NULL DEFAULT '{}',
  plan TEXT DEFAULT 'starter',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## KPI (Miyabi League と連動)

| マイルストーン | KPI | 目標値 |
|-------------|-----|-------|
| M0 | ブリッジ成功率 | > 95% |
| M1 | β利用者返答満足度 | > 4.0/5.0 |
| M1 | AI返答精度 (士業) | > 85% |
| M2 | 有料契約社数 | 10社 |
| M2 | MRR | ¥300万 |
| M3 | チャーン率 | < 5%/月 |

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| LINE利用規約違反 | guardian が事前確認。自動化は返答のみ（送信制限遵守） |
| AI返答品質が低い | promptpro × ctx-eng で業種プロンプト専門設計 |
| OpenClaw レイテンシ | 非同期処理 + ユーザーへの「考え中...」通知 |
| 競合 (L-step/Utage) | AI機能 + OSS基盤 + 低価格で差別化 |
| スケーリング | Cloudflare Workers は無限スケール (インフラ問題なし) |

---

## 指揮系統

```
林 (ゲームオーナー + 最終判断)
  │
  ▼
main エージェント (週次進捗集計・Telegram報告)
  │
  ├── TRACK A: kotowari-dev (技術リード)
  ├── TRACK B: ppal-coordinator (ビジネス設計)
  ├── TRACK C: ppal-marketing (マーケ)
  ├── TRACK D: ctx-eng (AI品質)
  └── TRACK E: guardian (安全・品質)
```

---

## 次のアクション (今すぐ)

1. **[TRACK A] kotowari-dev** に M0 ブリッジ実装を指示
2. **[TRACK B] scholar** に競合分析タスクを投入
3. **[TRACK D] ctx-eng + gyosei** に士業プロンプト設計を依頼
4. **[TRACK C] writer** に LP初稿作成を依頼
5. **main** に週次進捗管理を設定

---

*"LINEに入力したら、AIが動いて、仕事が終わっている。それがみやびライン。"*
