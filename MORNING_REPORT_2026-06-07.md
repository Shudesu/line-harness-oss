# 朝の報告 — 2026-06-07

おはようございます。夜通し進めて、Phase 1 と Phase 3 の大半が完成しました。
本番デプロイも全部済んでいます。

## ✅ 完了したもの (本番デプロイ済み)

| Phase | 機能 | URL | やったこと |
|---|---|---|---|
| **1-A** | あいさつメッセージ | `/greeting` | 友だち追加時の自動メッセージを編集できる UI。プレビュー付き |
| **1-B** | CRM forward | `/crm-forwards` | エルメ等への webhook 並行転送 (既に commit 済) |
| **1-G** | Token 暗号化 (ベータ) | `/token-encryption` | AES-GCM 256bit で channel_access_token を暗号化保存 |
| **1-H** | fingerprint 同意 | `/fingerprint-policy` | IP/UA を 90日で自動削除 + 同意撤回で即時全削除 |
| **3-F1** | Lark 連携 | `/lark-notifications` | 友だち追加・ブロック・フォーム回答を Lark に通知 |
| **3-I** | 運用ランブック | `RUNBOOK.md` | デプロイ・トラブルシュート・バックアップの完全マニュアル |
| **iOS 引継ぎ** | 別セッション用文書 | `docs/iOS_HANDOFF.md` | Swift + APNs + Sign in with Apple の完全引継ぎ |

## 📊 デプロイ詳細

```
Worker  Version:  0946904a-03a7-4674-b996-0d30f3999883
Pages   URL:      https://8e097a46.hyhome-harness-admin-0cdf2440.pages.dev
D1      migration 062 (Lark) + 063 (fingerprint retention) 適用済み
git     main = a4ddf1e (push 済み)
```

全 5 つの新規 UI URL が **HTTP 200** 応答、Worker API が **HTTP 401** (認証必須) を正しく返すことを確認。

## 🛡️ セキュリティ強化 (Codex レビューで指摘 → 全反映)

| 重大度 | 内容 | 対応 |
|---|---|---|
| 高 | migrate API が認証だけで通る | `requireRole('owner')` 追加 + `?confirm=force` ゲート |
| 高 | fingerprint policy も同様 | `requireRole('owner'/'admin')` 追加 |
| 中 | datetime 文字列直比較 | `datetime(clicked_at) < datetime(...)` に変更 |
| 中 | 暗号化フォーマット偶発衝突 | base64 長さ + 文字種を厳密検証 |
| 中 | 'global' magic ID が衝突しうる | `'__system__'` に変更 |
| 低 | account_name placeholder バグ | `line_accounts.name` を引くように |
| 低 | `display_name` カラム名違い | `name` に修正 (元々あった既存バグも修正) |

## 🎬 前田さんが朝やること (10〜15 分で完了)

### ① Lark 連携の有効化 (最優先)

ターミナルを開いて、以下を順に：

```bash
cd ~/hyhome/ads/line/harness/fork/apps/worker
pnpm exec wrangler secret put LARK_APP_ID --config wrangler-prod.toml
# → LINE エージェントの App ID を貼り付け
pnpm exec wrangler secret put LARK_APP_SECRET --config wrangler-prod.toml
# → LINE エージェントの App Secret を貼り付け
```

確認:
- https://hyhome-harness-admin-0cdf2440.pages.dev/lark-notifications を開く
- 「✅ Lark 認証 OK」が緑色で表示されればOK
- 「＋ 新規追加」で通知設定を作って「テスト送信」

### ② あいさつメッセージ設定 (5 分)

- https://hyhome-harness-admin-0cdf2440.pages.dev/greeting を開く
- アカウントを「みな｜家づくり相談窓口」に切替
- 本文を入力 (例:「{{friend_name}}さん、ご登録ありがとうございます！」)
- プレビューを確認 → 保存

### ③ fingerprint ポリシー確認 (任意)

- https://hyhome-harness-admin-0cdf2440.pages.dev/fingerprint-policy
- デフォルト: 同意 ON, 保存期間 90 日
- そのままで OK、変えたい場合だけ調整

### ④ Token 暗号化 (今は触らない)

ベータ機能で、`broadcasts` 系の復号対応はかなり進めたものの完璧ではない。
本番有効化は Phase 1-G v3 (event-booking / ban-monitor / insight-fetcher 対応) 完了後に。

## ⏳ 残タスク (次セッションで)

| Phase | 内容 | 推定工数 |
|---|---|---|
| 2-C | クロス分析画面 (複数タグ交差) | 3〜4 時間 |
| 2-D | Stripe 商品販売 UI | 6〜8 時間 |
| 2-E | 購入者限定アクション | 3〜4 時間 |
| 1-G v3 | event-booking / ban-monitor / insight-fetcher の復号対応 | 2 時間 |

## 🔍 改善・修正の根拠 (Codex 指摘要約)

Codex に夜通しレビューさせて、深刻度別に 7 件指摘 → 全て反映済み。
詳細は git log の commit `4d6230c` および `a4ddf1e` の本文参照。

## 📁 関連ファイル位置

```
~/hyhome/ads/line/harness/fork/
├── RUNBOOK.md               ← 運用マニュアル
├── docs/iOS_HANDOFF.md      ← iOS 別セッション引継ぎ
├── packages/db/migrations/
│   ├── 062_lark_notifications.sql
│   └── 063_fingerprint_retention.sql
├── apps/web/src/app/
│   ├── greeting/page.tsx
│   ├── fingerprint-policy/page.tsx
│   ├── token-encryption/page.tsx
│   └── lark-notifications/page.tsx
└── apps/worker/src/
    ├── lib/token-crypto.ts
    ├── lib/account-token.ts
    ├── services/fingerprint-purger.ts
    ├── services/lark-notifier.ts
    ├── services/lark-notifier-hooks.ts
    └── routes/
        ├── fingerprint-policy.ts
        ├── token-encryption.ts
        └── lark-notifications.ts
```

朝の作業後に、何か詰まったらいつでも声をかけてください。

おつかれさまでした 🌙→☀️
