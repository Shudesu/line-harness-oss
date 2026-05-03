# 103. 予約画面UXフロー設計

この文書は、LIFF予約画面と予約管理画面の画面仕様を定義する。

実機のLINE LIFF確認は後工程とし、先に「ユーザーが迷わず予約できること」「管理者が枠と予約を壊さず扱えること」を満たす画面を作る。

## ゴール

- ユーザーは、日付、時間、残り枠を見て、スマホだけで予約できる。
- ユーザーは、予約前に入力内容を確認できる。
- ユーザーは、予約完了後に予約内容、注意事項、キャンセル導線を確認できる。
- 管理者は、同じ空き枠情報を見ながら、予約状況、残数、外部取り込み、枠調整を確認できる。
- hotpepper beautyのように、日付と時間の空き状況が直感的に分かるUIにする。

## LIFF予約画面

URL:

```text
/book?resourceId={RESOURCE_ID}&menuId={MENU_ID}
```

LINE LIFF本番URL:

```text
https://liff.line.me/{LIFF_ID}?page=reservation&resourceId={RESOURCE_ID}&menuId={MENU_ID}
```

実装状況:

- `apps/worker/src/client/booking.ts` に、予約トップ、1週間/1か月空き枠表示、受付入力、予約確認、予約完了、自分の予約一覧、予約詳細、キャンセル確認、キャンセル完了を実装済み。
- 公開APIは `LIFF_SESSION_TOKEN` を使い、`lineUserId` query指定は使わない。
- 予約作成後の `detailToken` / `cancelToken` はlocalStorageに保存し、同じ端末・同じブラウザで予約詳細/キャンセル導線に使う。
- 別端末やlocalStorage消去後は、LIFF sessionから本人予約の `detailToken` / `cancelToken` を再発行する。

### 画面一覧

| 画面 | 目的 | 実装優先度 |
|---|---|---|
| 予約トップ | メニュー、人数、日付、時間を選ばせる | 必須 |
| 空き枠カレンダー | 1週間/1か月の空き状況を表示する | 必須 |
| 受付入力 | 名前、電話、メール、人数、備考を入力する | 必須 |
| 予約確認 | 送信前に内容を確認する | 必須 |
| 予約完了 | 予約ID、日時、人数、注意事項、キャンセル導線を表示する | 必須 |
| 自分の予約一覧 | 今後の予約を確認する | 次点 |
| 予約詳細 | 予約内容、状態、キャンセル可否を表示する | 次点 |
| キャンセル確認 | キャンセル前に確認する | 次点 |
| キャンセル完了 | キャンセル結果を表示する | 次点 |

### 予約トップ

表示するもの:

- 施設名または予約対象名
- メニュー名
- 所要時間
- 料金目安
- 人数選択
- 日付表示モード切替: `1週間` / `1か月`
- 空き枠カレンダー

初期表示:

- スマホでは `1週間` 表示を初期値にする。
- 横幅が広い場合は `1か月` 表示に切り替えられる。
- 最短予約可能日から表示する。
- 過去日は選択不可。

### 空き枠カレンダー

hotpepper beauty型の見せ方に寄せる。

1週間表示:

```text
        5/10  5/11  5/12  5/13  5/14  5/15  5/16
09:00     ◎     △     ×     ◎     ◎     △     ×
10:00     △     ×     ×     ◎     △     △     ×
11:00     ◎     ◎     △     ×     ◎     ×     ×
```

1か月表示:

- 月カレンダーに日別の空き概要を出す。
- 日付を押すと、その日の時間別枠を下に表示する。

表示記号:

| 表示 | 意味 |
|---|---|
| `◎` | 残り3枠以上 |
| `△` | 残り1〜2枠 |
| `×` | 満席 |
| `-` | 予約不可、休業、未生成 |

残数表示:

- `残り5`
- `残り2`
- `満席`
- `受付停止`

重要な制約:

- 表示の残数は `lineRemainingCapacity` を使う。
- `status='open'` でも `lineRemainingCapacity <= 0` なら満席表示にする。
- クライアント側で空き判定を信用しない。予約作成時は必ずサーバー側の条件付きUPDATEで再判定する。

### 受付入力

入力項目:

| 項目 | 必須 | 備考 |
|---|---|---|
| 大人人数 | 必須 | 初期値1 |
| 子ども人数 | 任意 | 初期値0 |
| 氏名 | 必須 | LIFF profile名を初期値にして編集可 |
| 電話番号 | 必須 | 数字、ハイフン許可 |
| メール | 任意 | 予約控え送信を将来入れるため |
| 備考 | 任意 | 犬連れ、到着遅れ、質問など |

バリデーション:

- `adultCount + childCount >= menu.min_people`
- `menu.max_people` がある場合は超過不可。
- 電話番号は空欄不可。
- slot未選択では確認画面へ進めない。

### 予約確認

送信前に表示するもの:

- 予約対象
- メニュー
- 日付
- 時間
- 人数
- 氏名
- 電話番号
- メール
- 備考
- キャンセルポリシー

ボタン:

- `予約を確定する`
- `入力に戻る`

送信時の挙動:

- 二重送信防止でボタンをdisabledにする。
- API失敗時はエラー内容を表示し、再送できるようにする。
- 在庫不足の場合は、最新の空き枠を再取得して「満席になりました」と表示する。

### 予約完了

表示するもの:

- `予約を受け付けました`
- 予約ID
- 日時
- メニュー
- 人数
- 氏名
- 電話番号
- 注意事項
- `予約詳細を見る`
- `キャンセルする`
- `LINEに戻る`

token利用:

- 詳細表示は `detailToken` を使う。
- キャンセルは `cancelToken` を使う。
- `detailToken` でキャンセルできないようにする。

### 自分の予約一覧

表示条件:

- `LIFF_SESSION_TOKEN` を持つユーザーのみ。
- `lineUserId` query指定は使わない。

表示するもの:

- 今後の予約
- 過去の予約
- ステータス
- キャンセル可否

API:

```text
GET /api/public/me/reservations
Authorization: Bearer LIFF_SESSION_TOKEN
```

## 予約管理画面

URL:

```text
/admin/reservations
```

実装状況:

- `apps/worker/src/client/reservations-admin.ts` に、1週間/1か月の枠カレンダーを追加済み。
- LIFF予約画面と同じ `◎ / △ / × / -` の空き状況表示を使う。
- カレンダーの日付を押すと、下のslot一覧・予約一覧・詳細操作対象日が切り替わる。
- slot編集UIには、安全制約の説明を表示する。実際の保存時制約はWorker APIとDB helperで担保する。

### 画面一覧

| 画面 | 目的 | 実装優先度 |
|---|---|---|
| 予約ダッシュボード | 今日/週/月の予約と残数を把握する | 必須 |
| 枠カレンダー | LIFFと同じ枠表示で残数を管理する | 必須 |
| 予約一覧 | 日付、状態、予約元で絞り込む | 必須 |
| 予約詳細 | 顧客、予約、状態遷移、イベント履歴を確認する | 必須 |
| 枠編集 | total/line/external/buffer/statusを安全に変更する | 必須 |
| 外部取り込みレビュー | じゃらん/Gmailのneeds_reviewを処理する | 必須 |
| リソース/メニュー/スケジュール設定 | 予約対象と営業ルールを管理する | 必須 |
| Google Calendar連携 | 接続開始、connection ID確認、同期状態確認 | 次点 |
| AI/MCPチャット | 将来、自然言語で予約確認・操作する | 将来 |

### 予約ダッシュボード

表示するもの:

- 今日の予約数
- 明日の予約数
- 今週の予約数
- 満席枠数
- 要確認の外部取り込み数
- Google Calendar同期失敗数

優先アクション:

- `今日の予約を見る`
- `要確認を処理する`
- `枠を追加する`
- `Google Calendarを接続する`

### 枠カレンダー

LIFFと同じ空き枠記号を使う。

管理者向け追加表示:

- total remaining
- line remaining
- external remaining
- reserved_count
- line_reserved_count
- external_reserved_count
- buffer_capacity
- status

重要な制約:

- 予約が存在するslotは削除しない。
- 停止は `status='closed'` または `hidden` で表現する。
- `line_capacity < line_reserved_count` は保存不可。
- `external_capacity < external_reserved_count` は保存不可。
- `total_capacity < reserved_count + buffer_capacity` は保存不可。

### 予約一覧

フィルタ:

- 日付
- 予約対象
- メニュー
- ステータス
- 予約元 `source`
- 在庫チャネル `capacity_channel`
- 外部取り込み状態

表示列:

- 時間
- 氏名
- 人数
- 電話
- メニュー
- ステータス
- 予約元
- 在庫チャネル
- Google Calendar同期状態

### 予約詳細

表示するもの:

- 予約ID
- 顧客情報
- slot情報
- 人数
- 金額またはメニュー情報
- source
- capacity_channel
- 状態
- イベント履歴
- 外部予約番号
- Gmail message ID
- Google Calendar event ID

操作:

- confirmedへ変更
- cancelledへ変更
- completedへ変更
- no_showへ変更
- 備考更新

安全制約:

- 状態変更は必ず状態遷移表を通す。
- キャンセル時の在庫戻しは1回だけ。
- `source` ではなく `capacity_channel` で戻すカウンタを決める。
- `completed` / `no_show` からのキャンセルで在庫を戻さない。

### 外部取り込みレビュー

対象:

- `parse_status='needs_review'`
- `event_type='updated'`
- 枠不足
- dedupeKey衝突
- 対応slot未確定

操作:

- 既存予約に紐づける
- 新規予約として確定する
- ignoredにする
- 手動でslotを選ぶ
- raw textを見る

MVPでは、`updated` は自動反映しない。

## テスト方針

### LIFF画面テスト

- 日付を選ぶとslot APIを呼ぶ。
- 残数0は選択できない。
- 人数、電話番号が未入力なら確認へ進めない。
- 確認画面で入力内容が正しく表示される。
- 予約作成成功で完了画面が出る。
- 在庫不足エラーで最新slotを再取得する。
- detailTokenではキャンセルできない。
- cancelTokenでキャンセルできる。

### 管理画面テスト

- API_KEY未入力なら管理APIを呼ばない。
- slot更新で予約済み数を下回るcapacityは拒否される。
- closed slotにはLIFF側で予約できない。
- 予約キャンセルで残数が1回だけ戻る。
- needs_reviewをignoredにできる。
- updated取り込みは予約を直接変更しない。

### CIで守ること

- `pnpm --filter @line-crm/db test`
- `pnpm --filter @line-harness/sdk test`
- `pnpm --filter worker build`

UIの実機確認は後工程だが、API契約と在庫不変条件はCIで先に守る。

## ローカル手動確認チェックリスト

実機LINE確認の前に、ローカルWorkerで画面の基本操作を確認する。

準備:

```bash
pnpm db:migrate:local
pnpm db:seed:reservations:local
pnpm dev:worker
```

管理画面:

```text
URL: http://localhost:8787/admin/reservations
API_KEY: apps/worker/.dev.vars の API_KEY
```

確認すること:

- APIキーを入力して `読込` を押すと、resource、slot、予約一覧が表示される。
- `1週間` 表示で、日付 x 時間の枠が `◎ / △ / × / -` で見える。
- `1か月` 表示で、日別の空き概要が見える。
- カレンダーの日付を押すと、下のslot一覧と予約一覧の日付が切り替わる。
- slotの `status`, `totalCapacity`, `lineCapacity`, `externalCapacity`, `bufferCapacity`, `note` を保存できる。
- 予約済み人数を下回るcapacity変更はAPIエラーになる。
- 予約詳細を開ける。
- active予約をキャンセルできる。
- キャンセル後に在庫が1回だけ戻る。
- `needs_review` の外部取り込みを確認済みにできる。

LIFF予約画面:

```text
URL: http://localhost:8787/book?resourceId=res_blueberry&menuId=menu_blueberry_60
```

本物のLIFF ID tokenが必要なため、ローカルPCブラウザだけでは完全確認できない。画面表示だけ確認する場合は、LIFF session作成部分で止まることを許容する。

実機前に確認すること:

- `resourceId` / `menuId` がない場合、分かるエラーが出る。
- LINEアプリ内で開くと、LIFF profile取得後に予約画面へ進む。
- 1週間/1か月の空き枠表示が見える。
- 人数、氏名、電話番号、メール、備考を入力できる。
- 確認画面に入力内容が正しく出る。
- 予約完了画面に予約ID、日時、詳細導線、キャンセル導線が出る。
- 自分の予約一覧が見える。
- 同じ端末で作成した予約は `cancelToken` によりキャンセルできる。

注意:

- 別端末やlocalStorage削除後は、予約詳細画面の「キャンセル導線を復旧する」から `cancelToken` を再発行する。

## 実装順序

1. LIFF予約画面の受付入力、確認、完了を完成させる。
2. LIFF予約一覧、予約詳細、キャンセルを追加する。
3. 管理画面の枠カレンダーをLIFFと同じ表示ルールに揃える。
4. 管理画面の予約詳細と状態変更を強化する。
5. 外部取り込みレビュー画面を強化する。
6. Google Calendar接続状態と同期結果を管理画面に出す。
7. 実機LIFF確認、LINE Developers設定、Cloudflare本番deploy確認を行う。
