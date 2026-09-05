# Fork + Cloudflare 運用ガイド

L Harness は、fork した repo を自分の本番環境として育てる運用を推奨します。

## 目指す形

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

この形にすると、次の 3 つを両立できます。

- 本流の新機能を取り込める
- 自分専用の改造を PR として管理できる
- main に入ったものだけ Cloudflare に自動反映できる

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

4. D1 / R2 / Worker / Pages を作る

```bash
npx create-line-harness@latest
```

セットアップ CLI は Cloudflare を前提に、Worker API、D1、R2、管理画面 Pages を作ります。

## GitHub に設定する値

fork の GitHub repo で `Settings > Secrets and variables > Actions` を開きます。

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
| `VITE_LIFF_ID` | LIFF ID |
| `VITE_BOT_BASIC_ID` | LINE bot basic ID |
| `VITE_CALENDAR_CONNECTION_ID` | Google Calendar 連携を使う場合だけ設定 |

Worker secrets は `wrangler secret put` で Cloudflare 側に設定します。

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

GitHub で PR を作り、問題なければ fork の `main` に merge します。

`main` に merge されたら GitHub Actions が Cloudflare に自動 deploy します。ローカルPCを開きっぱなしにする必要はありません。

## 本流アップデートの取り込み

fork に入っている `Update from upstream` workflow を手動実行します。

GitHub:

1. `Actions`
2. `Update from upstream`
3. `Run workflow`

workflow は `Shudesu/line-harness-oss/main` を fetch して、fork の `main` に取り込む PR を作ります。

PR が clean なら merge します。conflict した場合は、その PR 上で直します。

## 事故を防ぐルール

- `main` は Cloudflare 本番に deploy される branch として扱う
- 作業は必ず feature branch / PR で行う
- 本流取り込みも PR 経由にする
- Cloudflare secrets や LINE tokens は GitHub に commit しない
- `wrangler.toml` に本番 secret を書かない

## ローカル開発との違い

ローカル開発は「試す場所」です。

本番運用は fork の `main` と Cloudflare です。

```text
local branch -> PR -> fork main -> GitHub Actions -> Cloudflare
```

この流れに寄せるほど、本流アップデート、自分専用機能、デプロイ履歴が全部 GitHub に残ります。
