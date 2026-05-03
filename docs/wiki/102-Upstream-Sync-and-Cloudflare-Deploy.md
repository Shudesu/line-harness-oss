# 102. Upstream追従とCloudflare登録方針

このforkは `line-harness-oss` を元に、予約システムを追加したリポジトリである。

upstreamの更新を取り込みやすくするため、CloudflareアカウントID、D1 database ID、R2 bucket、LINE/Googleのsecretなど、環境ごとに変わる値はupstream由来ファイルへ直接書き込まない。

## 基本方針

- `apps/worker/wrangler.toml` はupstreamとの差分を小さく保つ。
- Cloudflare固有の値は、Cloudflare Dashboard、Wrangler secrets、GitHub Actions secrets/variablesで管理する。
- ローカル開発値は `apps/worker/.dev.vars` に置く。ただし、本番secretは入れない。
- 予約システム固有の実装は、`routes/reservations/`, `packages/db/src/reservations.ts`, `packages/sdk/src/resources/reservations.ts`, `packages/mcp-server/src/tools/reservations.ts` のように責務単位で分離する。
- upstreamを取り込むときは、先にupstream更新を取り込み、その後このforkの予約機能差分を確認する。

## Cloudflare登録で直接書き換えないもの

以下は追跡対象ファイルに直接入れない。

```text
account_id
database_id
CLOUDFLARE_API_TOKEN
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
LINE_LOGIN_CHANNEL_SECRET
GOOGLE_OAUTH_CLIENT_SECRET
API_KEY
```

理由は、これらを直接書くとupstream更新時にconflictしやすく、secret漏洩リスクも上がるため。

## Cloudflare側で作るもの

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create line-crm
pnpm exec wrangler r2 bucket create line-harness-images
```

D1作成後に出る `database_id` は、Gitへ直接commitせず、デプロイ環境の設定として扱う。

## D1 migration

remote D1へschemaを入れる。

```bash
pnpm exec wrangler d1 execute line-crm --config apps/worker/wrangler.toml --remote --file=packages/db/schema.sql
```

ローカルD1は次で確認する。

```bash
pnpm db:migrate:local
pnpm db:seed:reservations:local
```

## Worker secrets

Workerに必要なsecretは `wrangler secret put` で登録する。

```bash
cd apps/worker
pnpm exec wrangler secret put API_KEY
pnpm exec wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
pnpm exec wrangler secret put LINE_CHANNEL_SECRET
pnpm exec wrangler secret put LINE_LOGIN_CHANNEL_ID
pnpm exec wrangler secret put LINE_LOGIN_CHANNEL_SECRET
pnpm exec wrangler secret put WORKER_URL
pnpm exec wrangler secret put LIFF_URL
pnpm exec wrangler secret put GOOGLE_OAUTH_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
pnpm exec wrangler secret put GOOGLE_OAUTH_REDIRECT_URI
```

## GitHub Actions

自動deployでは、GitHub repository settingsに以下を登録する。

このforkでは、`apps/worker/wrangler.toml` のプレースホルダーを直接commitしない。代わりに `.github/workflows/deploy-worker.yml` がCIランナー上だけで `wrangler.toml` を本番値に差し替えてからbuild/deployする。

これにより、upstreamの `wrangler.toml` 更新を取り込みやすくしつつ、GitHub ActionsからCloudflareへdeployできる。

Secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_D1_DATABASE_ID
```

Variables:

```text
WORKER_NAME
CLOUDFLARE_D1_DATABASE_NAME
CLOUDFLARE_R2_BUCKET_NAME
RUN_D1_MIGRATIONS
VITE_LIFF_ID
VITE_BOT_BASIC_ID
VITE_CALENDAR_CONNECTION_ID
```

推奨値:

```text
WORKER_NAME=line-harness-reservation
CLOUDFLARE_D1_DATABASE_NAME=line-crm
CLOUDFLARE_R2_BUCKET_NAME=line-harness-images
RUN_D1_MIGRATIONS=false
```

`RUN_D1_MIGRATIONS=true` にすると、deploy前に `packages/db/schema.sql` をremote D1へ適用する。初回セットアップでは便利だが、本番運用ではDB migrationをdeployと分離する方が安全。

### GitHub Actionsで実行されること

```text
1. pnpm install
2. shared / line-sdk / db build
3. packages/db の予約不変条件テスト
4. packages/sdk の予約SDKテスト
5. CI上だけ wrangler.toml のCloudflare値を差し替え
6. 必要ならD1 schema適用
7. worker build
8. wrangler deploy
```

### 事前にCloudflare側で必要なもの

```text
Cloudflare Workers 有効化
Cloudflare D1 database 作成
Cloudflare R2 有効化
R2 bucket 作成
Worker secrets 登録
```

R2が未有効化だと、deploy時に次のエラーで止まる。

```text
Please enable R2 through the Cloudflare Dashboard. [code: 10042]
```

## upstream取り込み手順

upstream remoteを追加していない場合:

```bash
git remote add upstream https://github.com/Shudesu/line-harness-oss.git
```

更新確認:

```bash
git fetch upstream
git log --oneline HEAD..upstream/main
```

取り込み:

```bash
git merge upstream/main
```

衝突しやすい箇所は次。

```text
apps/worker/src/index.ts
apps/worker/src/routes/*
packages/db/schema.sql
packages/sdk/src/*
README.md
```

予約機能は責務別ファイルへ分けているため、upstreamの通常更新とは衝突しにくい構成にする。

## 予約機能側で守ること

- upstream由来の巨大ファイルへ予約ロジックを直接足さない。
- Worker routeは `apps/worker/src/routes/reservations/` 配下に集約する。
- DB操作は `packages/db/src/reservations.ts` に集約する。
- SDKは `packages/sdk/src/resources/reservations.ts` に集約する。
- MCP toolは `packages/mcp-server/src/tools/reservations.ts` に集約する。
- 新しい外部連携は、GASやGoogle Calendarのように `docs/` と専用serviceへ分ける。
