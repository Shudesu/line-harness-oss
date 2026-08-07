# LINE API 互換プロキシ (`/line-api`)

外部エージェント (Codex / Claude Code / 各種スクリプト) が LINE Messaging API を直接叩くと、送信メッセージが `messages_log` に残らず admin UI のチャット履歴から欠落する。このプロキシは **ベースURLを差し替えるだけ** で送信を `messages_log` に記録する drop-in 経路を提供する。通常の自動送信は `source='external'`、人間が個別に返信する場合は下記ヘッダーを付けて `source='manual'` として記録する。

## 使い方

呼び出し側の変更はベースURLのみ。ペイロードはそのまま。

| 変更前 | 変更後 |
|--------|--------|
| `https://api.line.me/v2/bot/...` | `https://<WORKER_URL>/line-api/v2/bot/...` |
| `https://api-data.line.me/v2/bot/...` | `https://<WORKER_URL>/line-api-data/v2/bot/...` |

### 認証は2系統

**1. harness API キー(推奨・最終形)** — エージェントにチャネルアクセストークンを配らない。worker が D1 の `line_accounts` からトークンを解決して上流を呼ぶ。

```bash
curl -X POST "https://<WORKER_URL>/line-api/v2/bot/message/push" \
  -H "Authorization: Bearer $LINE_HARNESS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"U...","messages":[{"type":"text","text":"hello"}]}'
```

### 人間が個別返信するとき（未対応インボックス連動）

担当者・エージェントが会話への返信として1対1 pushを送る場合は、必ず次のヘッダーを追加する。

```bash
-H "X-Line-Harness-Source: manual"
```

これにより `messages_log.source='manual'` で記録され、その返信より前の受信メッセージは `/notifications` の未対応一覧から消える。ヘッダーなしは `external` のままなので、予約通知などの自動送信を人間の返信と誤判定しない。`manual` は `POST /v2/bot/message/push` のみ使用可能で、multicast / broadcast への指定や別の値は 400 になる。

- アカウントが1つなら自動でそのアカウントから送信
- 複数アカウント構成では `X-Line-Account-Id: <line_accounts.id または channel_id>` ヘッダーで送信元を指定(未指定は 400)

**2. チャネルアクセストークン(drop-in 移行用)** — 既存スクリプトの Authorization をそのままに、ベースURLだけ差し替えれば動く。`line_accounts.channel_access_token`(is_active のみ)と `env.LINE_CHANNEL_ACCESS_TOKEN` に照合し、未登録トークンは 401(オープンリレー防止)。

## 動作仕様

- **転送**: `/v2/bot/` 配下のみ api.line.me / api-data.line.me へ透過転送(メッセージ以外のエンドポイントも可)。ステータス・レスポンスボディ・`x-line-request-id` / `x-line-accepted-request-id` / `retry-after` はそのまま返す。`X-Line-Retry-Key` も転送。バイナリ(リッチメニュー画像アップロード、コンテンツダウンロード)も透過。
- **ログ記録**(転送が 2xx のときのみ、レスポンス返却後にバックグラウンドで実行):

| エンドポイント | 記録 |
|---------------|------|
| `POST /v2/bot/message/push` | 宛先 friend に1メッセージ1行。チャットも `in_progress` + last_message_at 更新(オペレーター手動送信と同扱い)。グループ/ルーム宛(`C…`/`R…`)は friend を捏造しないため記録なし |
| `POST /v2/bot/message/multicast` | 宛先 friend × メッセージ数の行 |
| `POST /v2/bot/message/broadcast` | 送信アカウントのフォロー中 friend 全員に1行ずつ。単一アカウント構成では全 friend、複数構成では該当アカウントに絞る。複数構成で未登録 env トークンから送った場合は宛先を特定できないため記録なし(warn ログ) |
| `POST /v2/bot/message/reply` | **記録なし**(replyToken から友だちを特定できない。reply token は webhook を受ける worker しか持たないため実運用では通らない経路) |
| `POST /v2/bot/message/narrowcast` | **記録なし**(オーディエンス配信は宛先が確定しない) |

- **未知の宛先**: DB に friend が居ない userId への push/multicast は、プロフィール取得の上で friend 行を自動作成する(webhook の自動登録と同じ挙動)。1リクエストあたりの自動作成は 20 件まで(subrequest 予算保護)。超過分は記録スキップ + warn ログ。
- **ログ失敗は送信を壊さない**: 記録に失敗しても LINE 側の送信は成功済みなので、レスポンスは 200 のまま返す(クライアント再送 = 二重送信を防ぐ)。

## 運用ルール(これをやらないと根本解決にならない)

チャネルトークン認証(系統2)は移行用の互換モード。**トークンを持っているエージェントは api.line.me を直接叩けてしまう**ので、プロキシの存在だけでは強制力がない。以下の手順で直接送信の経路を潰す:

1. 全エージェント・スクリプトをプロキシ経由に切り替える(まずはベースURL差し替えの drop-in でよい)
2. 動作確認後、各エージェントの認証を **harness API キー(系統1)に差し替え、.env からチャネルアクセストークンを削除**する
3. LINE Developers コンソールでチャネルアクセストークンを**再発行**(旧トークン即失効)。以後トークンを知っているのは worker だけになり、直接送信は物理的に不可能になる
   - 再発行後は D1 `line_accounts.channel_access_token` と `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN` を新トークンに更新
   - 順序厳守: 切替 → 確認 → 再発行。逆にするとエージェントの送信が切替完了まで全部落ちる
4. 以後、新しいエージェントに配るのは **プロキシ URL + harness API キーのみ**

## 記録できないもの

- OAM(LINE 公式アカウント管理画面)からの手動送信 — API を経由しないため原理的に不可能。**OAM からは送らない運用にする**
- プロキシを経由せず api.line.me に直接送られたもの(上記ローテーション完了後は不可能になる)
- reply / narrowcast / グループ・ルーム宛(上表のとおり)
