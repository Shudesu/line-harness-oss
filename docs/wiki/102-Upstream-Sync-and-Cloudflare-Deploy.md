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

このworkflowは `environment: production` を指定する。GitHubの Environment `production` にSecrets/Variablesを保存している場合、その値がdeploy jobから読まれる。

このforkでは、`apps/worker/wrangler.toml` のプレースホルダーを直接commitしない。また、CIランナー上でも source の `wrangler.toml` は書き換えない。

GitHub Actionsでは、`pnpm --filter worker build` 後にVite/Cloudflare pluginが生成する `apps/worker/dist/**/wrangler.json` を読み取り、deploy専用の一時ファイル `apps/worker/.wrangler-ci.json` を生成する。その一時configにだけ本番の `account_id`, `database_id`, Worker名, R2 bucket名を入れ、`wrangler deploy --config .wrangler-ci.json` でデプロイする。

これにより、upstreamの `wrangler.toml` 更新を取り込みやすくしつつ、GitHub ActionsからCloudflareへdeployできる。

Secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_D1_DATABASE_ID
```

Variables:

```text
CLOUDFLARE_ACCOUNT_ID
WORKER_NAME
CLOUDFLARE_D1_DATABASE_NAME
CLOUDFLARE_R2_BUCKET_NAME
CLOUDFLARE_SECRETS_STORE_ID
CLOUDFLARE_SECRETS_STORE_BINDINGS
WORKER_URL
LIFF_URL
LINE_CHANNEL_ID
LINE_LOGIN_CHANNEL_ID
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_REDIRECT_URI
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

`CLOUDFLARE_ACCOUNT_ID` はsecretではないため、GitHub Variablesへ登録してよい。workflowは `secrets.CLOUDFLARE_ACCOUNT_ID` と `vars.CLOUDFLARE_ACCOUNT_ID` の両方に対応する。

### Cloudflare Secrets Storeを使う場合

Cloudflare Secrets StoreへLINE/Google/API_KEYなどを保存している場合、Worker secret値をGitHub Secretsへ複製しない。

GitHub Environment `production` のVariablesへ次を登録する。

```text
CLOUDFLARE_SECRETS_STORE_ID=<Secrets Store ID>
```

secret名とWorker binding名が同じ場合、`CLOUDFLARE_SECRETS_STORE_BINDINGS` は省略できる。省略時は必須最小セットとして次を自動でbindingする。

```text
API_KEY
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
```

`WORKER_URL`, `LIFF_URL`, `LINE_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI` は機密値ではないため、GitHub VariablesからWorker `vars` として渡す。Secrets Storeには入れない。

Google Calendarの `GOOGLE_OAUTH_CLIENT_SECRET`、LINE Loginの `LINE_LOGIN_CHANNEL_SECRET`、IG連携、Stripeなど任意機能のsecretもSecrets Storeからbindしたい場合、またはSecrets Store上のsecret名を変えている場合は、カンマ区切りで対応を書く。ここに書いたsecretはCloudflare Secrets Store内に存在している必要がある。存在しないsecretを指定すると、deployは `code: 10182` で失敗する。

```text
CLOUDFLARE_SECRETS_STORE_BINDINGS=API_KEY=prod-api-key,LINE_CHANNEL_SECRET=prod-line-channel-secret,LINE_CHANNEL_ACCESS_TOKEN=prod-line-channel-access-token,GOOGLE_OAUTH_CLIENT_SECRET,LINE_LOGIN_CHANNEL_SECRET
```

workflowは `apps/worker/wrangler.toml` を直接編集せず、CI内で生成する `.wrangler-ci.json` にだけ `secrets_store_secrets` を追加する。これにより、upstream更新時に `wrangler.toml` のconflictを増やさない。

`RUN_D1_MIGRATIONS=true` にすると、deploy前に `packages/db/schema.sql` をremote D1へ適用する。初回セットアップでは便利だが、本番運用ではDB migrationをdeployと分離する方が安全。

## apps/web の Cloudflare Pages deploy

`apps/web` は Next.js だが、`apps/web/next.config.ts` で `output: 'export'` を指定している。そのため、SSR Workerではなく静的ファイルとして Cloudflare Pages へdeployする。

```text
pnpm --filter web build
apps/web/out を Cloudflare Pages にアップロード
```

このforkでは Worker deploy と Web deploy を分ける。理由は、WorkerはD1/R2/Secrets Storeを持つAPIサーバーで、Webは静的な管理画面だからである。分けることで、`line-harness-oss` の Worker 設定更新と、管理画面のPages設定が衝突しにくくなる。

GitHub Environment `production` に次を登録する。

Secrets:

```text
CLOUDFLARE_API_TOKEN
```

Variables:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_PAGES_PROJECT_NAME
NEXT_PUBLIC_API_URL
```

推奨値:

```text
CLOUDFLARE_PAGES_PROJECT_NAME=line-harness-reservation-web
NEXT_PUBLIC_API_URL=https://line-harness-reservation.<subdomain>.workers.dev
```

`NEXT_PUBLIC_API_URL` はブラウザに埋め込まれる公開値であり、secretではない。`API_KEY` は絶対に `NEXT_PUBLIC_*` に入れない。管理画面のAPI keyはログイン画面から入力し、ブラウザの `localStorage` に保存して `Authorization: Bearer ...` として送る。

Cloudflare Pages project がまだ存在しない場合は、Dashboardで作るか、ローカルから次で作成する。

```bash
pnpm exec wrangler pages project create line-harness-reservation-web --production-branch main
```

## 既存LINE公式アカウントにLINE harnessを載せる方針

このプロジェクトでは、LINE公式アカウントを別アカウントへ移行するのではなく、既存のLINE公式アカウントにLINE harness Workerを接続する。

やること:

```text
1. 既存LINE公式アカウントのMessaging APIを有効化する。
2. Channel secret / channel access token をCloudflare Secrets Storeへ保存する。
3. LINE DevelopersのWebhook URLを `https://<worker>/webhook` に設定する。
4. Webhook利用をONにする。
5. LINE Login / LIFFを同じまたは対応するLINE Developers providerで作成する。
6. LIFF Endpoint URLを `https://<worker>/?page=book` などに設定する。
7. LINE harness管理画面から `line_accounts` に既存アカウント情報を登録する。
```

重要:

- 既存の友だちをLINE APIで全件取得することはできない。
- 既にこのDBに `line_user_id` がある友だちは、そのまま `friends` として移行できる。
- DBに存在しない既存友だちは、次にメッセージ・LIFF・フォーム・予約などで接触した時点で `friends` に登録・更新される。
- 既存リッチメニューは、旧アカウントではなく同じ既存アカウント上のリッチメニューとして扱う。LINE APIから一覧を取得し、LINE harness管理画面で確認・default設定・個別link/unlinkする。
- 既存のLINE Official Account Managerで作ったリッチメニューをLINE harness管理下へ完全同期したい場合は、`/api/rich-menus` で一覧取得し、DB側に管理用メタデータを保存する同期機能を追加する。

初回接続時の安全確認:

```text
1. `/api/health` が通る。
2. LINE DevelopersのWebhook検証が成功する。
3. 友だち追加またはメッセージ送信で `friends` が作成・更新される。
4. `/api/rich-menus` で既存リッチメニュー一覧が見える。
5. LIFF予約画面でsession tokenが発行される。
```

GitHub Actionsでは `.github/workflows/deploy-web.yml` が次を行う。

```text
1. pnpm install
2. packages/shared build
3. NEXT_PUBLIC_API_URL を使って apps/web を static export
4. `wrangler pages deploy apps/web/out` で Cloudflare Pages へdeploy
```

### GitHub Actionsで実行されること

```text
1. pnpm install
2. shared / line-sdk / db build
3. packages/db の予約不変条件テスト
4. packages/sdk の予約SDKテスト
5. 必要ならD1 schema適用
6. worker build
7. build成果物から `.wrangler-ci.json` を生成
8. `wrangler deploy --config .wrangler-ci.json`
```

### CI/CD設計の責務分離

```text
apps/worker/wrangler.toml
  upstream追従用のテンプレート。Cloudflare固有値を書かない。

GitHub Secrets / Variables
  本番deployに必要なCloudflare固有値を保持する。

apps/worker/dist/**/wrangler.json
  build時に生成される成果物。Git管理しない。

apps/worker/.wrangler-ci.json
  GitHub Actions内だけで生成される一時deploy config。Git管理しない。

Cloudflare Worker secrets
  LINE/Google/API_KEYなど、実行時secretを保持する。
```

この構成なら、`line-harness-oss` から `wrangler.toml` の更新が入っても、このforkの本番IDとconflictしない。

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
