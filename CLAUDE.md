# line-harness-oss — プロジェクト前提

このリポジトリ = 翔太の自分用LINE公式アカウント（およびCRM基盤）のバックエンド＋管理画面。Cloudflare Workers + D1 (SQLite) + Vite + pnpm モノレポ。

---

## モノレポ構造

- `apps/worker/` — Cloudflare Workers。LINE webhook受付、自動返信、ステップ配信、フォーム処理、DB操作、API。**触るのは基本ここ**
- `apps/web/` — 管理画面フロントエンド
- `packages/db/` — D1スキーマ・クエリ関数（`@line-crm/db`）
- `packages/line-sdk/` — LINE Messaging API クライアント（`@line-crm/line-sdk`）

---

## 環境前提（動かないファクト）

### D1データベース
- **DB名は `line-crm`**（`line-harness-db` ではない。よく間違える）
- バインディング: `DB`
- リモート実行: `pnpm --filter worker exec wrangler d1 execute line-crm --remote --command "..."`
- JSON出力したいときは `--json` 付ける

### ビルド＆デプロイ
**必ずこの順で実行する：**
```bash
cd apps/worker
pnpm build          # vite build が走って dist/ が更新される
pnpm exec wrangler deploy
```
`wrangler deploy` 単体では vite build が走らず、古い dist がデプロイされる事故が起きる。**これは過去に実際にハマった**。

デプロイ後、反映確認は dist を grep：
```bash
grep "特定の文字列" apps/worker/dist/line_harness/assets/worker-entry-*.js
```

### 認証
- APIは Bearer認証（`Authorization: Bearer <token>`）
- トークンは Cloudflare secret の `API_KEY`（env経由で参照）
- staff_members テーブルの api_key でも認証可だがこのプロジェクトでは空
- **ローカルから API_KEY 使いたいとき**: `~/Desktop/obsidian/.mcp.json` の `LINE_HARNESS_API_KEY` を参照（ただし Cloudflare secret とズレてる可能性あり。401出たら翔太に確認）

### 主要な secret（`wrangler secret list` で確認）
- `API_KEY` — 管理API認証
- `LINE_CHANNEL_ACCESS_TOKEN` — LINE Messaging API
- `LINE_CHANNEL_SECRET` — webhook署名検証
- `LINE_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET` — ログイン連携
- `LIFF_URL` — LIFFアプリURL（template変数 `{{liff_url}}` で展開される）

---

## ハマりポイント（Gotchas）

- **rich_menus テーブルは存在しない**。リッチメニューは LINE Messaging API 直叩き（`apps/worker/src/routes/rich-menus.ts` が薄いプロキシ）。画像差し替えはAPI経由で create → upload → set_default → delete_old の4ステップ
- **line_accounts, staff_members は空**。認証・LINE接続は secret が正本
- **wrangler tail が数分で切断する**（4.77のバグっぽい）。長時間ログ監視したいなら dist grep か D1 の `messages_log` テーブル直接読む方が早い
- **LINEリッチメニュー画像**の公式規格は 2500x1686 / 2500x843 / 1200x810 / 1200x405 / 800x540 / 800x270。規格外でも aspect比 1.45以上 & 幅800-2500 & 高さ250-1686 & 1MB以下なら通る（その場合は `size` 明示指定必須）

---

## 設計の原則

- **タップ数 = 離脱率**。LINEフローの中間確認カード・2択メニューは原則悪手。Flexのボタンは `action.type: 'uri'` で直接LIFFに飛ばす。`message` 型は webhook 往復が挟まるので1タップ増える
- **テンプレ変数は DB に直書きせず expandVariables で展開**。秘匿値（LIFF_URLなど）は secret に置いて `{{liff_url}}` のようなプレースホルダで埋め込む
- **フォーム固有のサンクスメッセージ** は `forms.ts` 内で `form.id` ハードコード分岐（例: 無料相談フォーム `032491b8-563f-4736-bf0d-e91b911c87ac`）

---

## 主要ファイルマップ

| パス | 役割 |
|-----|-----|
| `apps/worker/src/routes/webhook.ts` | LINE webhook入口。キーワード照合・診断フロー分岐 |
| `apps/worker/src/routes/forms.ts` | フォームCRUD＋送信処理（サンクス配信含む） |
| `apps/worker/src/routes/rich-menus.ts` | リッチメニューAPIプロキシ |
| `apps/worker/src/services/step-delivery.ts` | ステップ配信＋`expandVariables`（テンプレ展開の中心） |
| `apps/worker/src/middleware/auth.ts` | Bearer認証ミドルウェア |
| `apps/worker/wrangler.toml` | Worker設定。D1バインディング |
| `packages/db/src/` | D1クエリ関数 |

---

## 作業開始時のチェックリスト

1. `apps/worker/` で作業するなら、このファイルの「環境前提」を意識する
2. コード変更 → `pnpm build` → `wrangler deploy` → dist grep で反映確認
3. D1触るときは DB名 `line-crm`
4. リッチメニュー・LINE API 系は secret `LINE_CHANNEL_ACCESS_TOKEN` 経由、DB に状態持たない
