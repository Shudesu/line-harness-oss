# 103. 予約UXフロー再設計

この文書は、予約LIFF画面と予約管理画面のUX仕様を定義する。

方針は次の通り。

- LIFF画面は、既存のDOM要素とCSSをできるだけ残す。
- LIFF画面のTypeScript処理は、一度シンプルに作り直す。
- 予約管理画面は、操作性は大きく変えず、`resource` / `menu` / `schedule` の意味と操作導線を分かりやすくする。
- 在庫・予約状態・認可の安全性は、Worker APIとDB helperで担保する。フロントエンドは見やすさと誤操作防止に集中する。

## LIFF予約画面

### 目的

ユーザーがスマホで迷わず予約できる画面にする。

MVPでは、次の5ステップだけに絞る。

```text
1. 予約対象とメニューを選ぶ
2. 人数を選ぶ
3. 日付と時間枠を選ぶ
4. 氏名・電話番号などを入力する
5. 予約確認 → 予約完了
```

次の機能は、LIFF予約画面のMVPから外す。

- 自分の予約一覧
- 予約詳細画面
- LIFF内キャンセル
- token再発行UI
- 複雑なタブ切替

キャンセルや変更は、MVPでは完了画面に「LINEから店舗へ連絡してください」と表示する。

### URL

推奨URL:

```text
/book?resourceId={RESOURCE_ID}&menuId={MENU_ID}
```

LINE LIFF Endpoint URL:

```text
https://liff.line.me/{LIFF_ID}?page=book&resourceId={RESOURCE_ID}&menuId={MENU_ID}
```

`resourceId` と `menuId` がない場合は、公開APIから有効なresource/menuを取得して先頭を選ぶ。ただし、取得失敗時に画面が「読み込み中」で止まらないよう、明確なエラーを出す。

## 残すDOM要素

現在の見た目は大きく変えない。TypeScriptを作り直しても、以下のDOM構造・class名はできるだけ維持する。

### 全体

```html
<div class="booking-page reservation-liff">
  <div class="booking-header">...</div>
  ...
</div>
```

使うclass:

- `.booking-page`
- `.reservation-liff`
- `.booking-header`
- `.eyebrow`
- `.card`
- `.loading-spinner`
- `.message`
- `.error`

### 予約内容パネル

```html
<section class="booking-panel">
  <div class="section-title-row">
    <h2>予約内容</h2>
    <p>予約対象 / メニュー / 所要時間</p>
  </div>

  <label class="field-label">
    予約対象
    <select data-field="resourceId">...</select>
  </label>

  <label class="field-label">
    メニュー
    <select data-field="menuId">...</select>
  </label>

  <div class="people-grid">...</div>

  <div class="view-toggle">
    <button data-action="view-week">1週間で見る</button>
    <button data-action="view-month">1か月で見る</button>
  </div>
</section>
```

使うclass:

- `.booking-panel`
- `.section-title-row`
- `.field-label`
- `.people-grid`
- `.view-toggle`
- `.active`

### 空き状況 週表示

```html
<section class="booking-panel availability-panel">
  <div class="calendar-header">
    <button class="cal-nav" data-action="prev-week">&lt;</button>
    <div>
      <h2>空き状況</h2>
      <p>対象週</p>
    </div>
    <button class="cal-nav" data-action="next-week">&gt;</button>
  </div>

  <div class="week-matrix">
    <div class="week-cell week-head">時間</div>
    <button class="week-cell week-day" data-date="YYYY-MM-DD">...</button>
    <button class="week-cell mark many" data-slot-id="...">...</button>
  </div>
</section>
```

使うclass:

- `.availability-panel`
- `.calendar-header`
- `.cal-nav`
- `.week-matrix`
- `.week-cell`
- `.week-head`
- `.week-time`
- `.week-day`
- `.mark`
- `.many`
- `.few`
- `.full`
- `.none`
- `.selected`
- `.week-empty`

### 空き状況 月表示

```html
<section class="booking-panel availability-panel">
  <div class="calendar-header">
    <button class="cal-nav" data-action="prev-month">&lt;</button>
    <div>
      <h2>YYYY年M月</h2>
      <p>日付を押すと時間別の枠を表示します</p>
    </div>
    <button class="cal-nav" data-action="next-month">&gt;</button>
  </div>

  <div class="cal-weekdays">...</div>
  <div class="month-grid">
    <button class="month-day many" data-date="YYYY-MM-DD">...</button>
  </div>
</section>
```

使うclass:

- `.cal-weekdays`
- `.month-grid`
- `.month-day`
- `.empty`
- `.many`
- `.few`
- `.full`
- `.selected`

### 時間枠一覧

```html
<section class="booking-panel">
  <h2>選択日</h2>
  <div class="slots-grid">
    <button class="slot-btn available" data-slot-id="...">...</button>
    <button class="slot-btn full" disabled>...</button>
  </div>
</section>
```

使うclass:

- `.slots-grid`
- `.slot-btn`
- `.available`
- `.full`
- `.selected`
- `.muted`
- `.slots-loading`

### 受付情報

```html
<section class="booking-panel">
  <h2>受付情報</h2>
  <label class="field-label">氏名<input data-field="customerName"></label>
  <label class="field-label">電話番号<input data-field="customerPhone"></label>
  <label class="field-label">メール<input data-field="customerEmail"></label>
  <label class="field-label">備考<textarea data-field="note"></textarea></label>
</section>
```

### 予約確認

```html
<section class="booking-panel confirm-card">
  <h2>予約内容の確認</h2>
  <div class="confirm-details">
    <div class="confirm-row">
      <span class="confirm-label">日付</span>
      <span class="confirm-value">...</span>
    </div>
  </div>
  <div class="booking-actions split">
    <button class="close-btn" data-action="back-booking">入力に戻る</button>
    <button class="book-btn" data-action="submit-booking">予約を確定する</button>
  </div>
</section>
```

使うclass:

- `.confirm-card`
- `.confirm-details`
- `.confirm-row`
- `.confirm-label`
- `.confirm-value`
- `.booking-actions`
- `.split`
- `.book-btn`
- `.close-btn`
- `.policy-note`

### 予約完了

```html
<section class="success-card">
  <div class="success-icon">✓</div>
  <h2>予約を受け付けました</h2>
  <p class="success-message">予約ID: ...</p>
  <button class="close-btn" data-action="close">LINEに戻る</button>
</section>
```

使うclass:

- `.success-card`
- `.success-icon`
- `.success-message`
- `.close-btn`

## 残すCSS

`apps/worker/index.html` の既存CSSは、次のまとまりを残す。

### 共通CSS

- `body`
- `#app`
- `.card`
- `.loading-spinner`
- `.message`
- `.error`

### LIFF予約画面CSS

- `.booking-page`
- `.booking-header`
- `.reservation-liff`
- `.eyebrow`
- `.booking-panel`
- `.section-title-row`
- `.field-label`
- `.people-grid`
- `.view-toggle`
- `.calendar-header`
- `.cal-nav`
- `.cal-weekdays`
- `.month-grid`
- `.month-day`
- `.week-matrix`
- `.week-cell`
- `.week-head`
- `.week-time`
- `.week-day`
- `.mark`
- `.slots-grid`
- `.slot-btn`
- `.confirm-card`
- `.confirm-details`
- `.confirm-row`
- `.book-btn`
- `.booking-actions`
- `.policy-note`
- `.muted`
- `.success-card`
- `.success-icon`
- `.close-btn`
- `@media (max-width: 420px)`

次のCSSはMVPでは使わないなら削除候補にする。

- `.booking-tabs`
- `.mini-btn`
- `.text-btn`
- `.reservation-list`
- `.reservation-card`
- `.muted-icon`
- `.confirm-section`
- `.booking-calendar`
- `.cal-days`
- `.cal-day`
- `.slots-section`
- `.no-slots`

削除候補はすぐ消さず、TypeScript作り直し後に未使用classを確認してから削除する。

## LIFF TypeScript 再設計

### 基本方針

イベント処理を「日付を押したら全部更新」のような暗黙トリガーにしない。

各操作は、必ず独立したactionとして扱う。

```text
resource変更
menu変更
人数変更
表示モード変更
前週/次週
前月/次月
日付選択
slot選択
確認へ進む
入力に戻る
予約確定
```

### ファイル構成

```text
apps/worker/src/client/booking.ts
  initBookingだけを公開する入口。

apps/worker/src/client/booking/state.ts
  BookingState、初期状態、selectedMenuなど。

apps/worker/src/client/booking/api.ts
  fetchResourceList、fetchMenus、fetchSlots、createReservation、createSession。

apps/worker/src/client/booking/actions.ts
  ユーザー操作ごとの状態更新。

apps/worker/src/client/booking/render.ts
  DOM文字列生成。副作用を持たない。

apps/worker/src/client/booking/events.ts
  data-action / data-field / data-date / data-slot-id のイベントbinding。

apps/worker/src/client/booking/date.ts
  日付処理。

apps/worker/src/client/booking/types.ts
  型定義。
```

`render.ts` は状態を変更しない。`events.ts` はDOMイベントをactionへ渡すだけにする。API呼び出しは `actions.ts` からだけ行う。

### 状態設計

```ts
type BookingStep = 'input' | 'confirm' | 'success';
type ViewMode = 'week' | 'month';

type BookingState = {
  step: BookingStep;
  liffReady: boolean;
  loadingInitial: boolean;
  loadingSlots: boolean;
  submitting: boolean;

  resourceId: string | null;
  menuId: string | null;
  resources: Resource[];
  menus: Menu[];

  viewMode: ViewMode;
  weekStart: string;
  currentMonth: string;
  selectedDate: string | null;
  selectedSlotId: string | null;
  slotsByDate: Record<string, Slot[]>;

  form: {
    adultCount: number;
    childCount: number;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    note: string;
  };

  sessionToken: string | null;
  lastReservation: Reservation | null;
  notice: string | null;
  error: string | null;
};
```

重要なルール:

- `selectedSlotId` だけを真実にする。`selectedSlot` オブジェクトを別で持たない。
- slot本体は `slotsByDate` から毎回導出する。
- `resourceId` / `menuId` / 人数が変わったら、`selectedDate` と `selectedSlotId` を必ずリセットする。
- `viewMode` 変更では、`selectedDate` と `selectedSlotId` をリセットする。
- APIの古いレスポンスで新しい状態を上書きしないよう、`requestSeq` を持つ。

### API取得設計

初期化:

```text
initBooking
  → LIFF profile取得
  → reservation-session作成
  → resources取得
  → resourceId決定
  → menus取得
  → menuId決定
  → visible datesのslots取得
  → render
```

resource取得:

```text
GET /api/public/reservation-resources
```

失敗時:

- URLに `resourceId` があれば、fallback resourceとして表示する。
- URLに `resourceId` がなければ、明確なエラーを出す。
- 「予約対象を読み込み中」のまま止めない。

menu取得:

```text
GET /api/public/reservation-resources/:resourceId/menus
```

失敗時:

- `予約メニューを取得できません` を表示する。
- slot取得へ進まない。

slot取得:

```text
GET /api/public/reservation-resources/:resourceId/slots?date=YYYY-MM-DD&menuId=...&people=...
```

取得タイミング:

- 初期表示時に表示範囲の日付を取得する。
- `viewMode` を変えたら、その表示範囲の日付を取得する。
- 前週/次週、前月/次月で表示範囲を変えたら取得する。
- 日付を押した時点で未取得なら、その日だけ取得する。
- 人数変更時は残数判定が変わるため、表示範囲を再取得する。

### 表示モード設計

週表示:

```text
viewMode = week
weekStart = YYYY-MM-DD
visibleDates = weekStartから7日
```

月表示:

```text
viewMode = month
currentMonth = YYYY-MM
visibleDates = その月の全日付
```

注意:

- `1か月で見る` ボタンは、日付選択に依存しない。
- `前へ/次へ` ボタンは、日付選択に依存しない。
- カレンダーの日付タップは、`selectedDate` を変えるだけにする。
- `selectedDate` が変わっても、表示モードは変えない。

### イベント設計

イベントbindingは、次のように役割を固定する。

```text
data-action
  view-week
  view-month
  prev-week
  next-week
  prev-month
  next-month
  go-confirm
  back-booking
  submit-booking
  close

data-field
  resourceId
  menuId
  adultCount
  childCount
  customerName
  customerPhone
  customerEmail
  note

data-date
  YYYY-MM-DD

data-slot-id
  slot id
```

`data-date` のclick handlerで `data-action` を処理しない。逆も同じ。

推奨:

- `button` は必ず `type="button"` を付ける。
- click handlerでは `event.preventDefault()` を呼ぶ。
- `data-action` と `data-date` が同じ要素に付かないようにする。

### 予約確認

確認へ進む条件:

- resourceIdがある
- menuIdがある
- selectedDateがある
- selectedSlotIdがある
- 人数がmenu制約内
- 氏名がある
- 電話番号がある

確認画面ではAPIを呼ばない。表示だけにする。

予約確定時だけ `POST /api/public/reservations` を呼ぶ。

```text
確認画面
  → 予約を確定する
  → POST /api/public/reservations
  → 成功: success
  → 失敗: inputへ戻して最新slotを再取得
```

### 予約作成失敗時

在庫不足などで失敗した場合:

- `step='input'` に戻す。
- `selectedSlotId` を解除する。
- 表示範囲のslotsを再取得する。
- noticeに「満席になりました。別の時間を選んでください。」を出す。

### LIFF画面テスト観点

- resource取得失敗でも `resourceId` がURLにあれば読み込み中で止まらない。
- `1か月で見る` が日付未選択でも動く。
- `前週/次週` が日付未選択でも動く。
- `前月/次月` が日付未選択でも動く。
- 日付タップは日付選択だけを行う。
- slotタップはslot選択だけを行う。
- resource変更でslot選択が解除される。
- menu変更でslot選択が解除される。
- 人数変更でslot選択が解除され、slotsが再取得される。
- 確認画面ではAPIを呼ばない。
- 予約確定でだけ作成APIを呼ぶ。

## 予約管理画面

### 現状の課題

`resource` / `menu` / `schedule` が同じ画面内に並び、管理者から見ると「どれを先に作るべきか」「どれが何に影響するか」が分かりにくい。

操作性は既存のままでよいが、意味の説明と導線を整理する。

### 用語整理

| 用語 | 意味 | 例 |
|---|---|---|
| Resource | 予約対象。枠を持つ単位。 | ブルーベリー摘み取り、カフェ席 |
| Menu | ユーザーが選ぶプラン。resourceに属する。 | 食べ放題60分、摘み取り体験 |
| Schedule | slotを生成する曜日ルール。resourceに属する。 | 月曜 9:00-15:00 60分間隔 |
| Slot | 実際に予約できる日付と時間枠。scheduleから生成される。 | 2026-06-01 09:00 |
| Reservation | slotを押さえた予約本体。 | 山田太郎 2名 |

関係:

```text
Resource
  ├─ Menu
  ├─ Schedule
  └─ Slot
       └─ Reservation
```

### 管理画面の画面分離

#### 予約確認画面

URL:

```text
/admin/reservations
```

目的:

- 今日・今週・今月の予約状況を見る。
- slotの残数と予約客を見る。
- 必要最小限のslot調整をする。

ここでは `resource/menu/schedule` の設計変更を目立たせない。

表示:

- 管理APIキー
- resource選択
- 日付選択
- 週/月切替
- カレンダー
- 選択日のslot一覧
- 選択slotの予約客
- 予約詳細
- needs_review件数

操作:

- slotの軽微な調整
- 予約詳細確認
- active予約キャンセル
- needs_reviewを確認済みにする

#### 予約設計画面

URL:

```text
/admin/reservations/settings
```

目的:

- 予約の構造を作る。
- resource/menu/scheduleを管理する。
- Google Calendar接続とslot一括生成を管理する。

表示順序を次のように固定する。

```text
1. Resource
2. Menu
3. Schedule
4. Slot一括生成
5. Google Calendar
```

### 予約設計画面のUX改善案

#### 1. 上部に「作成手順」を表示する

```text
予約設計の手順
1. Resourceを作る
2. ResourceにMenuを追加する
3. ResourceにScheduleを追加する
4. ScheduleからSlotを生成する
5. LIFF画面で確認する
```

これにより、初見でも何をすればよいか分かる。

#### 2. Resource選択を常に上部に固定する

現在選択中のresourceを、設計画面の上部に固定表示する。

```text
現在編集中: ブルーベリー摘み取り
```

MenuとScheduleは、選択中resourceに属するものだけ表示する。

#### 3. Resourceカードに「影響範囲」を表示する

Resource編集は影響が大きいので、カード内に説明を出す。

```text
このResourceの変更は、この予約対象に属するMenu、Schedule、Slotに影響します。
既存予約は削除されません。
```

#### 4. Menuカードに「LIFF表示される」ことを明記する

Menuはユーザーが見るプランなので、管理用項目ではなく表示用項目として扱う。

```text
MenuはLIFF画面に表示される予約プランです。
所要時間はslot時間と一致している必要があります。
```

#### 5. Scheduleカードに「slot生成ルール」と明記する

Scheduleそのものは予約枠ではない。slotを作るための曜日ルールであることを強調する。

```text
Scheduleはslotを自動生成するための曜日ルールです。
Scheduleを作っただけでは予約枠は増えません。Slot一括生成を実行してください。
```

#### 6. Slot一括生成はScheduleの下に置く

Schedule設定直後にslot生成できるようにする。

```text
対象期間: 2026-06-01 〜 2026-06-30
実行: scheduleに従ってslotを生成
```

#### 7. Google Calendarは外部同期として分ける

Google Calendarは予約DBの本体ではない。外部同期先として明示する。

```text
Google Calendarは外部同期先です。
予約DBの内容を正とし、Google Calendarの予定でDBを直接上書きしません。
```

### 管理画面の安全制約

- Resource/Menu/Scheduleは物理削除しない。停止で扱う。
- 予約が存在するslotは削除しない。
- 予約済み数を下回るcapacity変更はAPIで拒否する。
- 一括操作は必ずプレビューを出す。
- Schedule変更だけでは既存slotを自動変更しない。
- Google Calendar連携失敗でも予約DBの作成・キャンセルを巻き戻さない。

### 管理画面テスト観点

- API_KEY未入力なら管理APIを呼ばない。
- Resource選択を変えるとMenu/Schedule/Slotが切り替わる。
- Menu作成は選択中Resourceに紐づく。
- Schedule作成は選択中Resourceに紐づく。
- Schedule作成だけではSlotは増えない。
- Slot一括生成でSlotが増える。
- 予約済みslotのcapacityを予約済み数未満にできない。
- 予約確認画面ではResource/Menu/Scheduleの作成UIが出ない。

## 実装順序

### LIFF画面

1. 既存DOM/CSSを固定する。
2. `BookingState` を `step`, `viewMode`, `selectedDate`, `selectedSlotId` 中心に作り直す。
3. `api.ts` に resource/menu/slot/reservation APIを集約する。
4. `actions.ts` に操作別の状態更新を集約する。
5. `events.ts` はDOMイベントをactionに渡すだけにする。
6. `render.ts` は状態からHTMLを返すだけにする。
7. ローカルで週/月切替、日付選択、slot選択、確認画面を確認する。

### 管理画面

1. 現状UIのまま、用語説明と作成手順を画面上に追加する。
2. Resource選択を設計画面上部に固定する。
3. Resource/Menu/Scheduleそれぞれに影響範囲の説明を追加する。
4. Slot一括生成をScheduleの直後に置く。
5. Google Calendarを外部同期セクションに分離する。
6. 余裕があればrenderファイルを分割する。

## CIで守ること

```text
pnpm --filter @line-crm/db test
pnpm --filter @line-harness/sdk test
pnpm --filter worker build
```

UIの実機確認は後工程でもよい。ただし、API契約と在庫不変条件はCIで先に守る。
