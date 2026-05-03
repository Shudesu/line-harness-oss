# GAS integrations

## じゃらん Gmail 取り込み

`jalan-gmail-import.gs` は、じゃらん予約メールをGmailから取得し、Workerの予約取り込みAPIへ送るGoogle Apps Scriptです。

送信先:

```text
POST /api/integrations/jalan/gmail/import
Authorization: Bearer <WORKER_API_KEY>
```

Script Properties:

```text
WORKER_URL=https://your-worker.example.workers.dev
WORKER_API_KEY=...
RESOURCE_ID=res_blueberry
MENU_ID=menu_picking_60
GMAIL_QUERY=from:(jalan_active_support@r.recruit.co.jp) newer_than:30d
PROCESSED_LABEL=line-harness/jalan-imported
REVIEW_LABEL=line-harness/jalan-needs-review
MAX_THREADS=20
DRY_RUN=true
```

運用手順:

1. Apps Scriptに `jalan-gmail-import.gs` を貼り付ける。
2. `setupJalanImporterProperties()` を1回実行する。
3. Script Propertiesの `WORKER_URL`, `WORKER_API_KEY`, `RESOURCE_ID`, `MENU_ID` を実値に変える。
4. 最初は `DRY_RUN=true` のまま `importJalanReservationMails()` を実行し、ログでpayloadを確認する。
5. 問題なければ `DRY_RUN=false` に変更する。
6. Apps Scriptのトリガーで `importJalanReservationMails()` を5分または10分間隔で実行する。

安全ルール:

- GASはDBを直接更新しない。必ずWorker APIへ送る。
- Gmail messageIdをdedupe keyとして送るため、同じメールの再送は冪等に扱える。
- `updated` メールは自動反映せず `needs_review` になる。
- `cancelled` メールは既存予約と一致した場合だけ、Worker側の状態遷移表を通してキャンセルする。
- `created` メールは `resourceId`, `menuId`, slot解決が揃った場合だけ予約作成する。
