# 104. Gmail API + Worker Cron じゃらん予約取り込み設計

## 目的

じゃらん予約通知メールを、GASではなく Cloudflare Worker Cron から Gmail API で直接読み取り、既存の予約取り込みAPIと同じ不変条件で予約DBへ反映する。

この設計では、Gmailは「メール仕分け」、Workerは「取り込み・解析・冪等処理・予約DB反映」を担当する。

```text
じゃらん予約通知メール
↓
Gmailフィルターで未処理ラベル付与
↓
Worker Cron が Gmail API で未処理ラベルだけ読む
↓
本文取得
↓
じゃらんparser
↓
既存の外部取り込みロジック
↓
LINE Harness予約DB
↓
Gmailラベルを処理済み / 要確認 / 失敗へ変更
```

## 既存設計との関係

- 予約DBの正は `reservation_slots`, `reservations`, `external_reservation_sources` とする。
- 在庫確保、キャンセル時の在庫戻し、冪等処理は [101A](101A-Reservations-Data-Model.md) と [101B](101B-Reservations-API.md) のルールに従う。
- じゃらん `created` / `cancelled` / `updated` の扱いは既存の `POST /api/integrations/jalan/gmail/import` と同じにする。
- `updated` 系メールは自動反映しない。既存予約に紐づけられる場合でも `needs_review` とする。
- `externalId`, `gmailMessageId`, `dedupeKey` のいずれかで必ず冪等にする。
- Google Calendar同期と同じく、外部連携失敗で予約DB本体を壊さない。

## Gmail側の運用

Gmailでフィルターを作り、じゃらん予約通知メールに未処理ラベルを付ける。

条件例:

```text
From: じゃらん予約通知の送信元
Subject: 予約 OR キャンセル OR 変更
```

推奨ラベル:

```text
じゃらん予約/未処理
じゃらん予約/処理済み
じゃらん予約/要確認
じゃらん予約/失敗
```

Gmail APIではラベル名ではなく `Label_123...` のような `labelId` を使う。初期設定時に `users.labels.list` でラベル名からIDを解決し、DBへ保存する。

## Google OAuth scope

ラベル付け替えで二重処理を防ぐため、`gmail.readonly` では足りない。

```text
https://www.googleapis.com/auth/gmail.modify
```

読み取りだけなら `gmail.readonly` でも動くが、処理済みラベルへ移動できず、同じメールを再処理しやすい。MVPでも `gmail.modify` を標準にする。

## DB追加設計

### gmail_import_rules

Gmail取り込みの設定。1つのGmail接続に対して、じゃらん取り込みルールを複数持てるようにする。

```sql
CREATE TABLE IF NOT EXISTS gmail_import_rules (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES google_calendar_connections (id) ON DELETE CASCADE,
  source_name TEXT NOT NULL DEFAULT 'jalan'
    CHECK (source_name IN ('jalan')),
  name TEXT NOT NULL,
  from_email TEXT,
  query TEXT,
  unprocessed_label_id TEXT NOT NULL,
  processed_label_id TEXT NOT NULL,
  review_label_id TEXT NOT NULL,
  failed_label_id TEXT NOT NULL,
  resource_id TEXT REFERENCES reservation_resources (id) ON DELETE SET NULL,
  menu_id TEXT REFERENCES reservation_menus (id) ON DELETE SET NULL,
  max_results INTEGER NOT NULL DEFAULT 10 CHECK (max_results BETWEEN 1 AND 50),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_gmail_import_rules_active
  ON gmail_import_rules (is_active, source_name);
```

`connection_id` は既存の `google_calendar_connections` を再利用する。名前はCalendar寄りだが、実体はGoogle OAuth接続であり、`access_token`, `refresh_token`, `access_token_expires_at` をすでに持つため、Gmailにも使える。

将来Google連携が増える場合は、`google_connections` へ改名または別テーブル化を検討する。MVPでは既存テーブル再利用でよい。

### gmail_import_runs

Cron実行単位の監査ログ。失敗時にどのルールで何が起きたかを追えるようにする。

```sql
CREATE TABLE IF NOT EXISTS gmail_import_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES gmail_import_rules (id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial_failed', 'failed')),
  fetched_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_gmail_import_runs_rule
  ON gmail_import_runs (rule_id, started_at);
```

### external_reservation_sources への保存

メール単位の元データは既存 `external_reservation_sources` に保存する。

保存方針:

- `source = 'gmail'` または `source = 'jalan'` は実装時に統一する。
- 予約発生元としては `reservations.source = 'jalan'`、`capacity_channel = 'external'` とする。
- `gmailMessageId` は `dedupe_key` の優先候補にする。
- `raw_text` にメール本文を保存する。
- `parsed_payload` に parser結果と Gmail metadata を保存する。

推奨 `parsed_payload`:

```json
{
  "gmail": {
    "messageId": "...",
    "threadId": "...",
    "labelIds": ["Label_123"],
    "internalDate": "..."
  },
  "jalan": {
    "eventType": "created",
    "externalId": "31GX8N5SG",
    "planName": "...",
    "totalAmount": 4000
  }
}
```

## Worker Cronの処理フロー

```text
1. Cron起動
2. activeな gmail_import_rules を取得
3. connection_id からGoogle refresh_tokenを取得
4. access_token期限切れなら更新
5. Gmail API users.messages.list を呼ぶ
   - labelIds: [unprocessed_label_id]
   - q: query + from_email + newer_than
6. messageIdごとに users.messages.get を呼ぶ
7. raw本文を抽出
8. じゃらんparserに通す
9. 既存の Gmail/じゃらん取り込み関数へ渡す
10. 結果に応じてGmailラベルを変更
11. gmail_import_runs を更新
```

## Gmail検索条件

安定運用では `labelIds` を主に使う。

```ts
const listParams = {
  userId: 'me',
  labelIds: [rule.unprocessedLabelId],
  q: 'from:jalan@example.com newer_than:30d',
  maxResults: rule.maxResults
};
```

日本語ラベル名を `q` に直接入れる運用は避ける。ラベル名変更・日本語・スラッシュ階層で壊れやすいため。

## ラベル変更ルール

取り込み結果に応じて `users.messages.modify` を呼ぶ。

| 取り込み結果 | Gmailラベル |
|---|---|
| `imported` | 未処理を外し、処理済みを付ける |
| `duplicate` / idempotent success | 未処理を外し、処理済みを付ける |
| `needs_review` | 未処理を外し、要確認を付ける |
| parser失敗 / API失敗 | 未処理を外し、失敗を付ける |

ラベル変更に失敗した場合:

- 予約DB反映済みなら取り消さない。
- `gmail_import_runs.failed_count` を増やす。
- `external_reservation_sources.last_error` にラベル変更失敗を記録する。
- 次回Cronで同じメールが残っても、`gmailMessageId` により冪等成功にする。

## じゃらんparser方針

メール本文から最低限以下を抽出する。

```text
eventType: created / updated / cancelled / unknown
externalId: 予約番号
reservationDate
startTime
endTime
planName
adultCount
childCount
infantCount
customerName
customerPhone
customerEmail
totalAmount
```

予約確定メールは以下の形式を主対象にする。

```text
差出人: reservation@activityboard.jp
件名: 【予約確定】じゃらんnet遊び・体験予約_予約確定通知

予約番号：3009LQBDA
利用日時：2026/06/14(日) 12:00〜13:00
プラン名：...
人数：4名  (大人(中学生〜):2名、小学生:0名、幼児(4歳〜):1名、3歳以下:1名)
合計料金(税込)：5,100円
体験者氏名：澤幡  諭志(サワハタ　サトシ)様
メールアドレス：...
電話番号：...
```

parserの期待結果:

```json
{
  "eventType": "created",
  "externalId": "3009LQBDA",
  "reservationDate": "2026-06-14",
  "startTime": "12:00",
  "endTime": "13:00",
  "adultCount": 2,
  "childCount": 0,
  "infantCount": 2,
  "totalPeople": 4,
  "totalAmount": 5100
}
```

人数表記は `〜`, `～`, `~` が混ざるため、正規化後も全パターンを許容する。`幼児(4歳〜)` と `3歳以下` はどちらも `infantCount` に合算する。

プラン名は揺れるため、`resource_id` と `menu_id` の自動判定に使いすぎない。MVPでは `gmail_import_rules.resource_id` と `menu_id` を優先し、parserの `planName` は監査情報として保存する。

`updated` は自動反映しない。

```text
updated mail
↓
externalId / dedupeKey で既存予約検索
↓
見つかれば reservation_id を紐づけ
↓
parse_status = needs_review
↓
管理画面で確認
```

`cancelled` は既存予約にだけ作用する。

```text
cancelled mail
↓
externalId / dedupeKey で既存予約検索
↓
pending / confirmed のみ cancelled
↓
capacity_channel=external の在庫を1回だけ戻す
↓
同じキャンセルメール再処理は idempotent success
```

## 安全制約

### 1. CronはDBを直接変更しすぎない

Cron handlerはGmail取得とジョブ制御だけを担当する。予約作成・キャンセル・needs_review保存は既存の外部取り込みserviceへ寄せる。

### 2. 予約作成は必ず既存不変条件を通す

外部取り込みであっても、以下を守る。

- slotの条件付きUPDATEで先に在庫確保
- `capacity_channel = 'external'`
- `external_remaining >= requested_capacity_people`
- 同じ `externalId` / `gmailMessageId` は冪等成功
- 枠超過は自動作成せず `needs_review`

### 3. Gmail処理はメール単位で独立させる

1通失敗しても、そのCron全体を止めない。失敗メールだけ `failed` ラベルへ移動する。

### 4. Cronの最大処理数を制限する

`max_results` は初期値10、最大50にする。Gmail API、D1、Worker CPU時間を守るため。

### 5. DRY RUNを用意する

初回運用では `dryRun=true` の管理APIまたはルール設定を用意し、Gmailラベル変更と予約DB作成を行わず、parser結果だけ確認できるようにする。

MVPでDBカラムを増やしたくない場合は、管理APIの手動実行時だけ `dryRun` queryを受け取る。

## API設計

管理画面とSDKから扱うため、APIは `apps/worker/src/routes/integrations/gmail.ts` または `routes/reservations/integrations.ts` に寄せる。

### Gmailラベル一覧

```http
GET /api/integrations/gmail/labels?connectionId=...
```

用途:

- Gmailのラベル名と `labelId` を管理画面で選べるようにする。

### 取り込みルール一覧

```http
GET /api/integrations/gmail/import-rules
POST /api/integrations/gmail/import-rules
PUT /api/integrations/gmail/import-rules/:id
DELETE /api/integrations/gmail/import-rules/:id
```

削除は物理削除ではなく `is_active=false` にする。

### 手動実行

```http
POST /api/integrations/gmail/import-rules/:id/run
```

リクエスト:

```json
{
  "dryRun": true,
  "maxResults": 5
}
```

レスポンス:

```json
{
  "success": true,
  "data": {
    "runId": "...",
    "fetchedCount": 3,
    "importedCount": 1,
    "reviewCount": 1,
    "failedCount": 1,
    "items": [
      {
        "gmailMessageId": "...",
        "eventType": "created",
        "parseStatus": "imported",
        "reservationId": "..."
      }
    ]
  }
}
```

## SDK設計

`packages/sdk/src/resources/reservations.ts` へ直接詰め込みすぎると肥大化するため、将来は `integrations` resourceへ分ける。

MVPでは以下のどちらかにする。

### 案A: reservations resourceに追加

既存のじゃらん取り込みが `client.reservations.importJalanGmail()` にあるため、最短で実装しやすい。

```ts
client.reservations.listGmailImportRules()
client.reservations.createGmailImportRule(input)
client.reservations.updateGmailImportRule(id, input)
client.reservations.deleteGmailImportRule(id)
client.reservations.runGmailImportRule(id, { dryRun: true })
```

### 案B: integrations resourceを新設

長期保守性はこちらがよい。

```ts
client.integrations.gmail.listLabels(connectionId)
client.integrations.gmail.listImportRules()
client.integrations.gmail.runImportRule(id, options)
```

推奨は案B。ただし既存SDK整理コストが高い場合は案Aで始め、後で移す。

## Cron設計

`wrangler.toml` のcronに乗せる。

```toml
[triggers]
crons = ["*/5 * * * *"]
```

既存Cronが配信処理を持っている場合、同じ `scheduled()` 内で呼ぶ。

```ts
await Promise.allSettled([
  processScheduledBroadcasts(...),
  processQueuedBroadcasts(...),
  processGmailImportRules(env),
]);
```

Gmail取り込みは時間がかかる可能性があるため、以下を守る。

- 1回のCronでactive ruleを全件無制限に回さない。
- ルールごとに `max_results` を守る。
- 例外はrule単位で握り、他のCron処理を止めない。
- 実行ログを `gmail_import_runs` に残す。

## 管理画面UX

`/reservation-ops` または `/reservations` に「じゃらんメール連携」設定を追加する。

必要な画面:

1. Google接続選択
2. Gmailラベル一覧取得
3. 未処理 / 処理済み / 要確認 / 失敗 ラベル選択
4. fromメール、追加query、resource、menu、maxResults設定
5. DRY RUN実行
6. 本実行
7. 最近の実行ログ表示

運用者向けには、JSONを直接触らせない。ラベルやresource/menuはselectで選ばせる。

## 実装順序

### Phase 1: 設計とDB

1. `docs/wiki/104-Gmail-Jalan-Cron-Import.md` を追加する。
2. migrationで `gmail_import_rules`, `gmail_import_runs` を追加する。
3. D1再実行時に壊れないよう、CI/CDの互換パッチは `CREATE TABLE IF NOT EXISTS` と `CREATE INDEX IF NOT EXISTS` にする。

### Phase 2: Gmail service

1. `apps/worker/src/services/google-gmail.ts` を作る。
2. `listLabels`, `listMessages`, `getMessageText`, `modifyLabels` を実装する。
3. 既存Google OAuth refresh処理を再利用する。
4. scopeは `gmail.modify` を使う。

### Phase 3: 取り込みservice

1. `apps/worker/src/services/gmail-jalan-import.ts` を作る。
2. rule単位でGmail未処理メールを取得する。
3. `jalan-mail-parser` へ通す。
4. 既存 `importJalanGmail` 相当の処理へ渡す。
5. 結果に応じてGmailラベルを移動する。
6. run logを保存する。

### Phase 4: API/SDK

1. Gmail labels APIを追加する。
2. import rules CRUD APIを追加する。
3. 手動実行APIを追加する。
4. SDKに型付きメソッドを追加する。

### Phase 5: Cron

1. `scheduled()` から `processGmailImportRules()` を呼ぶ。
2. ルール数・maxResults・エラーを制御する。
3. Cron結果はログとDBに残す。

### Phase 6: 管理画面

1. `/reservation-ops` にじゃらんメール連携カードを追加する。
2. Google接続、Gmailラベル、resource/menuをselectで選ぶ。
3. DRY RUNボタンと本実行ボタンを分ける。
4. 実行ログ、要確認件数、失敗件数を表示する。

## テスト方針

### Unit

- Gmail label nameからlabelId解決。
- Gmail message payloadから本文抽出。
- じゃらん新規/変更/キャンセルのparser。
- parser失敗時に `failed` 扱いになる。

### D1 integration

- `gmail_import_rules` CRUD。
- `gmail_import_runs` 作成・更新。
- 同じ `gmailMessageId` の再処理は冪等成功。
- `updated` は予約を直接変更せず `needs_review`。
- `cancelled` 再処理は在庫を二重に戻さない。
- 外部枠超過は予約を作らず `needs_review`。

### Worker API

- Gmail labels APIは管理者認証必須。
- 手動DRY RUNは予約DBとGmailラベルを変更しない。
- 本実行は結果に応じてGmailラベル変更を呼ぶ。

### Cron

- 1通失敗しても他のメールを処理する。
- rule単位の失敗が他ruleに波及しない。
- `max_results` を超えて処理しない。

## 必要な設定

Google Cloud Console:

- Gmail APIを有効化する。
- OAuth consent screenを設定する。
- OAuth redirect URIに既存Worker callbackを登録する。
- scopeに `https://www.googleapis.com/auth/gmail.modify` を追加する。

Worker / Secrets Store:

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
API_KEY
WORKER_URL
```

Gmail:

- じゃらん予約通知メール用のフィルター。
- 未処理 / 処理済み / 要確認 / 失敗 ラベル。

予約管理:

- 対象resource。
- 対象menu。
- 外部枠 `external_capacity`。

## 運用手順

1. Gmailで4つのラベルを作る。
2. Gmailフィルターで未処理ラベルを自動付与する。
3. 管理画面でGoogle OAuth接続を作る。
4. Gmail import ruleを作る。
5. DRY RUNでparser結果を確認する。
6. 問題なければ本実行する。
7. Cronを有効化する。
8. `/reservation-ops` で要確認と失敗を確認する。

## 重要な注意点

- Gmail APIでメールを読めても、予約DBへ直接INSERTしない。
- `updated` メールは自動反映しない。
- `cancelled` メールは状態遷移表を通す。
- ラベル変更に失敗しても、DB反映済み処理を巻き戻さない。
- 再実行されても `gmailMessageId` と `externalId` で必ず冪等にする。
- `resource_id` / `menu_id` をparserのプラン名だけで自動決定しない。
