# 110 - Customer Encrypted Settings

## 目的

運用中のSecrets Store運用を壊さずに、顧客ごとに変更される秘密情報を管理画面から設定できるようにする。

この方式では、WorkerのSecrets Storeは最低限の共通秘密に寄せ、顧客別のWebhook URLやメール送信設定はD1の `account_settings` に保存する。秘密値は `APP_ENCRYPTION_KEY` が設定されている場合に `enc:v1:` 形式で暗号化保存する。

## 残すSecrets Store

以下はWorker全体の実行に必要なため、Secrets Storeに残す。

```text
API_KEY
APP_ENCRYPTION_KEY
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
LINE_LOGIN_CHANNEL_ID
LINE_LOGIN_CHANNEL_SECRET
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
WORKER_URL
WEB_URL
LIFF_URL
```

`APP_ENCRYPTION_KEY` はD1に保存された顧客別秘密設定を復号するための鍵である。顧客ごとにWorkerを分ける場合は、顧客ごとに別の値を使う。

## D1暗号化設定に移せるキー

### Discord

```text
discord.webhook_url
discord.reservation_webhook_url
discord.daily_webhook_url
discord.review_webhook_url
discord.reservation_thread_id
discord.daily_thread_id
discord.review_thread_id
```

Webhook URLは秘密値として暗号化保存する。Thread IDは秘密ではないが、顧客別設定として保存する。

### Email / Resend

```text
email.resend_api_key
email.from_email
email.from_name
email.reply_to
```

`email.resend_api_key` は秘密値として暗号化保存する。`from_email` / `from_name` / `reply_to` は顧客ごとのメール運用設定として保存する。

## 読み込み優先順位

Discord通知とWeb予約メールでは、以下の順で設定を読む。

```text
1. D1 account_settings の顧客別設定
2. 既存Secrets Store / Worker env
3. 既定値
```

このため、既存のSecrets Store設定だけで動いている本番環境は壊れない。

## 管理画面

現在のUIは以下。

```text
/webhooks
  Discord通知タブ

/email-settings
  Resend / メール配信設定
```

秘密値は保存後にマスク表示される。空欄で保存した場合は削除、秘密値の入力欄を空欄のまま保存した場合は既存値を維持する。

## 注意点

`APP_ENCRYPTION_KEY` を変更すると、既存の暗号化済み設定を復号できなくなる。変更が必要な場合は、旧キーで復号して新キーで再保存する移行処理が必要になる。
