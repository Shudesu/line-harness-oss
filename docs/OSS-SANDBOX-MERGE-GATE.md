# OSS Sandbox Merge Gate

OSS PR を merge する前に、利用者の本番環境を壊さないための運用ルールです。

## 目的

`line-harness-oss/main` は利用者の fork に取り込まれ、そのまま Cloudflare に deploy されることがあります。OSS PR の merge は、自分の環境だけではなく、他ユーザーの環境にも影響します。

そのため、merge 判断は次の順に進めます。

```text
OSS PR
  -> OSS CI
  -> sandbox deploy/smoke
  -> merge
  -> private reverse sync
  -> production deploy decision
```

`merge` と `production deploy` は同じ操作にしません。

## 環境の分離

本番と sandbox は必ず分けます。

| 種類 | 本番 | sandbox |
| --- | --- | --- |
| Worker | production Worker | sandbox Worker |
| D1 | production D1 | sandbox D1 |
| R2 | production R2 | sandbox R2 |
| LINE | production LINE channel | test LINE channel |
| Pages | production admin | sandbox/preview admin |
| cron | enabled | disabled or capture-only |

本番 D1 や本番 LINE channel を sandbox 検証に使わないでください。

## リスク分類

### Safe-ish

小さく、局所的で、テストしやすい変更です。

- テスト追加のみ
- 表示文言
- SDK と Worker のフィールド名互換
- webhook の null guard など、既存の正常系を広げる修正

必要な gate:

- OSS CI
- 影響範囲の手動確認

### Needs Sandbox

CI だけでは事故を拾いにくい変更です。

- auth / cookie / CORS
- LIFF redirect / `liff.state`
- webhook side effect
- scenario / automation / broadcast / reminder
- migration
- Cloudflare deploy 設定

必要な gate:

- OSS CI
- sandbox Worker + sandbox D1 で smoke
- rollback 方針の確認

### High Risk

巨大 PR や運用境界を変える変更です。

- 大規模 refactor
- support CRM のような広範囲 UI/API
- 権限・ロール・スタッフ可視性
- message send capability
- migration と配信処理が同時に入る PR

必要な gate:

- PR を分割できないか先に検討
- sandbox deploy
- fixture seed / cleanup
- 本番 deploy を merge とは別日にする

## Local Gate

信頼済み checkout では、deploy なしでローカル検証します。

```bash
pnpm install --frozen-lockfile
pnpm --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-crm/db build
pnpm --filter worker typecheck
pnpm --filter worker test
pnpm --filter worker build
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 pnpm --filter web build
git diff --check
```

外部 PR を自分のローカルマシンに clone してそのまま実行すると、未信頼コード実行になります。外部 PR は GitHub Actions、Cloudflare sandbox、または disposable VM / container で checkout してください。

この段階では Cloudflare への deploy や remote D1 migration は行いません。

## Sandbox Smoke

Needs Sandbox 以上の PR は、sandbox にだけ deploy して確認します。

### 事前に用意するもの

- sandbox D1
- sandbox R2
- sandbox Worker name
- sandbox Pages project
- test LINE Messaging API channel
- test LINE Login / LIFF channel

推奨名:

```text
line-harness-sandbox
line-harness-sandbox-worker
line-harness-sandbox-admin
line-harness-images-sandbox
```

### sandbox で見ること

最低限:

- admin login が通る
- `/api/auth/session` が 200
- `/api/friends/count` が 200
- `/docs` または public route が 200
- webhook の署名検証が落ちない
- LIFF を使う PR なら `liff.state` 経由の ref/form/gate が保持される
- 配信系 PR なら本番 LINE ではなく test LINE だけに送る

配信・シナリオ・cron が関わる PR は、できるだけ `LINE_CAPTURE_ONLY=1` または cron 無効で検証します。

## Merge Decision

merge してよい条件:

- PR が `MERGEABLE`
- OSS CI が成功
- リスク分類に応じた sandbox smoke が成功
- private に取り込む手順が決まっている
- 本番 deploy する/しないが明確

merge しない条件:

- migration の rollback が不明
- auth / CORS の影響範囲が不明
- 本番 LINE に誤送信する可能性が残る
- PR が巨大でレビュー不能
- private 側で conflict するが解消方針がない

## After Merge

OSS PR を merge したら、次の Private -> OSS sync の前に private に取り込みます。

```bash
cd /path/to/line-harness
gh pr diff <PR_NUMBER> --repo Shudesu/line-harness-oss > /tmp/oss-pr-<PR_NUMBER>.patch
git apply /tmp/oss-pr-<PR_NUMBER>.patch --3way
git add -A
git commit -m "sync: apply OSS PR #<PR_NUMBER>"
```

本番 deploy は別判断です。merge 直後に本番へ出す必要はありません。
