# 109. 他店舗向けシンプルWeb予約画面 設計

## 目的

LINE LIFFに依存しない、他店舗でも使えるシンプルなWeb予約画面を `apps/web` に構成する。

現在の予約画面は Worker 側のLIFF画面を中心に作られている。これはLINEユーザーの `idToken` を使える点では便利だが、Google Map、公式サイト、Instagram、広告、QRコードなどから来る通常Webユーザーには強くない。

この画面は、単なる「アオニサイ予約画面のWeb版」ではなく、他事業者に転用できる予約画面として作る。  
HTMLやメールの見た目は開発者が事業者ごとに作り、予約ロジックは共通化する。

今後は、顧客向け予約入口を次の2つに分ける。

```text
LINE内予約
  Worker LIFF画面
  LINE idTokenあり
  LINE友だち・予約確認・キャンセルと強く連携

Web予約
  apps/web の公開予約画面
  LINE idTokenなし
  氏名・電話・メールで予約
  予約後にメールとLINE連携導線を出す
```

## 結論

- 他店舗向けの汎用予約画面は `apps/web` に置く。
- 予約DBと在庫制御は既存Worker APIを使う。
- Web画面にAPI_KEYは埋め込まない。
- 顧客向けWeb予約は `guest session` で予約作成する。
- Web予約では `氏名 / 電話番号 / メール` を必須にする。
- 予約完了後はメールで確認URL・キャンセルURL・LINE連携URLを送る。
- LINE連携は任意。予約作成時点でLINE友だちに紐づかない前提で設計する。
- ブランド、色、画像、文言はProvider Configで差し替える。
- 予約画面HTMLはProvider Templateとして開発者が事業者ごとに作れるようにする。

## 108との関係

`108. 事業者別設定とブランド切替設計` は、事業者ごとの設定・テンプレート・外部連携をどう切り替えるかを定義する。

この109は、その設計を使って **顧客向けWeb予約画面をどう作るか** を定義する。

```text
108
  Provider Config
  Provider Template
  HTMLメール
  外部取り込み設定
  デプロイ単位

109
  /book Web予約画面
  予約フロー
  Web予約API
  UI状態管理
  顧客向け入力/確認/完了画面
```

## なぜWeb側に置くか

### Workerに置く場合

メリット:

- 既存LIFF画面とAPIの距離が近い。
- 既存の静的配信構成を流用できる。

デメリット:

- LINE Harness本体と予約申し込み画面が密結合になる。
- 店舗ごとのデザイン差し替えが難しい。
- Worker bundleが重くなりやすい。
- 予約画面の改善がLINE Harness本体のデプロイに巻き込まれる。

### Webに置く場合

メリット:

- 管理画面と同じNext.jsで作れる。
- 店舗別デザイン、LP、SEO、OGPを扱いやすい。
- LINE Harness本体と顧客向け予約UIを分離できる。
- 他店舗展開時にProvider Configで切り替えやすい。

デメリット:

- Worker APIとのCORS、guest session、公開API設計が必要。
- Web側に秘密情報を置けないため、API設計を丁寧に分ける必要がある。

最終方針:

```text
Web予約画面 = apps/web
予約API / 在庫制御 / メール送信 / LINE連携 = apps/worker
事業者別HTML/CSS = Provider Template
```

ただし、既存Worker LIFF画面は残す。  
LINE内予約は引き続きWorker LIFF画面を使い、LINE外流入はWeb予約画面を使う。

## 現在の実装状況

2026-05時点では、顧客向けの `apps/web /book` 画面は未実装。  
Web管理画面から、Worker側予約画面へ飛ばす導線URLを生成するところまで実装している。

```text
Web管理画面 /reservations
  予約導線URLを生成
  媒体 channel / ref / UTM を付与
  通常版 book と v2検証版 book-v2 を選択可能

Worker /?page=book
  既存main相当の予約画面
  本番の既存導線向け

Worker /?page=book-v2
  provider対応の新予約画面
  実機検証・他事業者テンプレート検証向け
```

本格的なWeb予約画面を作るまでは、通常の予約導線は `/?page=book` を使う。  
`/?page=book-v2` は検証用であり、本番導線に使う前にLIFF/ブラウザ両方で予約作成、確認、キャンセル、メール送信を確認する。

## 画面URL

推奨URL:

```text
https://reservation-admin.example.com/book
```

将来的に管理画面と顧客向け画面をドメイン分離する場合:

```text
https://reservation.example.com/
https://admin-reservation.example.com/
```

MVPでは同じPages project内に置いてよい。

```text
/book
/book/complete
/book/confirm
/book/cancel
```

## 予約フロー

Web予約は、スマホで見たときにカレンダーから入る。

```text
1. 店舗・体験の説明
2. Resource / Menu を選ぶ
3. カレンダーで日付を選ぶ
4. モーダルで時間枠を選ぶ
5. モーダルで人数を入力する
6. 氏名・電話番号・メールを入力する
7. 予約内容確認
8. 予約確定
9. 完了画面
10. 確認メール送信
```

画面で最初に見せるもの:

```text
ヒーロー画像
予約対象 / メニュー選択
月カレンダー
```

最初にフォームを見せすぎない。  
ユーザーはまず「いつ空いているか」を見たいので、日付選択を主役にする。

## UI構成

### 上部

```text
店舗ロゴ
店舗名
短い説明
予約する体験の選択
```

Provider Configから取得する。

```text
PROVIDER_DISPLAY_NAME
PROVIDER_DESCRIPTION
PROVIDER_LOGO_URL
PROVIDER_HERO_IMAGE_URL
PROVIDER_PRIMARY_COLOR
PROVIDER_ACCENT_COLOR
```

上部HTMLは事業者ごとにカスタマイズ可能にする。

```ts
export type WebBookingTemplate = {
  renderHero(input: WebBookingTemplateInput): ReactNode;
  renderIntro?(input: WebBookingTemplateInput): ReactNode;
  renderFooter?(input: WebBookingTemplateInput): ReactNode;
  theme: {
    primaryColor: string;
    accentColor: string;
    backgroundColor: string;
  };
};
```

注意:

- 予約フォーム本体は共通コンポーネントにする。
- Provider Templateが直接予約APIを叩かない。
- Provider Templateは見た目と文言だけ担当する。

### Resource / Menu

Resource:

```text
ブルーベリー摘み取り
カフェ席
いちご狩り
```

Menu:

```text
60分食べ放題
お土産付きプラン
カフェ席予約
```

他店舗向けには、Resource/Menu名をそのまま表示する。  
アオニサイ固有の「ブルーベリー予約」などの固定文言は使わない。

ただし、事業者ごとの説明文や注意書きはProvider Template側で追加できる。

例:

```text
農園: 雨天時の注意、服装、持ち物
美容室: 所要時間、キャンセルポリシー
体験施設: 対象年齢、集合場所
飲食店: 席種、アレルギー注意
```

### カレンダー

初期表示は月表示。

日付セルには細かい残数は出さない。

```text
○ 予約可能
△ 残り少ない
× 満席
- 枠なし
```

残数の数字は時間枠モーダル内だけに出す。

理由:

- 月表示で全slotの残数を出すとAPI負荷が大きい。
- ユーザーは日付選択前に細かい人数までは不要。
- 詳細な残数は日付タップ後に出せばよい。

### 時間枠モーダル

日付を押すと、その日の時間枠だけ取得する。

```text
09:00-10:00  ○
10:00-11:00  △ 残り2名
11:00-12:00  × 満席
```

ここでは残枠数を表示してよい。

表示する残枠は、Web予約で消費する `capacity_channel` に合わせる。  
MVPではWeb予約は自社枠として扱うため、`line_capacity` 側の残枠を表示する。

### 人数入力モーダル

時間枠を選ぶと人数入力に進む。

人数区分はMenu/Resource設定から取得する。

MVP:

```text
大人
小学生
幼児
3歳以下
```

将来:

```text
Resource/Menuごとの年齢区分定義
料金対象
人数カウント対象
枠消費対象
```

### 詳細入力

Web予約では必須:

```text
氏名
電話番号
メール
```

任意:

```text
備考
```

LINE予約ではメール任意だが、Web予約では必須にする。

## API設計

### Provider Config取得

```http
GET /api/public/provider-config
```

公開値だけ返す。

```json
{
  "displayName": "アオニサイファーム",
  "description": "つくばの観光農園",
  "colors": {
    "primary": "#272f72",
    "accent": "#69A3D0"
  },
  "assets": {
    "logoUrl": "https://...",
    "heroImageUrl": "https://..."
  }
}
```

Web予約画面は初期表示時にこのAPIを必ず読む。  
取得に失敗した場合は `generic` の最小表示でフォールバックする。

### guest session作成

```http
POST /api/public/reservation-session/guest
```

Request:

```json
{
  "channel": "website",
  "ref": "official_site",
  "utmSource": "google",
  "utmMedium": "profile",
  "utmCampaign": "summer_2026"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "token": "GUEST_SESSION_TOKEN",
    "expiresIn": 3600
  }
}
```

### Resource取得

```http
GET /api/public/reservation-resources
```

### Menu取得

```http
GET /api/public/reservation-resources/:resourceId/menus
```

### 月次空き概要

Web予約画面では、月カレンダー用の軽量APIを使う。

```http
GET /api/public/reservation-availability/month?resourceId=...&menuId=...&month=2026-06
```

現行実装では、近いAPIとして以下がある。

```http
GET /api/public/reservation-resources/:resourceId/availability-summary?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&menuId=...
```

MVPでは既存の `availability-summary` を使う。  
将来、Web画面向けに `/reservation-availability/month` を追加してもよい。

Response:

```json
{
  "success": true,
  "data": {
    "month": "2026-06",
    "days": [
      {
        "date": "2026-06-01",
        "status": "available"
      },
      {
        "date": "2026-06-02",
        "status": "few"
      },
      {
        "date": "2026-06-03",
        "status": "full"
      }
    ]
  }
}
```

`status`:

```text
available
few
full
none
```

ここでは予約残数の数字を返さない。

### 日別時間枠取得

```http
GET /api/public/reservation-slots?resourceId=...&menuId=...&date=2026-06-01&people=1
```

時間枠モーダルで使う。  
ここでは残枠数を返してよい。

### 予約作成

```http
POST /api/public/reservations
Authorization: Bearer GUEST_SESSION_TOKEN
```

Web予約では `customer.email` 必須。

Request:

```json
{
  "resourceId": "res_xxx",
  "menuId": "menu_xxx",
  "slotId": "slot_xxx",
  "adultCount": 2,
  "childCount": 1,
  "infantCount": 0,
  "underThreeCount": 0,
  "customer": {
    "name": "山田 太郎",
    "phone": "09012345678",
    "email": "taro@example.com"
  },
  "formData": {
    "note": "ベビーカーあり"
  }
}
```

## 在庫設計

Web予約は、自社予約枠を消費する。

```text
source = web
capacity_channel = line
```

ただし、DB移行が不安な環境では、`source` は既存enumに合わせ、流入元は `metadata.entry` に保存してもよい。

重要:

- 在庫判断は `source` ではなく `capacity_channel` で行う。
- Web予約もLINE予約と同じ自社枠を消費する。
- じゃらん/Gmail取り込みだけ `capacity_channel='external'` を使う。

## Web予約完了後

完了画面で表示するもの:

```text
予約を受け付けました
予約日時
人数
料金
確認メールを送信しました
LINEで予約確認すると便利です
```

メールに含めるもの:

```text
予約日時
人数
料金
予約確認URL
キャンセルURL
LINE連携URL
問い合わせ先
```

LINE連携は任意。

```text
Web予約
↓
メールのLINE連携URLを押す
↓
LIFF起動
↓
claimTokenで予約とLINE友だちを紐づけ
```

普通にLINEを友だち追加しただけでは、Web予約とは自動紐づけしない。  
予約ID + メールで連携メールを再送できる導線を用意する。

## HTMLメールとの関係

Web予約画面の完了表示とHTMLメールは、同じProvider Configを使う。

```text
Web完了画面
  予約を受け付けました
  確認メールを送信しました
  LINE連携導線

HTMLメール
  予約日時
  人数
  料金
  確認URL
  キャンセルURL
  LINE連携URL
```

HTMLメールのデザインは `108` の provider email template で開発者が作る。  
Web予約画面側ではメールHTMLを持たない。

## apps/web ファイル構成

```text
apps/web/src/app/book/page.tsx
apps/web/src/app/book/complete/page.tsx
apps/web/src/app/book/confirm/page.tsx
apps/web/src/app/book/cancel/page.tsx

apps/web/src/components/booking/booking-shell.tsx
apps/web/src/components/booking/provider-hero.tsx
apps/web/src/components/booking/resource-menu-select.tsx
apps/web/src/components/booking/month-calendar.tsx
apps/web/src/components/booking/slot-modal.tsx
apps/web/src/components/booking/people-modal.tsx
apps/web/src/components/booking/customer-form.tsx
apps/web/src/components/booking/booking-confirm.tsx
apps/web/src/components/booking/booking-complete.tsx

apps/web/src/lib/public-booking-api.ts
apps/web/src/lib/provider-config.ts
```

改訂後はProvider Templateを追加する。

```text
apps/web/src/providers/
  index.ts
  generic.tsx
  aonisai.tsx

apps/web/src/components/booking/
  booking-shell.tsx
  booking-core.tsx
  provider-hero-slot.tsx
  resource-menu-select.tsx
  month-calendar.tsx
  slot-modal.tsx
  people-modal.tsx
  customer-form.tsx
  booking-confirm.tsx
  booking-complete.tsx
```

`booking-core.tsx` は予約処理の中心。  
`providers/*.tsx` は見た目だけを担当する。

既存の管理画面用 `api.ts` はAPI_KEY前提なので、顧客向けWeb予約では使わない。  
公開予約用に `public-booking-api.ts` を分ける。

## 状態設計

```ts
type WebBookingStep =
  | 'select'
  | 'slot'
  | 'people'
  | 'customer'
  | 'confirm'
  | 'complete';

type WebBookingState = {
  provider: ProviderConfig | null;
  sessionToken: string | null;
  resourceId: string | null;
  menuId: string | null;
  month: string;
  selectedDate: string | null;
  selectedSlotId: string | null;
  people: {
    adult: number;
    child: number;
    infant: number;
    underThree: number;
  };
  customer: {
    name: string;
    phone: string;
    email: string;
    note: string;
  };
  loading: boolean;
  submitting: boolean;
  error: string | null;
};
```

ルール:

- Resource/Menu変更時は `selectedDate` と `selectedSlotId` を解除する。
- 日付選択では日別slotだけ取得する。
- 人数変更時は選択slotの空きチェックを再実行する。
- 予約作成は確認画面の確定ボタンでだけ実行する。
- メール送信失敗でも予約作成は取り消さない。

## Provider Config

他店舗展開では、コードではなく環境変数で見た目を変える。

最低限必要:

```text
PROVIDER_ID
PROVIDER_DISPLAY_NAME
PROVIDER_SHORT_NAME
PROVIDER_DESCRIPTION
PROVIDER_PRIMARY_COLOR
PROVIDER_ACCENT_COLOR
PROVIDER_LOGO_URL
PROVIDER_HERO_IMAGE_URL
PROVIDER_ADDRESS
PROVIDER_PHONE
PROVIDER_SITE_URL
```

任意:

```text
BOOKING_INTRO_TITLE
BOOKING_INTRO_BODY
BOOKING_NOTICE
BOOKING_ENABLE_LINE_LINK_PANEL
BOOKING_ENABLE_EXTRA_TAB
```

ただし、HTMLの構造まで変えたい場合は環境変数だけでは限界がある。  
そのため、次の2段階で対応する。

```text
軽い変更
  Provider Config
  店舗名、色、画像、説明文、注意文

大きい変更
  Provider Template
  Hero構成、紹介セクション、独自タブ、フッター
```

Provider Templateは開発者が作る。  
管理画面で自由HTMLを入力させる設計にはしない。

## 管理画面側に必要な設定

Web予約画面を他店舗で使うには、管理画面から以下を設定できる必要がある。

```text
Resource
Menu
Schedule
Slot
料金
人数区分
枠消費対象
予約導線URL
メール送信設定
Provider Config
```

MVPではProvider Configは環境変数でよい。  
将来は管理画面で編集してDBに保存する。

## 他事業者転用時の作業手順

新しい事業者に転用するときは、コードの予約ロジックを触らず、次の順番で対応する。

```text
1. GitHub Environmentを作る
2. Cloudflare Worker/D1/R2/Pagesを事業者用に作る
3. Secrets StoreにLINE/Google/Resend/Discordを設定する
4. PROVIDER_IDを決める
5. apps/web/src/providers/{providerId}.tsx を作る
6. apps/worker/src/providers/{providerId}/email-template.ts を作る
7. 画像をR2にアップロードする
8. Resource/Menu/Schedule/Slotを管理画面で作る
9. 必要なら外部取り込み設定を作る
10. /bookで予約テストする
```

この手順で済むようにするのが109のゴール。

## 他事業者転用で触ってはいけない箇所

通常の事業者追加では、次は触らない。

```text
packages/db/src/reservations.ts
apps/worker/src/routes/reservations/public.ts
apps/worker/src/services/reservation-tokens.ts
apps/worker/src/services/reservation-google-calendar.ts
apps/web/src/lib/api.ts
```

触るべき箇所:

```text
apps/web/src/providers/{providerId}.tsx
apps/worker/src/providers/{providerId}/config.ts
apps/worker/src/providers/{providerId}/email-template.ts
docs/providers/{providerId}.md
GitHub Environment variables/secrets
Cloudflare Secrets Store
R2 assets
```

## テスト設計

109では、顧客向けWeb予約画面そのものをテスト対象にする。  
Provider Configやメールテンプレート単体のテストは `108` に寄せ、ここでは「Web予約フローが壊れないか」を中心に確認する。

### API

1. guest sessionを作成できる。
2. guest sessionなしでは予約作成できない。
3. Web予約ではメールが必須。
4. Resource/Menu/Slotの不整合は拒否する。
5. 予約作成は条件付きUPDATEで在庫確保してから作る。
6. Web予約は `capacity_channel='line'` を消費する。
7. 予約完了メール送信に失敗しても予約は残る。
8. 予約確認URLはdetailTokenがないと見られない。
9. キャンセルURLはcancelTokenがないと実行できない。
10. LINE claimTokenは期限切れなら拒否する。

追加テスト:

11. `GET /api/public/provider-config` はAPI_KEYなしで取得できる。
12. `GET /api/public/provider-config` はSecret値を返さない。
13. `GET /api/public/reservation-resources` は公開中のResourceだけ返す。
14. `GET /api/public/reservation-resources/:resourceId/menus` は公開中のMenuだけ返す。
15. 月次空き概要APIは日別ステータスだけ返し、slot詳細を返さない。
16. 日別slot取得APIは選択日だけのslotを返す。
17. Web予約の作成時、`metadata.entry.channel/ref/utm` が保存される。
18. Web予約の作成時、`customerEmail` が空なら拒否される。
19. Web予約の作成時、`source='web'` を許可するDB schemaで動く。
20. `source='web'` でも在庫カウンタは `capacity_channel` で判定される。

### Web UI

1. API_KEYなしで予約画面を表示できる。
2. Provider Configが表示に反映される。
3. Resource/Menuを選べる。
4. 月カレンダーに `○/△/×/-` が表示される。
5. 日付タップで時間枠モーダルが開く。
6. 時間枠タップで人数入力へ進む。
7. 氏名・電話・メールが空なら確認へ進めない。
8. 予約確定中は二重送信できない。
9. 予約成功後に完了画面が出る。
10. 予約失敗時は選択slotを解除して最新空き状況を再取得する。

追加テスト:

11. Provider Config取得成功時、Hero/色/ロゴ/説明文が反映される。
12. Provider Config取得失敗時、generic fallbackで画面が表示される。
13. Provider Templateは予約APIを直接呼ばない。
14. 月カレンダー初期表示で全slot詳細を大量取得しない。
15. 日付タップ時だけ、その日のslot詳細を取得する。
16. 時間枠モーダルには残枠数を表示する。
17. 月カレンダーには細かい残枠数を表示しない。
18. 人数入力で選択slotの残枠を超える人数を入力できない。
19. 氏名・電話・メール未入力時、対象フィールドにエラー表示する。
20. 予約確定ボタンの連打で二重予約が作られない。

### Provider Template

対象:

```text
apps/web/src/providers/*
apps/web/src/components/booking/*
```

目的:

```text
他店舗向けに見た目を変えても、予約フォーム本体と予約API呼び出しが壊れないこと。
```

テストケース:

```text
1. generic template は店舗固有文言なしで表示できる。
2. aonisai template はアオニサイ向けHero/画像/色を表示できる。
3. Provider Templateは `renderHero` / `renderIntro` / `renderFooter` だけを担当する。
4. Provider Template内に `fetch` や予約作成API呼び出しを書かない。
5. Provider Templateがなくても generic template にfallbackする。
6. provider.colors.primary/accent/background がUIテーマに反映される。
7. provider.assets.logoUrl/heroImageUrl が空でも表示が崩れない。
8. provider.description が空でも予約フローに進める。
9. 画像URLが壊れていても予約フォーム本体は操作できる。
10. Provider Templateの変更で予約作成payloadが変わらない。
```

### E2Eシナリオ

本番前にPlaywrightまたは手動で確認するシナリオ。

```text
1. Google Map用URLから /book を開く。
2. Resource/Menuを選ぶ。
3. 月カレンダーで予約可能日を選ぶ。
4. 時間枠モーダルで空き枠を選ぶ。
5. 人数を入力する。
6. 氏名・電話・メールを入力する。
7. 確認画面で内容を確認する。
8. 予約を確定する。
9. 完了画面に確認メール送信案内が出る。
10. メールの確認URLを開く。
11. メールのキャンセルURLを開く。
12. キャンセル済みなら確認画面に「キャンセルされています」と出る。
13. LINE連携URLを開き、LIFF claim画面に遷移する。
14. 予約管理画面に `source=web` と流入metadataが保存される。
15. Google Calendar連携済みResourceなら予定が作成される。
```

### CIで最低限回すもの

```text
pnpm --filter web build
pnpm --filter worker build
pnpm --filter @line-crm/db test
```

Web予約画面の実装後に追加するもの:

```text
pnpm --filter web test
pnpm --filter worker test
```

テストファイル候補:

```text
apps/web/src/lib/public-booking-api.test.ts
apps/web/src/components/booking/month-calendar.test.tsx
apps/web/src/components/booking/booking-core.test.tsx
apps/web/src/providers/provider-template.test.tsx
apps/worker/src/routes/reservations/public-web.test.ts
```

## 実装順序

### Phase 1: Provider Config / Templateの土台

```text
Workerに GET /api/public/provider-config を作る
apps/web/src/providers/generic.tsx を作る
apps/web/src/providers/aonisai.tsx を作る
public-booking-api.ts を作る
```

### Phase 2: 最小Web予約画面

```text
/book を作る
Provider Hero
Resource/Menu選択
月カレンダー
日付タップ → slot modal
```

### Phase 3: 予約作成

```text
人数入力
詳細入力
確認画面
POST /api/public/reservations
完了画面
```

### Phase 4: メール・キャンセル・確認

```text
provider email templateを使う
確認URL
キャンセルURL
LINE連携URL
/book/confirm
/book/cancel
```

### Phase 5: 他店舗化

```text
PROVIDER_IDでテンプレート切替
画像・色・文言をProvider Config化
GitHub Environmentで店舗を切り替える
```

### Phase 6: 外部取り込みの事業者設定化

```text
外部取り込み表示名をProvider Config化
Gmail query初期値をprovider default化
じゃらんを使わない事業者では非表示にする
```

## 実装時の禁止事項

- Web予約画面に `API_KEY` を埋め込まない。
- 予約IDだけで予約詳細を返さない。
- LINE友だち追加だけでWeb予約を自動紐づけしない。
- `source` で在庫カウンタを判断しない。
- 月カレンダー表示時に全slot詳細を大量取得しない。
- 店舗固有文言をコンポーネントに直書きしない。
- Provider Templateから直接予約APIを叩かない。
- HTMLメール内にtoken生成ロジックを書かない。
- Resend送信者をコードに直書きしない。

## 最初のMVP

最初に作るべき範囲はこれ。

```text
/book
  Provider Hero
  Resource/Menu選択
  月カレンダー
  日付タップで時間枠モーダル
  人数入力
  氏名・電話・メール入力
  予約確認
  予約確定
  完了表示
```

メール、キャンセル、LINE連携は次の段階でもよい。  
ただし、Web予約ではメールを必須にし、後で確認・キャンセル・LINE連携が追加できるデータを必ず保存しておく。
