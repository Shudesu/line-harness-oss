# 106. Discord現場通知設計

## 目的

Discordは予約操作の正本ではなく、現場スタッフが予約変化に気づくための通知ハブとして使う。

```text
Web管理画面 = 予約操作の正本
Discord = 通知とWeb管理画面への入口
```

## 実装済み

- 新規予約、予約キャンセル、来園済みをDiscordへ通知する。
- じゃらん/Gmail取り込みで `needs_review` または失敗が出た場合、要確認通知を送る。
- Worker Cronで毎朝8:00 JSTから10分以内に、その日の有効予約がある場合だけ当日予約サマリーを送る。
- 朝サマリーは `discord_notification_runs` で日付単位に冪等化し、同じ日に二重送信しない。
- Discord通知には `reservation-ops` へのURLボタンを付ける。Discord内でDB更新はしない。

## スレッド分け

通知は3種類に分ける。

| 種類 | 用途 | 優先Webhook |
|---|---|---|
| `reservation` | 新規予約、キャンセル、来園済み | `DISCORD_RESERVATION_WEBHOOK_URL` |
| `daily` | 朝8時の当日予約サマリー | `DISCORD_DAILY_WEBHOOK_URL` |
| `review` | じゃらん/Gmail要確認、失敗 | `DISCORD_REVIEW_WEBHOOK_URL` |

個別Webhookが未設定の場合は `DISCORD_WEBHOOK_URL` を使う。

既存スレッドに投稿したい場合は、以下のThread IDを設定する。

```text
DISCORD_RESERVATION_THREAD_ID
DISCORD_DAILY_THREAD_ID
DISCORD_REVIEW_THREAD_ID
```

## 必要な環境変数

GitHub Actions経由でデプロイする場合、以下はCloudflare Secrets Storeに保存し、`deploy-worker.yml` がWorkerへ `secrets_store_secrets` としてbindingする。

```text
WEB_URL=https://line-harness-reservation-web.pages.dev
DISCORD_RESERVATION_WEBHOOK_URL=
DISCORD_DAILY_WEBHOOK_URL=
DISCORD_REVIEW_WEBHOOK_URL=
```

Secrets Storeに保存しただけではWorkerから読めない。Worker deploy時のbinding対象に含める必要がある。標準workflowでは上記のDiscord系secretをデフォルトbindingに含める。

Thread IDは任意設定である。Secrets Storeに存在しないThread IDをbindingするとdeployが失敗するため、標準workflowのデフォルトbindingには含めない。1チャンネル内の複数スレッド運用をする場合だけ、GitHub Variablesの `CLOUDFLARE_SECRETS_STORE_BINDINGS` に明示追加する。

```text
CLOUDFLARE_SECRETS_STORE_BINDINGS=DISCORD_WEBHOOK_URL,DISCORD_RESERVATION_THREAD_ID,DISCORD_DAILY_THREAD_ID,DISCORD_REVIEW_THREAD_ID
```

`DISCORD_WEBHOOK_URL` は共通Webhook用の任意設定である。チャンネル分割で `DISCORD_RESERVATION_WEBHOOK_URL`, `DISCORD_DAILY_WEBHOOK_URL`, `DISCORD_REVIEW_WEBHOOK_URL` を使う場合は不要。

運用は以下のどちらかにする。

```text
簡単: 種類ごとにDiscordチャンネルWebhookを3つ作る
柔軟: 1つのWebhook + 種類ごとのThread IDを設定する
```

## 通知対象

### 予約通知

```text
新規予約
予約キャンセル
来園済み
```

通知内容:

```text
日時
名前
人数
料金
電話
メール
source/status
reservation-ops URL
```

### 朝8時サマリー

Worker Cronは5分ごとに起動している。JST 08:00-08:09の間だけ、当日予約サマリーを送る。

予約が0件なら送信しない。

通知内容:

```text
予約件数
総人数
枠消費人数
LINE件数
じゃらん/Gmail件数
時間別予約
要確認件数
```

### 要確認通知

```text
じゃらんupdated
じゃらんcancelledで既存予約が見つからない
ルート未設定
枠不足
Gmail取り込み失敗
```

## 今はやらないこと

Discordのボタンから直接 `completed` にする処理はMVPでは実装しない。

理由:

- Discord Interaction Endpointと署名検証が必要。
- スタッフ権限とDiscordユーザーの紐づけが必要。
- 誤タップ時の取り消し導線が必要。

まずはWebの `reservation-ops` に操作を寄せ、Discordは通知と入口に限定する。
