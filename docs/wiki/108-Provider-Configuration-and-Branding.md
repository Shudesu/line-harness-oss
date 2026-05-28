# 108. 事業者別設定とブランド切替設計

## 目的

このリポジトリは現在、アオニサイファーム向けの予約・LINE運用・Gmail/じゃらん連携・Google Calendar連携を含む。

ただし、別事業者へ導入する場合に、コード内の文言・画像・ドメイン・外部連携設定を都度修正すると保守性が落ちる。

今後は、GitHub Environment の Variables / Secrets を切り替えるだけで、事業者別の予約サイト・管理画面・メール・LIFF画面になる構成を目指す。

## 2026-05 改訂方針

単に色や店舗名を環境変数化するだけでは足りない。現状は、予約画面のHTML、HTMLメール、Resend送信者、外部取り込み、じゃらん/Gmail設定、カフェ紹介、初期テンプレート文言までアオニサイファーム前提になっている。

他事業者へ転用しやすくするため、次の2層に分ける。

```text
共通コア
  予約DB
  在庫制御
  状態遷移
  公開API
  LINE連携
  Google Calendar連携
  Gmail外部取り込みの実行基盤
  Discord通知

事業者テンプレート
  予約画面HTML/CSS
  メールHTML
  店舗名/色/画像/文言
  Resend送信者
  外部取り込みルール初期値
  予約導線カード文言
  カフェ/体験紹介セクション
```

重要なのは、HTML作成やメール作成は管理画面で自由編集させるのではなく、**開発者が事業者ごとのテンプレートとして実装する**こと。  
管理画面で何でも編集可能にすると、予約導線・メール・トークンURL・必須注意文を壊しやすい。

MVPでは次の方針にする。

```text
予約ロジック = 共通
事業者ごとの見た目 = provider template
事業者ごとの設定値 = GitHub Environment / Cloudflare Secrets / R2 assets
```

## 転用時に修正が必要な箇所の洗い出し

現状、別事業者に転用すると修正が必要になる箇所は次の通り。

### Worker予約画面

対象:

```text
apps/worker/index.html
apps/worker/src/client/booking/render.ts
apps/worker/src/client/booking/html.ts
apps/worker/src/client/booking.ts
apps/worker/src/client/booking/*
```

含まれる事業者固有要素:

- `<title>アオニサイファーム体験予約</title>`
- アオニサイ/ブルーベリー/カフェの文言
- カフェ紹介タブ
- `public/aonisai/...` 画像
- `#69A3D0`、深い紫青などのブランド色
- カフェ用CSS `.cafe-screen`, `.cafe-hero`, `.cafe-menu-card`
- 予約画面上の体験紹介、LINE連携文言

### Worker予約画面のルーティング方針

既存運用を壊さないため、Worker配信の予約画面は2系統に分ける。

```text
/?page=book
  既存main相当のAONISAI予約画面
  既存LIFF URL、既存リッチメニュー、既存予約導線はここを使う。

/?page=book-v2
  provider-configurableな新予約画面
  他事業者展開や新UI検証用。明示的にURLを選んだ場合だけ使う。
```

`book-v2` は `/api/public/provider-config` を読み、色・文言・カフェタブ・外部取り込み初期値をProvider Configから反映する。  
一方で `book` はmain相当の既存UIとして残し、provider設定の不備で本番予約画面が変わる事故を避ける。

改善方針:

- 予約画面のロジックは共通化する。
- HTML/CSSは provider template として差し替える。
- 事業者固有セクションは `extraSections` としてテンプレート側に閉じ込める。

### HTMLメール

対象:

```text
apps/worker/src/services/reservation-email.ts
```

含まれる事業者固有要素:

- アオニサイファーム名
- 住所
- カフェヒーロー画像
- メール内の色、ロゴ、フッター
- 予約確認URL/キャンセルURL/LINE連携URL周辺の文言
- `RESEND_FROM_NAME` の既定値

改善方針:

- 予約情報、token URL生成、送信処理は共通コアに残す。
- HTML本文は provider email template に分ける。
- メールテンプレートは開発者が作る。
- URL差し込み変数は共通仕様にする。

### Resend / メール送信者

対象:

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_FROM_NAME
```

事業者ごとに異なるもの:

- 送信ドメイン
- 送信元メールアドレス
- 送信者名
- DNS認証状況

改善方針:

- Secrets Store binding名は固定する。
- 値はGitHub Environment/Cloudflare環境ごとに差し替える。
- `RESEND_FROM_NAME` はProvider Configからも生成できるようにする。

### 外部取り込み

対象:

```text
apps/worker/src/services/gmail-jalan-import.ts
apps/worker/src/services/jalan-mail-parser.ts
apps/web/src/app/reservation-ops/page.tsx
packages/db/src/gmail-imports.ts
packages/db/migrations/032_gmail_import_rules.sql
```

含まれる事業者固有要素:

- じゃらん前提の名称
- `reservation@activityboard.jp`
- `reservation_cancel@activityboard.jp`
- Gmail label設計
- 取り込み先Resource/Menu
- 予約通知メール本文の形式
- 料金・人数・年齢区分の解釈

改善方針:

- 実行基盤は `external_mail_imports` として汎用化する。
- parserは provider/importer 単位で差し替える。
- MVPでは `jalan` parserを共通実装として残す。
- 事業者ごとのGmail rule初期値はProvider Configに置く。

### Web管理画面

対象:

```text
apps/web/src/app/reservation-ops/page.tsx
apps/web/src/app/reservations/page.tsx
apps/web/src/app/templates/page.tsx
```

含まれる事業者固有要素:

- `ブルーベリー予約はこちら`
- `じゃらん / Gmail設定`
- `ブルーベリー摘み取り`
- 予約カードの既定文言
- じゃらん前提のフィルタ名

改善方針:

- 管理UIは「外部予約」「メール取り込み」と表示し、providerが `jalan` のときだけ「じゃらん」と出す。
- 予約導線カードの初期文言はProvider Configから取得する。
- テンプレート初期値は provider seed として分ける。

### Seed / Test / Docs

対象:

```text
packages/db/seeds/reservations.local.sql
packages/db/src/reservations-d1.test.ts
apps/worker/src/services/jalan-mail-parser.test.ts
docs/wiki/*
docs/gas/*
```

含まれる事業者固有要素:

- ブルーベリー摘み取り
- カフェ
- じゃらんメール例
- アオニサイ顧客情報

改善方針:

- 共通テストは generic naming にする。
- 事業者固有のサンプルは `fixtures/providers/aonisai` に隔離する。
- docsは「共通仕様」と「アオニサイ導入メモ」を分ける。

## 現状の課題

### 1. ブランド情報がコードに埋まっている

例:

- `アオニサイファーム`
- `AONISAI FARM`
- `ブルーベリー`
- `つくば`
- `〒300-2645 茨城県つくば市上郷 2223-1`
- `/aonisai/...` 画像パス
- カフェ紹介文、メニュー名、料金、画像

これらが `apps/worker/src/client/booking/render.ts`、`apps/worker/src/services/reservation-email.ts`、`apps/worker/index.html` に存在する。

### 2. デプロイ先URLとサービス設定が複数箇所に分散している

主なURL系設定:

- `WORKER_URL`
- `WEB_URL`
- `NEXT_PUBLIC_WEB_URL`
- `NEXT_PUBLIC_API_URL`
- `LINE_HARNESS_API_URL`
- `LIFF_URL`
- `GOOGLE_OAUTH_REDIRECT_URI`

これらは GitHub Variables、Cloudflare Worker vars、Cloudflare Secrets Store、Pages env に分散している。

### 3. Secrets Store は事業者ごとに作り直しが必要

事業者ごとに異なるもの:

- `API_KEY`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_LOGIN_CHANNEL_SECRET`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `RESEND_API_KEY`
- Discord Webhook URL

Secrets Store binding 名は共通にし、secret の値だけ事業者環境ごとに変えるのが望ましい。

### 4. 予約ドメインが農園特化

DBや予約ロジック自体は汎用化できているが、UI上はブルーベリー農園・カフェ前提の表現が多い。

横展開するには、予約ロジックとブランド表示を分離する必要がある。

## 目標構成

### GitHub Environment 単位で事業者を分ける

GitHub Environments を以下のように作る。

```text
production-aonisai
production-client-a
production-client-b
```

各Environmentに、事業者ごとの Variables / Secrets を設定する。

同じコードを使い、デプロイ時にEnvironmentを選ぶだけで別事業者向けにデプロイできる。

### 事業者テンプレートを明示する

GitHub EnvironmentだけではHTMLの差し替えが難しいため、事業者ごとのテンプレートディレクトリを用意する。

```text
apps/worker/src/providers/
  index.ts
  generic/
    config.ts
    booking-template.ts
    email-template.ts
    external-import.ts
  aonisai/
    config.ts
    booking-template.ts
    email-template.ts
    external-import.ts

apps/web/src/providers/
  index.ts
  generic.ts
  aonisai.ts
```

選択は環境変数で行う。

```text
PROVIDER_ID=aonisai
```

`PROVIDER_ID` に対応するテンプレートを読み込み、存在しない場合は `generic` を使う。

### テンプレートの責務

```text
booking-template.ts
  予約画面の見た目、セクション、コピー、画像、CTAを定義する。

email-template.ts
  予約完了メール、キャンセルメール、確認メールのHTMLを定義する。

external-import.ts
  外部取り込みの既定設定、parser名、Gmail query例、ラベル名を定義する。

config.ts
  店舗名、住所、電話番号、色、画像URL、URL類を定義する。
```

予約作成、在庫更新、token検証、メール送信そのものはテンプレートに持たせない。

## 設定の分類

### 公開してよいVariables

GitHub Variables / Cloudflare Worker vars / Pages env に置く。

```text
PROVIDER_ID
PROVIDER_NAME
PROVIDER_DISPLAY_NAME
PROVIDER_SHORT_NAME
PROVIDER_DESCRIPTION
PROVIDER_ADDRESS
PROVIDER_PHONE
PROVIDER_SITE_URL
PROVIDER_PRIMARY_COLOR
PROVIDER_ACCENT_COLOR
PROVIDER_HERO_IMAGE_URL
PROVIDER_LOGO_URL
PROVIDER_FAVICON_URL
WORKER_URL
WEB_URL
NEXT_PUBLIC_WEB_URL
NEXT_PUBLIC_API_URL
LIFF_URL
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_REDIRECT_URI
LINE_CHANNEL_ID
LINE_LOGIN_CHANNEL_ID
VITE_LIFF_ID
VITE_BOT_BASIC_ID
```

### Secretにする値

GitHub Secrets / Cloudflare Secrets Store に置く。

```text
API_KEY
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
LINE_LOGIN_CHANNEL_SECRET
GOOGLE_OAUTH_CLIENT_SECRET
RESEND_API_KEY
RESEND_FROM_EMAIL
DISCORD_RESERVATION_WEBHOOK_URL
DISCORD_DAILY_WEBHOOK_URL
DISCORD_REVIEW_WEBHOOK_URL
```

`RESEND_FROM_NAME` は公開値でもよいが、メール送信設定としてSecrets Storeに寄せてもよい。

## 事業者プロファイル

Worker側に `provider-config` を作る。

```ts
export interface ProviderConfig {
  id: string;
  name: string;
  displayName: string;
  shortName: string;
  description: string;
  address?: string;
  phone?: string;
  siteUrl?: string;
  colors: {
    primary: string;
    accent: string;
    background: string;
  };
  assets: {
    logoUrl?: string;
    heroImageUrl?: string;
    faviconUrl?: string;
  };
  reservation: {
    title: string;
    introTitle: string;
    introBody: string;
    lineLinkTitle: string;
    lineLinkBody: string;
  };
  email: {
    fromName: string;
    footerText: string;
    heroImageUrl?: string;
  };
}
```

実装では、Provider Configを次の3階層で解決する。

```text
1. provider templateの既定値
2. GitHub/Cloudflareの公開Variables
3. Secrets StoreのSecret値
```

上書き優先度は `Secret/Env > provider template > generic default` とする。

例:

```text
provider template:
  displayName = "Generic Reservation"

GitHub Environment:
  PROVIDER_DISPLAY_NAME = "アオニサイファーム"

実行時:
  displayName = "アオニサイファーム"
```

この値を環境変数から生成する。

```text
PROVIDER_NAME=アオニサイファーム ブルーベリー観光農園
PROVIDER_SHORT_NAME=アオニサイファーム
PROVIDER_PRIMARY_COLOR=#272f72
PROVIDER_ACCENT_COLOR=#69A3D0
PROVIDER_HERO_IMAGE_URL=https://...
PROVIDER_LOGO_URL=https://...
```

## 推奨ファイル構成

```text
apps/worker/src/config/provider.ts
apps/worker/src/client/booking/provider.ts
apps/worker/src/services/provider-email-theme.ts
apps/web/src/lib/provider-config.ts
```

改訂後の推奨構成:

```text
apps/worker/src/config/provider.ts
  ProviderConfigの解決。SecretLikeにも対応する。

apps/worker/src/providers/index.ts
  PROVIDER_IDからprovider templateを選ぶ。

apps/worker/src/providers/generic/*
  他店舗向けの最小テンプレート。

apps/worker/src/providers/aonisai/*
  アオニサイ向けテンプレート。

apps/worker/src/services/reservation-email.ts
  メール送信の共通処理だけ残す。

apps/worker/src/services/provider-email-renderer.ts
  provider email templateを使ってHTML生成する。

apps/worker/src/routes/provider-config.ts
  GET /api/public/provider-config

apps/web/src/lib/provider-config.ts
  Web側で公開Provider Configを読む。

apps/web/src/components/booking/*
  Web予約画面の共通UI。
```

Worker APIで公開設定を返す。

```http
GET /api/public/provider-config
```

返す内容は公開値のみ。

```json
{
  "id": "aonisai",
  "displayName": "アオニサイファーム ブルーベリー観光農園",
  "shortName": "アオニサイファーム",
  "colors": {
    "primary": "#272f72",
    "accent": "#69A3D0"
  },
  "assets": {
    "logoUrl": "https://...",
    "heroImageUrl": "https://..."
  },
  "reservation": {
    "title": "体験予約",
    "introTitle": "つくばの農園で、旬のブルーベリーを楽しむ体験"
  }
}
```

## 画像の扱い

画像はコードに入れず、原則R2に置く。

```text
R2 bucket:
providers/{providerId}/logo.webp
providers/{providerId}/hero.webp
providers/{providerId}/booking-header.webp
providers/{providerId}/email-hero.webp
providers/{providerId}/cafe/*.webp
```

環境変数には公開URLだけ入れる。

```text
PROVIDER_LOGO_URL=https://reservation.example.com/images/providers/aonisai/logo.webp
PROVIDER_HERO_IMAGE_URL=https://reservation.example.com/images/providers/aonisai/hero.webp
```

## メールの設計

現在の予約メールはアオニサイファーム専用の文言と画像がある。

今後は以下を環境設定化する。

```text
EMAIL_BRAND_TITLE
EMAIL_BRAND_SUBTITLE
EMAIL_HERO_IMAGE_URL
EMAIL_FOOTER_TEXT
RESEND_FROM_NAME
```

メール本文では、予約情報・確認URL・キャンセルURL・LINE連携URLは共通ロジックとして残し、見た目と文言だけ事業者設定で変える。

### メールテンプレートAPI

開発者が事業者ごとにHTMLを作れるよう、メールテンプレートは関数として定義する。

```ts
export type ReservationEmailTemplateInput = {
  provider: ProviderConfig;
  reservation: ReservationEmailView;
  urls: {
    detailUrl: string;
    cancelUrl: string;
    lineClaimUrl?: string;
    manageUrl?: string;
  };
};

export type ReservationEmailTemplate = {
  confirmation(input: ReservationEmailTemplateInput): {
    subject: string;
    html: string;
    text: string;
  };
  cancellation?(input: ReservationEmailTemplateInput): {
    subject: string;
    html: string;
    text: string;
  };
};
```

テンプレート内で自由にHTMLを作ってよいが、次の変数は必ず含める。

```text
予約日時
予約者名
人数
料金
確認URL
キャンセルURL
問い合わせ先
```

### Resend設定

Resendは事業者ごとに別ドメイン・別送信者にする。

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_FROM_NAME
```

`RESEND_FROM_NAME` が空の場合は `provider.email.fromName` を使う。  
`RESEND_FROM_EMAIL` が空の場合はメール送信をスキップし、予約作成は成功扱いにする。

## LIFF予約画面の設計

予約ロジックは共通。

事業者依存にするもの:

- タイトル
- ヒーロー画像
- ロゴ
- 色
- 体験説明
- LINE連携案内文
- カフェ紹介タブの有無

事業者設定例:

```text
BOOKING_ENABLE_CAFE_TAB=true
BOOKING_ENABLE_LINE_LINK_PANEL=true
BOOKING_INTRO_TITLE=つくばの農園で、旬のブルーベリーを楽しむ体験
BOOKING_INTRO_BODY=日付を選んで、空いている時間枠から予約できます。
```

カフェ紹介のような事業者固有ページは、共通予約UIに直書きしない。

代替案:

1. `BOOKING_EXTRA_TAB_LABEL` と `BOOKING_EXTRA_TAB_URL` で外部ページへ飛ばす。
2. 事業者別CMS/R2 JSONからタブ内容を読む。
3. MVPでは `aonisai` provider のみカフェタブを有効化する。

### HTMLカスタマイズ方針

予約画面のHTMLを事業者ごとにカスタマイズできるようにする。ただし、完全な自由HTMLに予約処理を埋め込む方式にはしない。

安全な分け方:

```text
共通ロジック
  state
  API呼び出し
  在庫表示
  予約作成
  token処理

provider template
  header
  hero
  intro
  extra tabs
  footer
  color tokens
  image URLs
```

テンプレートは次のようなスロット構造にする。

```ts
export type BookingPageTemplate = {
  renderHeader(context: BookingTemplateContext): string;
  renderIntro(context: BookingTemplateContext): string;
  renderExtraTabs?(context: BookingTemplateContext): string;
  renderFooter(context: BookingTemplateContext): string;
  cssVariables(context: BookingTemplateContext): Record<string, string>;
};
```

予約フォーム本体は共通コンポーネントとして残す。  
これにより、事業者ごとに見た目は変えられるが、予約作成・在庫確保・キャンセルtokenなどの重要処理は壊れにくい。

## 外部取り込みの設計

外部取り込みは「じゃらん専用機能」ではなく「外部予約メール取り込み」として扱う。

MVPでは実装済みの `jalan` parserを使うが、設計上は provider/importer を差し替えられるようにする。

```ts
export type ExternalMailImportProvider = {
  id: string; // jalan, airreserve, stores, custom
  displayName: string;
  defaultFromEmail?: string;
  defaultQuery?: string;
  defaultLabels?: {
    unprocessed: string;
    processed: string;
    review: string;
    failed: string;
  };
  parser: 'jalan' | 'custom';
};
```

アオニサイ向け:

```text
provider = jalan
from = reservation@activityboard.jp, reservation_cancel@activityboard.jp
query = {from:reservation@activityboard.jp from:reservation_cancel@activityboard.jp} newer_than:30d
```

他事業者では、外部予約サイトを使わない場合もある。その場合は外部取り込みUIを非表示にできる。

```text
EXTERNAL_IMPORT_ENABLED=false
```

管理画面の表示名もProvider Configで変える。

```text
EXTERNAL_IMPORT_LABEL=じゃらん / Gmail設定
EXTERNAL_IMPORT_LABEL=外部予約メール取り込み
```

## GitHub Actions設計

### deploy-worker

Environmentを選べるようにする。

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options:
          - production-aonisai
          - production-client-a
```

`environment: ${{ inputs.environment || 'production-aonisai' }}` とする。

必要な入力:

```text
environment
providerId
workerName
d1DatabaseName
r2BucketName
```

`providerId` は `PROVIDER_ID` としてWorker/Pages両方に渡す。

### deploy-web

Pages projectも事業者ごとに変えられるようにする。

```text
CLOUDFLARE_PAGES_PROJECT_NAME=line-harness-reservation-web-aonisai
NEXT_PUBLIC_API_URL=https://reservation.aonisai-blueberry.com
```

## 移行ステップ

### Phase 1: 設定値の棚卸し

- コード内のアオニサイ固有文言を一覧化する。
- 画像パス `/aonisai/...` の使用箇所を一覧化する。
- URL系Variablesを `.env.example` に整理する。

追加で棚卸しするもの:

- HTMLメール内の固定文言
- Resend送信者
- じゃらん/Gmail取り込み既定値
- 予約導線カード既定文言
- カフェ紹介タブ
- seed/testに入っている店舗固有データ

### Phase 2: Provider Configを追加

- `apps/worker/src/config/provider.ts` を作る。
- 環境変数から `ProviderConfig` を生成する。
- `GET /api/public/provider-config` を追加する。

同時に `apps/worker/src/providers/generic` と `apps/worker/src/providers/aonisai` を作る。

### Phase 3: メールをProvider Config化

- `reservation-email.ts` からアオニサイ固定文言を外す。
- `PROVIDER_*` と `EMAIL_*` からメールHTMLを組み立てる。

`reservation-email.ts` は送信だけ担当し、HTML生成は `provider-email-renderer.ts` に分ける。

### Phase 4: LIFF予約画面をProvider Config化

- `renderHeader`
- `renderExperienceIntro`
- `renderLineLinkPanel`
- `renderCafe`

を設定値ベースにする。

この段階では、予約フォーム本体は共通のままにする。  
事業者ごとに自由HTML化するのは header / intro / extra section / footer までに留める。

### Phase 5: GitHub Environment切替

- `deploy-worker.yml`
- `deploy-web.yml`

に `workflow_dispatch.inputs.environment` を追加する。

### Phase 6: 事業者テンプレート作成

```text
docs/providers/aonisai.env.example
docs/providers/generic-farm.env.example
docs/providers/generic-reservation.env.example
```

追加:

```text
apps/worker/src/providers/generic
apps/worker/src/providers/aonisai
docs/providers/aonisai.md
docs/providers/generic.md
```

## 実装優先度

### 最優先

```text
1. Provider Config APIを作る
2. reservation-email.ts のHTMLをprovider template化する
3. Worker予約画面のheader/intro/footerをprovider template化する
4. Resend送信者とメール文言をprovider設定から解決する
```

### 次に実装

```text
5. 外部取り込み設定をproviderごとのdefaultに分離する
6. reservation-opsの「じゃらん」固定表示を外部取り込み表示へ寄せる
7. Web予約画面 /book をProvider Config対応で作る
```

### 後回し

```text
8. 管理画面からProvider Configを編集
9. DBマルチテナント化
10. 外部取り込みparserを管理画面で作成
```

## テスト設計

Provider化は「見た目の変更」に見えるが、実際には予約導線、メール、外部取り込み、管理画面の初期値に影響する。  
そのため、単にビルドが通るだけでは不十分。次の4層でテストする。

```text
1. Provider Config解決テスト
2. Worker予約画面の表示・fallbackテスト
3. メールテンプレートテスト
4. Web管理画面のprovider反映テスト
```

### 1. Provider Config解決テスト

対象:

```text
apps/worker/src/config/provider.ts
apps/worker/src/providers/*
apps/worker/src/routes/provider-config.ts
```

目的:

```text
PROVIDER_ID と環境変数だけで、事業者ごとの公開設定が正しく返ること。
Secretsや非公開値が /api/public/provider-config に混ざらないこと。
```

テストケース:

```text
1. PROVIDER_ID 未設定なら generic provider を返す。
2. PROVIDER_ID=aonisai なら aonisai provider を返す。
3. 存在しない PROVIDER_ID は generic provider にfallbackする。
4. PROVIDER_DISPLAY_NAME などの環境変数が provider template の既定値を上書きする。
5. PROVIDER_PRIMARY_COLOR / PROVIDER_ACCENT_COLOR が colors に反映される。
6. BOOKING_ENABLE_CAFE_TAB=false で cafe tab が無効になる。
7. EXTERNAL_IMPORT_ENABLED=false で externalImport.enabled が false になる。
8. API_KEY / LINE_CHANNEL_ACCESS_TOKEN / RESEND_API_KEY などのSecretはレスポンスに含まれない。
9. Secret Store binding型の値でも文字列として解決できる。
10. provider-config API は認証なしで取得できるが、公開値だけを返す。
```

推奨テスト:

```text
apps/worker/src/config/provider.test.ts
apps/worker/src/routes/provider-config.test.ts
```

### 2. Worker予約画面の表示・fallbackテスト

対象:

```text
apps/worker/src/client/booking.ts
apps/worker/src/client/booking/render.ts
apps/worker/src/client/booking/state.ts
```

目的:

```text
provider-config によって予約画面の見た目が切り替わること。
provider-config 取得失敗時にアオニサイ固有情報が漏れないこと。
```

テストケース:

```text
1. 初期fallback provider は generic である。
2. provider-config取得成功時、document.title が provider.reservation.title になる。
3. renderHeader は provider.name / provider.reservation.title / provider.assets.logoUrl を使う。
4. provider.colors が CSS変数 --sky-700 / --sky-500 / --paper / --ink に反映される。
5. enableCafeTab=false の場合、カフェタブが表示されない。
6. enableCafeTab=false で show-cafe action を受けても booking 画面に戻る。
7. provider.id !== aonisai の場合、アオニサイ専用カフェ本文を表示しない。
8. provider-config取得失敗時、画面に「アオニサイ」「ブルーベリー」「カフェ画像」が出ない。
9. 予約作成、キャンセル、予約確認のAPI呼び出しは provider 表示変更で変わらない。
10. Web流入 mode=web の LINE連携案内は enableLineLinkPanel に従う。
```

推奨テスト:

```text
apps/worker/src/client/booking/render.test.ts
apps/worker/src/client/booking/provider-ui.test.ts
```

注意:

```text
カフェ紹介は aonisai provider 専用テンプレートとして許容する。
ただし generic provider では絶対に表示しない。
```

### 3. メールテンプレートテスト

対象:

```text
apps/worker/src/services/reservation-email.ts
apps/worker/src/providers/*/email-template.ts
apps/worker/src/providers/email-templates.ts
```

目的:

```text
予約メール本文が provider template で切り替わり、重要な予約URLと予約情報を必ず含むこと。
```

テストケース:

```text
1. PROVIDER_ID=aonisai では aonisai email template が使われる。
2. 未知の PROVIDER_ID では generic email template が使われる。
3. confirmation email に予約日時、予約者名、人数、料金が含まれる。
4. detailUrl がある場合、確認URLがHTMLとtextに含まれる。
5. cancelUrl がある場合、キャンセルURLがHTMLとtextに含まれる。
6. lineClaimUrl がある場合、LINE連携URLがHTMLとtextに含まれる。
7. provider.email.footerText がフッターに反映される。
8. provider.colors.primary がHTML内の主要色に反映される。
9. RESEND_FROM_NAME が空なら provider.email.fromName を使う。
10. RESEND_FROM_EMAIL が空でも予約作成は失敗扱いにしない。
```

推奨テスト:

```text
apps/worker/src/providers/email-templates.test.ts
apps/worker/src/services/reservation-email.test.ts
```

### 4. Web管理画面のprovider反映テスト

対象:

```text
apps/web/src/app/reservation-ops/page.tsx
apps/web/src/app/reservations/page.tsx
apps/web/src/app/templates/page.tsx
apps/web/src/lib/api.ts
```

目的:

```text
管理画面の初期文言や外部取り込み表示が provider-config に従うこと。
既存API_KEY管理画面の認証・API呼び出しは変えないこと。
```

テストケース:

```text
1. /reservation-ops は providerConfig.externalImport.label を設定ボタン名に使う。
2. externalImport.enabled=false のとき、外部取り込み設定ボタンを表示しない。
3. providerConfig.externalImport.defaultQuery が Gmail rule draft の初期値になる。
4. providerConfig.externalImport.defaultFromEmail が Gmail rule draft の初期値になる。
5. 既存のGmail import rule は providerConfig変更で削除・更新されない。
6. /reservations の予約導線URL説明文に provider shortName/displayName が反映される。
7. /templates の予約導線カード初期値に provider shortName / introBody / heroImageUrl / primaryColor が反映される。
8. provider-config取得失敗時は従来のfallback値で画面が壊れない。
9. API_KEYをlocalStorageから読む管理画面仕様は変わらない。
10. provider-config APIにAuthorizationが付いていても問題なく取得できる。
```

推奨テスト:

```text
apps/web/src/app/reservation-ops/page.test.tsx
apps/web/src/app/reservations/page.test.tsx
apps/web/src/app/templates/page.test.tsx
```

MVPではNext.jsページ単体の自動テストが未整備なため、まずは以下をCIの最低ラインにする。

```text
pnpm --filter worker build
pnpm --filter web build
pnpm --filter @line-crm/db test
```

その後、provider UIの単体テストを追加する。

## 受け入れ条件

provider化の実装は、次を満たしたら完了とする。

```text
1. PROVIDER_ID=aonisai で現行アオニサイ予約画面が壊れない。
2. PROVIDER_ID=generic でアオニサイ固有文言・画像・カフェタブが表示されない。
3. provider-config APIにSecret値が混ざらない。
4. メール本文に確認URL・キャンセルURL・LINE連携URLが入る。
5. 外部取り込みを使わないproviderではGmail/じゃらん設定が非表示になる。
6. 外部取り込みを使うproviderでは初期query/from/labelがprovider設定から入る。
7. 予約作成、在庫消費、キャンセル、Google Calendar同期の既存テストが通る。
8. Web管理画面とWorker予約画面のproduction buildが通る。
```

## 手動確認チェックリスト

自動テストだけでは見た目の崩れを検知しきれないため、デプロイ前に次を確認する。

```text
1. /?page=book を開き、タイトル・ロゴ・説明・色がprovider設定通りか。
2. generic providerでカフェタブが出ないか。
3. aonisai providerでカフェタブが出るか。
4. 日付選択、時間枠選択、人数入力、詳細入力、確認、予約確定が動くか。
5. Web予約完了メールが届き、時刻がJSTで表示されるか。
6. メールの確認URL、キャンセルURL、LINE連携URLが開けるか。
7. /reservation-ops の設定モーダルに外部取り込み設定がprovider通りに出るか。
8. /templates の予約導線カード初期値がprovider通りか。
9. /reservations の予約導線URLが正しく生成されるか。
10. 既存のLINE webhook、チャット、broadcastに影響がないか。
```

## 最初にやるべき実装

最初にやるべきは、UIを全部汎用化することではない。

まず以下だけ切り出す。

```text
PROVIDER_NAME
PROVIDER_SHORT_NAME
PROVIDER_ADDRESS
PROVIDER_PHONE
PROVIDER_PRIMARY_COLOR
PROVIDER_ACCENT_COLOR
PROVIDER_LOGO_URL
PROVIDER_HERO_IMAGE_URL
EMAIL_HERO_IMAGE_URL
BOOKING_INTRO_TITLE
BOOKING_INTRO_BODY
BOOKING_ENABLE_CAFE_TAB
```

これで、別事業者導入時に最低限「名前・色・画像・説明文・メール」が差し替えられる。

## 注意点

### 予約DBは事業者ごとに分ける

同一D1に複数事業者を入れるマルチテナント方式は、今の段階では避ける。

理由:

- 予約情報・顧客情報・LINE友だち情報が混ざるとリスクが大きい。
- 権限管理が複雑になる。
- 事故時の復旧が難しい。

現実的には、事業者ごとにCloudflare Worker / D1 / R2 / Pagesを分ける。

```text
client-a-worker
client-a-d1
client-a-r2
client-a-pages
```

コードは同じ、環境だけ違う構成にする。

### Secrets Store binding名は固定する

コード側のbinding名は変えない。

```text
API_KEY
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
RESEND_API_KEY
```

事業者ごとにSecrets Storeの中身だけ変える。

## 結論

横展開で重要なのは、コードをマルチテナント化することではなく、デプロイ単位を事業者ごとに分け、設定だけ差し替えること。

最初の目標はこれ。

```text
同じGitHub repo
同じworkflow
別GitHub Environment
別Cloudflare Worker / D1 / R2 / Pages
別Secrets Store
別Provider Config
```

この構成なら、別事業者導入時にコードを触らず、GitHub Variables / Secrets とCloudflareリソースを変えるだけで導入できる。
