# LINE先行 Xキャンペーン（MVP）

対応するX Harness v0.7.0と両側を更新します。参加者のX ID入力はなく、LINE ID/access tokenのchannel・subject・friendshipをサーバーで確認します。Xの投稿者は個人用合言葉から紐付けます。既存友だちにはLIFFで合言葉を表示し、初期案内のpushを省きます。

## 導入

1. DBのバックアップ、実スキーマとmigration履歴を確認し、`*_x_line_first_gates.sql`を適用します。PR内は規約に従い`NNN`で、マージ時に採番します。bootstrapも再生成が必要です。
2. キャンペーンのMessaging APIアカウントに対応するLogin channel・LIFFを設定します。
3. X側共有LINE接続と同じ32文字以上のランダムキーを`X_HARNESS_GATE_SECRET`へ設定します。`X_HARNESS_CONNECTION_ID`、信頼するpeerのHTTPS origin `X_HARNESS_URL`も指定します。ブラウザから接続先・friend IDを指定させません。
4. 厳格ティアは`X_GATE_TURNSTILE_SITE_KEY`、`X_GATE_TURNSTILE_SECRET_KEY`が必須です。別のLIFF hostnameを使う場合は`X_GATE_TURNSTILE_HOSTNAMES`へカンマ区切りで許可します。action・campaign・hostnameをサーバーで検証します。
5. X管理画面で作成したリンクを公開入口にします。旧X ID自己申告フォームは登録済みの新参加画面へ誘導し、未移行なら案内を表示します。旧回答履歴は残ります。

キー未設定では連携を有効化しません。Worker・LIFF・対応migrationを一組として更新します。公開OSSは本番配信の制御面ではありません。

## 認証・送信・再送

`/api/integrations/x-harness/campaigns`とcancelは管理者認証＋HMAC、eventsとengagementはHMACが必要です。署名はmethod・path/query・connection・event・Delivery ID・millisecond timestamp・raw body digestを結び付け、5分以上のずれを拒否します。LIFF join/checkはキャンペーンのLogin channelに対応するID/access tokenを両方必須とします。

送信は既存Harness proxy handlerを使い、当該アカウントのトークン、ログ、provider retry keyを維持します。OSSに特定運営者の外部プロキシを固定しません。replyは`auto_reply`として記録し、手動担当者返信として集計しません。

`x_gate_inbox`は署名イベント、`x_gate_outbox`はLINE反応の再送、`x_gate_reply_receipts`はreplyの重複防止、`x_gate_notifications`は結果のreply/push競合防止に使います。pushが先行した場合はcheck返信に特典を再添付せず案内します。replyが成功済みならpushを省き、結果不明なら自動pushへ切り替えず要確認にします。参加画面は確定済みの同じ特典を再表示できます。

1分・5分・30分・2時間・12時間の再送後はdead状態です。復旧時は元のDelivery IDとproviderの重複排除期間を保持します。結果の在庫・特典を割り当て直しません。返信結果が不明な記録を確認せず削除しないでください。

## 検証範囲

署名、別channel拒否、友だちのサーバー判定、アカウント固定、再送、シナリオ重複防止、Turnstile、reply/push競合を合成データで検証します。X側に両repoのHTTP契約テストがあります。顧客データや実メッセージ送信は使いません。

実機のX起動、実LINE OAuth/Turnstile、実配信、本番DB移行は別途確認が必要です。LINE既読を計測できたことにはしません。engagementは参加から7日以内の受信メッセージ等2回以上です。未実装の当選者X OAuth・紹介・ストリーク・企画生成を案内しません。
