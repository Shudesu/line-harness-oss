# みやびライン — AIデータガバナンス仕様 (AI_DATA_GOVERNANCE)

**作成日**: 2026-03-26
**重要度**: CRITICAL（T38法務ページの前提条件）
**根拠**: OpenClaw main エージェント (みやび) — エンタープライズ販売の必須要件として指摘

---

## 概要

みやびラインはLINEユーザーのメッセージ・行動データを取得し、AI機能（Claude API）に送信する。
個人情報保護法・Stripe利用規約・LINE利用規約・GDPR（将来対応）に準拠した処理を行う。

---

## データフロー図

```
LINEユーザー
  │ メッセージ送信
  ▼
LINE Platform → Webhook → Cloudflare Workers
  │
  ├─ D1 (SQLite) に保存:
  │   friends: lineUserId, displayName, pictureUrl
  │   messages: content (暗号化予定), timestamp
  │
  └─ AI処理時:
      ┌─────────────────────────────────────┐
      │ PII除去フィルター（実装必須）        │
      │ lineUserId → 匿名ID (hash)          │
      │ displayName → 除去                  │
      │ 電話番号・住所 → [REDACTED]          │
      └─────────────────────────────────────┘
              │
              ▼
      Anthropic API (Claude)
      ※ Anthropic の利用規約上、
        API経由のデータはモデル学習に使用されない
              │
              ▼
      AI応答 → Cloudflare Workers → LINEユーザーに返信
```

---

## プライバシーポリシー必須記載事項（T38 用）

### 取得する情報

```
1. LINEユーザーID（lineUserId）
2. 表示名（displayName）
3. プロフィール画像URL（pictureUrl）
4. 送受信メッセージ内容
5. LINE公式アカウントとのやり取り履歴
6. クリック・開封履歴（追跡リンク経由）
7. タグ・スコアリングデータ（行動分析結果）
```

### 利用目的

```
1. LINE CRM機能の提供（友だち管理・シナリオ配信）
2. AI自動応答機能（Claude API経由）
3. マーケティング分析・セグメント配信
4. サービス改善・不正利用防止
```

### 第三者提供（必須明記）

```
提供先: Anthropic, PBC（Claude API）
目的: AI自動応答・コンテンツ生成の処理
データ種別: メッセージ内容（PII除去後）
Anthropicのプライバシーポリシー: https://www.anthropic.com/privacy

提供先: Stripe, Inc.
目的: 決済処理
データ種別: 課金情報（当社はカード番号を保持しない）
Stripeのプライバシーポリシー: https://stripe.com/privacy

提供先: Cloudflare, Inc.
目的: インフラ・データベース（D1）ホスティング
データの保存場所: 米国（Cloudflare データセンター）
```

### オプトアウト（AIデータ処理）

```
ユーザーはAI自動応答のオプトアウトを選択できる:
1. LINEメニューの「AI返信設定」でOFFに変更
2. または「AI返信オフ」とメッセージを送信
3. オプトアウト後: 人間オペレーター（管理者）が手動で返信

実装: friends テーブルに ai_consent BOOLEAN DEFAULT true を追加（T38前後に実装）
```

---

## 技術実装仕様

### PII除去フィルター（実装タスク: M1フェーズ）

```typescript
// apps/worker/src/services/pii-filter.ts (新規作成)
export function sanitizeForAI(message: string): string {
  // 電話番号
  let sanitized = message.replace(/0\d{1,4}-?\d{1,4}-?\d{4}/g, '[電話番号]');
  // メールアドレス
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[メール]');
  // 住所パターン（都道府県）
  sanitized = sanitized.replace(/[都道府県].{1,10}[市区町村]/g, '[住所]');
  // クレジットカード番号
  sanitized = sanitized.replace(/\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, '[カード番号]');
  return sanitized;
}

export function buildAIContext(friend: Friend, recentMessages: Message[]): string {
  return `
ユーザー情報:
- ID: ${hashUserId(friend.lineUserId)}  // lineUserId は送らない
- スコア: ${friend.score}
- タグ: ${friend.tags.join(', ')}
- 登録日: ${friend.createdAt}

直近メッセージ（最大5件）:
${recentMessages.map(m => sanitizeForAI(m.content)).join('\n')}
`.trim();
}
```

### ai_consent フィールド追加（マイグレーション）

```sql
-- packages/db/migrations/011_ai_consent.sql (T38前後に作成)
ALTER TABLE friends ADD COLUMN ai_consent BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE friends ADD COLUMN ai_consent_updated_at TIMESTAMP;

-- インデックス
CREATE INDEX idx_friends_ai_consent ON friends(ai_consent);
```

---

## Anthropic API利用規約との適合確認

| 要件 | 状態 | 対応 |
|------|------|------|
| APIデータは学習に使用されない | 確認済み | Anthropic API利用規約 §5.2 |
| データ保持期間 | Anthropicは30日（ログのみ） | プライバシーポリシーに明記 |
| 18歳未満への送信禁止 | 対応必要 | LINE公式アカウントの利用規約で担保 |
| 有害コンテンツフィルター | 対応必要 | システムプロンプトでフィルタリング |

---

## LINE Messaging API利用規約との適合確認

| 要件 | 状態 |
|------|------|
| ユーザーデータの第三者提供制限 | プライバシーポリシーで同意取得 |
| データ保管期間 | friends: 退会後30日、messages: 1年 |
| マーケティング目的の明示 | 友だち追加時のウェルカムメッセージで告知 |

---

## エンタープライズ販売時の追加対応

法人顧客（Business プラン以上）向けには以下を提供:

1. **DPA（データ処理契約）**: Cloudflare/Anthropicとのデータ処理契約書のコピーを提供
2. **セキュリティ説明書**: D1暗号化・Cloudflare WAF・rate limitingの技術仕様
3. **インシデント対応SLA**: 個人データ漏洩時の72時間以内通知コミットメント

---

## レビュー・更新スケジュール

| トリガー | アクション |
|---------|----------|
| T38 法務ページ実装前 | このドキュメントをレビューし、プライバシーポリシー文面に反映 |
| AI新機能追加時 | データフロー図とPII処理仕様を更新 |
| Anthropic利用規約更新時 | 適合確認を再実施 |
| 年1回 | 全体レビュー |
