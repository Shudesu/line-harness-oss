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
DEFAULT_RESOURCE_ID=
DEFAULT_MENU_ID=
ROUTING_RULES_JSON=[{"name":"blueberry-60","resourceId":"res_blueberry","menuId":"menu_picking_60","keywords":["ブルーベリー","食べ放題60分"]}]
GMAIL_QUERY=from:(jalan_active_support@r.recruit.co.jp) newer_than:30d
PROCESSED_LABEL=line-harness/jalan-imported
REVIEW_LABEL=line-harness/jalan-needs-review
MAX_THREADS=20
DRY_RUN=true
```

旧設定の `RESOURCE_ID` / `MENU_ID` も後方互換としてfallbackに使われます。ただし、複数Resource/Menu運用では `ROUTING_RULES_JSON` を使います。

Resource/Menuルーティング:

GASはDBを直接見ません。メール本文に含まれるプラン名・文言を `ROUTING_RULES_JSON` の `keywords` と照合し、対応する `resourceId` / `menuId` をWorkerへ送ります。

```json
[
  {
    "name": "blueberry-60",
    "resourceId": "res_blueberry",
    "menuId": "menu_picking_60",
    "keywords": ["ブルーベリー", "食べ放題60分"]
  },
  {
    "name": "bbq-table",
    "resourceId": "res_bbq",
    "menuId": "menu_bbq_table",
    "keywords": ["BBQ", "テーブル"]
  }
]
```

一致するルールがない場合は `DEFAULT_RESOURCE_ID` / `DEFAULT_MENU_ID` を送ります。どちらも空ならWorker側で `needs_review` になります。

有効なResource/Menu一覧は、APIキー付きで次を確認できます。

```bash
curl -H "Authorization: Bearer $KEY" "$API/api/integrations/jalan/catalog"
```

運用手順:

1. Apps Scriptに `jalan-gmail-import.gs` を貼り付ける。
2. `setupJalanImporterProperties()` を1回実行する。
3. Script Propertiesの `WORKER_URL`, `WORKER_API_KEY`, `ROUTING_RULES_JSON` を実値に変える。
4. 最初は `DRY_RUN=true` のまま `importJalanReservationMails()` を実行し、ログでpayloadを確認する。
5. 問題なければ `DRY_RUN=false` に変更する。
6. Apps Scriptのトリガーで `importJalanReservationMails()` を5分または10分間隔で実行する。

安全ルール:

- GASはDBを直接更新しない。必ずWorker APIへ送る。
- Gmail messageIdをdedupe keyとして送るため、同じメールの再送は冪等に扱える。
- `updated` メールは自動反映せず `needs_review` になる。
- `cancelled` メールは既存予約と一致した場合だけ、Worker側の状態遷移表を通してキャンセルする。
- `created` メールは `resourceId`, `menuId`, slot解決が揃った場合だけ予約作成する。
- Slotが満席・非公開・削除済みの場合、GAS経由では `needs_review` として扱い、同じメールを無限に再処理しない。
- Resource/Menuを管理画面で削除した場合も、GAS側のルーティングが古ければ `needs_review` になる。
