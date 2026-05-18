# 105. タグ・イベント計測戦略

## 目的

このドキュメントは、ブルーベリー観光農園の予約管理・LINE運用・キャンペーン改善のために、タグとユーザーイベントをどう設計するかを定義する。

## 実装状況

2026-05-18 時点では、まず安全性が高い順に以下を実装済み。

- `tags` に `kind`, `category`, `description`, `is_active`, `is_locked`, `updated_at` を追加し、システムタグとカスタムタグを分離した。
- `friend_tags` に `source`, `source_event_id`, `expires_at`, `metadata` を追加し、タグの付与元を追えるようにした。
- 予約作成・予約状態更新時に、友だちへ予約系システムタグを自動再計算する。
- システムタグは削除不可にし、管理者作成タグは `kind='custom'` として扱う。
- D1統合テストで、予約作成時のタグ付与とキャンセル時のタグ更新を確認する。

未実装:

- 汎用 `user_events`, `event_definitions`, `event_tag_rules`。
- リッチメニュー、予約導線、キャンペーンタップの統一イベント保存。
- 管理画面からのイベント定義・タグ自動付与ルール編集。

タグは「現在の分類」を表す。イベントは「いつ何が起きたか」を表す。

```text
タグ: 今その人がどういう状態か
イベント: その人が過去に何をしたか
```

予約状態、来園履歴、キャンペーン反応、リッチメニュー操作、LINE配信反応を分けて保存することで、次の判断ができるようにする。

- どの導線から予約が増えたか
- 予約後に来園した人はどのくらいいるか
- キャンセルが多い時間帯・導線はどこか
- リッチメニューのどのボタンが予約につながるか
- じゃらん・LINE・電話のどの経路が売上に効いているか
- 一斉配信後に予約・再訪・キャンセルがどう変わったか

## 現状の実装整理

### 既存タグ

現在のタグは `tags` と `friend_tags` で管理している。

```sql
tags (
  id,
  name,
  color,
  created_at
)

friend_tags (
  friend_id,
  tag_id,
  assigned_at,
  PRIMARY KEY (friend_id, tag_id)
)
```

既存の特徴:

- タグ名と色だけを持つ単純な構造。
- `friend_tags` は `INSERT OR IGNORE` で重複付与を防いでいる。
- タグ削除時は `friend_tags` も削除される。
- `GET /api/tags`, `POST /api/tags`, `DELETE /api/tags/:id` がある。
- `POST /api/friends/:id/tags`, `DELETE /api/friends/:id/tags/:tagId` がある。
- タグ付与時に `tag_change` イベントが発火し、シナリオ・Automation・Webhook に使える。

### 既存イベント・計測

汎用のユーザーイベント台帳はまだない。イベントは用途別テーブルに分散している。

| 領域 | 既存テーブル/機能 | 現状 |
|---|---|---|
| 予約 | `reservation_events` | 予約単位の状態変更履歴を保存 |
| 外部予約 | `external_reservation_sources` | じゃらん/Gmail取り込みイベントを保存 |
| トラッキングリンク | `tracked_links`, `link_clicks` | リンククリック、タグ付与、シナリオ登録が可能 |
| CV計測 | `conversion_points`, `conversion_events` | CVポイントとCVイベントを保存 |
| 広告CV | `ad_conversion_logs` | 外部広告連携ログを保存 |
| Automation | `automations`, `automation_logs` | イベント条件に応じた自動処理ログ |
| Webhook | `outgoing_webhooks`, `incoming_webhooks` | 外部通知・外部入力 |
| LINEメッセージ | `messages_log` | incoming/outgoing のメッセージ履歴 |
| リッチメニュー | LINE Platform側 | D1にはリッチメニュー実体を保存しない |

問題点:

- 「リッチメニューを押した」「予約ボタンを押した」「予約確認画面を開いた」などのユーザー行動を一つの形式で追えない。
- 予約状態は `reservations.status` と `reservation_events` で管理されているが、友だちに状態タグが自動付与されていない。
- カスタムタグはあるが、タグの分類・用途・自動付与ルールが管理画面上で明確ではない。
- 経営改善に必要な「導線 → 予約 → 来園 → 再訪」までの連続分析が弱い。

## 基本方針

### 1. 予約状態はDB状態遷移を正とし、タグは補助表示にする

予約の正しい状態は `reservations.status` と `reservation_events` が正本である。

タグはユーザー一覧・配信セグメント・Automation条件に使うための補助情報として扱う。

```text
予約DB状態 = 真実
システムタグ = 検索・配信・管理用のラベル
```

タグだけを見て予約状態を確定しない。予約キャンセルや複数予約がある場合に壊れるため。

### 2. システムタグとカスタムタグを分ける

タグには `kind` を持たせる。

| kind | 用途 |
|---|---|
| `system` | 予約状態・来園状態など、システムが自動管理する |
| `custom` | 管理者が自由に作る |

システムタグは管理画面で削除・改名できない。非表示設定は可能にしてよい。

カスタムタグは管理者が作成・編集・削除できる。

### 3. イベントは汎用台帳に保存する

ユーザー行動を `user_events` に保存する。

```text
LINEメッセージ受信
リッチメニュータップ
予約画面表示
予約枠選択
予約作成
予約キャンセル
予約確認表示
じゃらん取り込み
Google Calendar同期
配信クリック
フォーム送信
```

それぞれ別テーブルだけで管理すると横断分析が難しい。最終的には `user_events` を中心にダッシュボードを作る。

### 4. 管理者が柔軟にイベントとタグを紐づけられるようにする

管理者は次のようなルールを作れるようにする。

```text
event_type = rich_menu.tap
event_name = reservation
なら tag = 予約興味あり を付与

event_type = reservation.created
source = line
なら tag = LINE予約済み を付与

event_type = reservation.cancelled
なら tag = キャンセル経験あり を付与
```

既存Automationの `add_tag` アクションを活かす。ただし、UIではJSON直入力ではなく、フォームで設定できるようにする。

## 推奨DB設計

### tags 拡張

既存 `tags` にカラムを追加する。

```sql
ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'custom'
  CHECK (kind IN ('system', 'custom'));

ALTER TABLE tags ADD COLUMN category TEXT;
ALTER TABLE tags ADD COLUMN description TEXT;
ALTER TABLE tags ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tags ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tags ADD COLUMN updated_at TEXT;
```

追加カラムの意味:

| カラム | 説明 |
|---|---|
| `kind` | `system` / `custom` |
| `category` | `reservation`, `visit`, `campaign`, `interest`, `source`, `risk` など |
| `description` | 管理者向け説明 |
| `is_active` | 非表示・停止用 |
| `is_locked` | システムタグの削除・改名防止 |
| `updated_at` | 編集日時 |

互換性:

- 既存タグはすべて `kind='custom'` として扱う。
- 既存APIは壊さず、レスポンスに追加フィールドを足す。

### friend_tags 拡張

付与理由を追えるようにする。

```sql
ALTER TABLE friend_tags ADD COLUMN source TEXT DEFAULT 'manual'
  CHECK (source IN ('manual', 'system', 'automation', 'reservation', 'tracked_link', 'import'));

ALTER TABLE friend_tags ADD COLUMN source_event_id TEXT;
ALTER TABLE friend_tags ADD COLUMN expires_at TEXT;
ALTER TABLE friend_tags ADD COLUMN metadata TEXT;
```

使い方:

- `source='reservation'`: 予約作成・キャンセルなどから自動付与。
- `source='tracked_link'`: キャンペーンリンククリックから付与。
- `source='automation'`: 管理者設定のAutomationから付与。
- `expires_at`: 「一時的な興味あり」などを将来消すため。

### user_events 新規

汎用イベント台帳を追加する。

```sql
CREATE TABLE IF NOT EXISTS user_events (
  id TEXT PRIMARY KEY,
  line_account_id TEXT,
  friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  line_user_id TEXT,

  event_type TEXT NOT NULL,
  event_name TEXT,
  event_source TEXT NOT NULL DEFAULT 'system'
    CHECK (event_source IN ('line', 'liff', 'web', 'reservation', 'jalan', 'gmail', 'tracked_link', 'broadcast', 'automation', 'system')),

  subject_type TEXT,
  subject_id TEXT,

  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  session_id TEXT,
  request_id TEXT,

  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_events_friend_time ON user_events(friend_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_user_events_type_time ON user_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_user_events_subject ON user_events(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_user_events_line_account ON user_events(line_account_id, occurred_at);
```

設計意図:

- `event_type`: 機械的に使う固定名。
- `event_name`: 管理者がわかる名前、またはキャンペーン名。
- `event_source`: どこから発生したか。
- `subject_type`, `subject_id`: 予約、リンク、リッチメニュー、配信など対象物。
- `metadata`: 金額、人数、URL、ボタン名、予約日時などの詳細。

### event_definitions 新規

管理画面でイベントを柔軟に定義する。

```sql
CREATE TABLE IF NOT EXISTS event_definitions (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

例:

| event_type | name | category |
|---|---|---|
| `reservation.created` | 予約作成 | reservation |
| `reservation.cancelled` | 予約キャンセル | reservation |
| `reservation.completed` | 来園完了 | reservation |
| `rich_menu.tap` | リッチメニュータップ | line |
| `liff.booking.open` | LIFF予約画面表示 | liff |
| `liff.booking.slot_selected` | 予約枠選択 | liff |
| `campaign.click` | キャンペーンリンククリック | campaign |
| `broadcast.sent` | 一斉配信送信 | broadcast |
| `broadcast.click` | 一斉配信クリック | broadcast |

### event_tag_rules 新規

イベント発生時にタグを付与・削除するルール。

```sql
CREATE TABLE IF NOT EXISTS event_tag_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '{}',
  action TEXT NOT NULL CHECK (action IN ('add_tag', 'remove_tag')),
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`conditions` 例:

```json
{
  "source": "line",
  "resourceId": "res_blueberry",
  "amountGte": 5000
}
```

このテーブルは既存 `automations` と役割が近い。MVPでは既存Automationで代替できるが、管理画面をわかりやすくするため、将来的にはタグ付与専用UIとして分ける。

## システムタグ設計

### 予約状態タグ

予約状態タグは「その友だちの予約全体」から再計算する。

単一予約の状態変更だけで直接上書きしない。複数予約がある場合に壊れるため。

| タグ名 | category | 付与条件 |
|---|---|---|
| `sys:予約あり` | reservation | 今後の `pending` / `confirmed` 予約が1件以上 |
| `sys:予約確定` | reservation | 今後の `confirmed` 予約が1件以上 |
| `sys:予約待ち` | reservation | 今後の `pending` 予約があり、confirmed がない |
| `sys:キャンセル経験あり` | reservation | 過去に `cancelled` が1件以上 |
| `sys:来園済み` | visit | `completed` または visit record が1件以上 |
| `sys:無断キャンセルあり` | risk | `no_show` が1件以上 |
| `sys:リピーター` | visit | `completed` が2件以上 |
| `sys:今季予約あり` | reservation | 今シーズン内の有効予約が1件以上 |

再計算関数:

```ts
recomputeReservationSystemTags(friendId)
```

呼び出しタイミング:

- LINE予約作成後
- じゃらん予約取り込み後
- 予約キャンセル後
- 来園完了後
- no_show更新後
- orphaned予約メンテナンス後

### 流入・興味タグ

| タグ名 | 付与条件 |
|---|---|
| `sys:予約導線クリック` | 予約用トラッキングリンクをクリック |
| `sys:リッチメニュー予約タップ` | リッチメニュー予約エリアをタップ |
| `sys:LIFF予約画面閲覧` | LIFF予約画面を開く |
| `sys:予約枠選択済み` | LIFFで予約枠を選択 |
| `sys:予約確認離脱` | 確認画面まで行ったが予約作成なし |

これらは短期のマーケティング分析に使う。必要に応じて `expires_at` を設定する。

## カスタムタグ設計

管理者が自由に作るタグは、次のカテゴリに分ける。

| category | 例 | 用途 |
|---|---|---|
| `source` | Instagram経由、じゃらん経由、紹介 | 流入分析 |
| `interest` | ワンちゃん連れ、家族連れ、カップル | 配信内容の出し分け |
| `campaign` | 6月早割、雨の日キャンペーン | キャンペーン分析 |
| `customer` | VIP、常連、初回来園 | 接客・再訪施策 |
| `risk` | キャンセル多め、電話確認必要 | 運用注意 |
| `manual` | 管理者メモ用 | 自由入力 |

管理画面では、タグ作成時に以下を選ばせる。

```text
タグ名
カテゴリ
色
説明
自動付与ルールを作るか
```

## イベント設計

### 予約系イベント

| event_type | 発火タイミング | subject |
|---|---|---|
| `reservation.created` | 予約作成成功 | reservation |
| `reservation.confirmed` | pending → confirmed | reservation |
| `reservation.cancelled` | キャンセル成功 | reservation |
| `reservation.completed` | 来園完了 | reservation |
| `reservation.no_show` | no_show登録 | reservation |
| `reservation.imported` | じゃらん/Gmail取り込み成功 | reservation |
| `reservation.needs_review` | 外部取り込みが要確認 | external_source |

metadata例:

```json
{
  "source": "line",
  "capacityChannel": "line",
  "resourceId": "res_blueberry",
  "menuId": "menu_blueberry_60",
  "slotId": "slot_...",
  "date": "2026-06-14",
  "startAt": "2026-06-14T12:00:00+09:00",
  "adultCount": 2,
  "childCount": 0,
  "infantCount": 1,
  "underThreeCount": 1,
  "capacityPeople": 3,
  "amount": 5100,
  "customerChargeAmount": 4100,
  "pointAmount": 1000,
  "couponAmount": 0
}
```

### LIFF予約画面イベント

| event_type | 発火タイミング | 目的 |
|---|---|---|
| `liff.booking.open` | `/?page=book` を開いた | 予約導線の入口計測 |
| `liff.booking.resource_selected` | 予約対象選択 | 人気Resource分析 |
| `liff.booking.menu_selected` | メニュー選択 | 人気Menu分析 |
| `liff.booking.date_selected` | 日付選択 | 希望日の傾向 |
| `liff.booking.slot_selected` | 時間枠選択 | 人気時間帯 |
| `liff.booking.confirm_open` | 予約確認画面表示 | 離脱分析 |
| `liff.booking.submit_failed` | 予約作成エラー | UX/在庫エラー分析 |
| `liff.booking.completed` | 予約完了 | CV |
| `liff.mine.open` | 自分の予約一覧表示 | 確認導線分析 |
| `liff.cancel.open` | キャンセル確認表示 | キャンセル兆候 |

### リッチメニューイベント

リッチメニューの `uri` だけではLINE側からpostbackが来ない。そのため、計測したいボタンは次のどちらかにする。

#### 案A: postback → Worker → URL返信

```text
ユーザーがリッチメニューをタップ
↓
postback event
↓
user_events に rich_menu.tap 保存
↓
必要ならタグ付与
↓
予約導線カードを ReplyAPI で返信
```

メリット:

- 誰が押したか確実にわかる。
- ReplyAPIなので課金対象のPushを使わない。
- タグ付与やAutomationに繋げやすい。

デメリット:

- 直接URLを開くより1タップ多い。

#### 案B: uri に tracked link を設定

```text
リッチメニューのuri = /t/:linkId
↓
tracked_links / link_clicks に保存
↓
LIFF経由ならfriendId解決
↓
予約画面へ遷移
```

メリット:

- 直接URLを開ける。
- 既存トラッキングリンクを活用できる。

デメリット:

- LINE外ブラウザや匿名アクセスではfriendIdが取れない場合がある。

MVP推奨:

```text
予約ボタンなど重要導線: postback
キャンペーンLPなど直接遷移したい導線: tracked link uri
```

### キャンペーンイベント

| event_type | 発火元 |
|---|---|
| `campaign.link_click` | tracked link |
| `campaign.liff_open` | LIFFに campaignId がある |
| `campaign.reservation_created` | campaignId付きで予約完了 |
| `campaign.visit_completed` | campaignId由来ユーザーが来園 |

metadata:

```json
{
  "campaignId": "summer_2026",
  "trackedLinkId": "link_...",
  "utmSource": "line",
  "utmCampaign": "summer_early",
  "messageId": "broadcast_..."
}
```

## ブルーベリー農園で計測すべきKPI

### 予約導線KPI

| 指標 | 計算 |
|---|---|
| LIFF予約画面表示数 | `liff.booking.open` |
| 日付選択率 | `date_selected / booking.open` |
| 枠選択率 | `slot_selected / booking.open` |
| 予約完了率 | `reservation.created / booking.open` |
| 確認画面離脱率 | `confirm_open - reservation.created` |
| 満席エラー数 | `submit_failed` where reason=`slot_full` |

### 売上・客単価KPI

| 指標 | 計算 |
|---|---|
| LINE予約売上 | `reservation.created` source=`line` amount合計 |
| じゃらん予約売上 | `reservation.created` source=`jalan` amount合計 |
| 請求額 | `customerChargeAmount` 合計 |
| ポイント利用額 | `pointAmount` 合計 |
| クーポン利用額 | `couponAmount` 合計 |
| 平均組単価 | amount / 予約組数 |
| 平均人数単価 | amount / totalPeople |

### 運用KPI

| 指標 | 目的 |
|---|---|
| キャンセル率 | 枠の戻り・外部在庫調整の精度を見る |
| no_show率 | 電話確認が必要な層を見つける |
| 予約経路別比率 | LINE/じゃらん/電話の依存度を見る |
| 時間帯別予約数 | 枠設計を改善する |
| 曜日別予約数 | 営業日の最適化 |
| 子供/幼児/3歳以下比率 | 価格・説明文・スタッフ配置に使う |

### LINE運用KPI

| 指標 | 目的 |
|---|---|
| リッチメニュー予約タップ数 | メニュー導線の良し悪し |
| 予約導線カードクリック数 | 配信文面の改善 |
| 一斉配信後予約数 | 配信効果 |
| 未読チャット数 | 運用負荷 |
| 自動応答解決率 | Automationの品質 |

## API設計案

### イベント保存

```http
POST /api/events
Authorization: Bearer API_KEY
Content-Type: application/json
```

```json
{
  "friendId": "friend_...",
  "lineUserId": "U...",
  "eventType": "liff.booking.slot_selected",
  "eventName": "予約枠選択",
  "eventSource": "liff",
  "subjectType": "reservation_slot",
  "subjectId": "slot_...",
  "occurredAt": "2026-06-14T12:00:00+09:00",
  "metadata": {
    "resourceId": "res_blueberry",
    "menuId": "menu_blueberry_60"
  }
}
```

公開LIFFから叩く場合は、API_KEYではなく短命セッショントークンを使う。

```http
POST /api/public/events
Authorization: Bearer LIFF_SESSION_TOKEN
```

### イベント一覧

```http
GET /api/events?friendId=...&eventType=...&dateFrom=...&dateTo=...
```

### イベント定義管理

```http
GET /api/event-definitions
POST /api/event-definitions
PUT /api/event-definitions/:id
DELETE /api/event-definitions/:id
```

### イベントタグルール管理

```http
GET /api/event-tag-rules
POST /api/event-tag-rules
PUT /api/event-tag-rules/:id
DELETE /api/event-tag-rules/:id
```

## 管理画面設計

### タグ管理画面

必要機能:

- システムタグ一覧
- カスタムタグ一覧
- カテゴリ別表示
- タグ作成/編集/削除
- タグに紐づく友だち数
- タグの自動付与ルール

システムタグは以下の扱いにする。

```text
名前変更: 不可
削除: 不可
色変更: 可能
表示/非表示: 可能
説明編集: 可能
```

### イベント管理画面

必要機能:

- イベント定義一覧
- イベント発生数グラフ
- イベント別CV率
- イベントからタグ付与ルール作成
- イベントログ検索

### 経営ダッシュボード

ブルーベリー農園向けには次を優先表示する。

```text
今日の予約
今週の予約
LINE予約売上
じゃらん予約売上
予約導線クリック数
予約画面表示 → 予約完了率
キャンセル率
人気時間帯
子供/幼児/3歳以下の人数比率
```

## 実装順序

### Phase 1: 現状タグの安全拡張

1. `tags` に `kind`, `category`, `description`, `is_active`, `is_locked`, `updated_at` を追加。
2. 既存タグは `kind='custom'` で移行。
3. `friend_tags` に `source`, `source_event_id`, `expires_at`, `metadata` を追加。
4. APIレスポンスに追加項目を出す。
5. 既存タグAPIの後方互換を維持する。

### Phase 2: システムタグ追加

1. `sys:予約あり`, `sys:予約確定`, `sys:キャンセル経験あり`, `sys:来園済み`, `sys:リピーター` をseed/ensureで作る。
2. `recomputeReservationSystemTags(friendId)` を作る。
3. 予約作成・キャンセル・来園完了・no_show・じゃらん取り込み後に呼ぶ。
4. 複数予約があるケースのテストを書く。

### Phase 3: user_events追加

1. `user_events` と `event_definitions` を追加。
2. `recordUserEvent()` helperを作る。
3. 予約作成・キャンセル・LIFF画面・tracked link・postbackでイベント保存。
4. イベント保存は本処理を止めないように `waitUntil` または best effort にする。

### Phase 4: イベント→タグ自動付与

1. `event_tag_rules` を追加。
2. イベント保存後にルール評価。
3. 既存Automationの `add_tag` と衝突しないように、MVPではタグ付与専用ルールだけに限定。
4. 管理画面からJSONなしで設定できるようにする。

### Phase 5: ダッシュボード

1. 予約導線ファネル。
2. 流入元別予約数。
3. 売上・請求額・ポイント/クーポン額。
4. 時間帯・曜日別予約。
5. リッチメニュー/一斉配信からの予約CV。

## 壊れないための制約

- 予約状態の正本は `reservations`。タグは正本にしない。
- システムタグは再計算可能にする。手動編集に依存しない。
- イベント保存失敗で予約作成を失敗させない。
- 同じイベントの二重保存に備え、必要なら `request_id` や `idempotency_key` をmetadataに持つ。
- LIFF公開APIでは `lineUserId` 直指定を信用しない。既存の短命セッショントークンを使う。
- リッチメニューの重要導線は `postback` または tracked link を使い、ただの外部URL直リンクにしない。
- カスタムタグ削除時は、配信条件・Automation・event_tag_rules で参照されていないか確認する。

## MVPで最初にやるべきこと

最初に作るべき最小セットはこれ。

```text
1. tags / friend_tags の安全拡張
2. 予約状態システムタグのensure + 再計算
3. user_events の追加
4. 予約作成・キャンセル・LIFF予約画面表示・リッチメニューpostbackのイベント保存
5. reservation-ops に「タグ/イベント」簡易確認カードを追加
```

これで、予約管理・LINE配信・キャンペーン改善に必要な土台ができる。
