# Fork + Cloudflare 運用ガイド

LINE Harness は、fork した repo を自分の本番環境として育てる運用を推奨します。

## 全体像

```text
Shudesu/line-harness-oss
  upstream/main  本流アップデート
        |
        v
your-name/line-harness-oss
  main           自分の本番。GitHub Actions が Cloudflare に deploy
  feature/*      自分専用の機能開発
  upstream/*     本流取り込み PR
```

この形にすると、本流の新機能を取り込みながら、自分専用の機能も同じ repo で育てられます。

## 初回セットアップ

1. GitHub で `Shudesu/line-harness-oss` を fork
2. fork を clone

```bash
git clone https://github.com/YOUR_NAME/line-harness-oss.git
cd line-harness-oss
git remote add upstream https://github.com/Shudesu/line-harness-oss.git
pnpm install
```

3. Cloudflare にログイン

```bash
npx wrangler login
```

4. セットアップ CLI を実行

```bash
npx create-line-harness@latest
```

CLI は Cloudflare Workers、D1、R2、Pages を前提にセットアップします。

## GitHub Actions を有効化する

fork の `Settings > Secrets and variables > Actions` に値を入れます。

Secrets:

| 名前 | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions から Cloudflare に deploy する |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント |
| `D1_DATABASE_NAME` | 本番 D1 database 名 |
| `D1_DATABASE_ID` | 本番 D1 database ID |
| `NEXT_PUBLIC_API_URL` | 管理画面から叩く Worker URL |

Variables:

| 名前 | 用途 |
| --- | --- |
| `LINE_HARNESS_CLOUDFLARE_DEPLOY` | `true` にすると fork の deploy workflow が有効 |
| `WORKER_NAME` | Worker 名。未設定なら `line-crm-worker` |
| `PAGES_PROJECT_NAME` | Pages project 名。未設定なら `line-crm-admin` |
| `VITE_LIFF_ID` | LIFF ID |
| `VITE_BOT_BASIC_ID` | LINE bot basic ID |
| `VITE_CALENDAR_CONNECTION_ID` | Google Calendar 連携を使う場合だけ設定 |

Worker secrets は Cloudflare 側へ入れます。

```bash
npx wrangler secret put API_KEY
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET
npx wrangler secret put LIFF_URL
```

## 日常の開発

自分専用の機能は branch を切って作ります。

```bash
git switch -c feature/my-automation
pnpm --filter worker typecheck
pnpm --filter worker test
git push -u origin feature/my-automation
```

GitHub で PR を作り、問題なければ fork の `main` に merge します。`main` に入ると Cloudflare deploy workflow が走ります。

## 本流アップデートの取り込み

fork の `Actions > Update from upstream > Run workflow` を実行します。

workflow は `Shudesu/line-harness-oss/main` を fetch し、fork の `main` に取り込む PR を作ります。PR が clean なら merge してください。conflict が出た場合は、その PR 上で直します。

## 事故を防ぐルール

- `main` は Cloudflare 本番に deploy される branch として扱う
- 作業は必ず feature branch / PR で行う
- 本流取り込みも PR 経由にする
- Cloudflare secrets や LINE tokens は GitHub に commit しない
- `wrangler.toml` に本番 secret を書かない

## ローカル開発との違い

ローカル開発は「試す場所」です。本番運用は fork の `main` と Cloudflare です。

```text
local branch -> PR -> fork main -> GitHub Actions -> Cloudflare
```
