# hyhome Harness iOS アプリ 別セッション 引継ぎパッケージ

> 別セッションで iOS アプリを Swift ネイティブで開発するための完全な引継ぎドキュメント。
> このファイルだけで、新規セッションが文脈ゼロから開発を始められる構成。

## ユーザー前提

- **前田泰康 (Maeda Yasuyasu)** — Apple Developer Program 加入済み (個人)
- Swift / SwiftUI / UIKit / Xcode 経験あり (Pochitto 等の自作配信実績)
- 既存の業務: hyhome (株式会社) の家づくり相談業務、LINE 公式 `@qNG7n2` 運用中
- 現在の代替手段: ELMe の iPhone アプリを使用中 (これを置き換える)

## 目的

ELMe の iPhone アプリを **hyhome Harness 純正アプリ** に置き換える。具体的には：

1. 新規友だち追加のプッシュ通知
2. 未対応メッセージのリアルタイム通知
3. 友だちとの個別チャット (タイムライン、入退室、テキスト送信)
4. リッチメニュー切替、シナリオ手動enroll
5. かんたん通知設定 (Lark に流すルールと同等)

## ハーネス側がすでに提供している API

API ベース: `https://hyhome-harness.kashiyu-mina-iezukurisoudan.workers.dev`

認証: `Authorization: Bearer <api_key>` (staff の api_key)

### スタッフ認証 + アカウント情報
- `POST /api/staff/auth` — email/password 等で認証 (要拡張)
- `GET /api/capabilities` — 機能の有効/無効を返す

### 友だち
- `GET /api/friends?lineAccountId=xxx&limit=50&offset=0`
- `GET /api/friends/:id`
- `GET /api/friends/:id/messages`

### チャット
- `GET /api/chats?lineAccountId=xxx`
- `GET /api/chats/:friendId`
- `POST /api/chats/:friendId/messages` (text/image)

### 通知
- `POST /api/device-tokens` — iOS アプリから APNs token を登録
  - body: `{ token, platform: 'ios', bundle_id, environment, device_name? }`
- `GET /api/device-tokens/mine`
- `DELETE /api/device-tokens/:token`

### push 通知をハーネスから iOS に送る (今後実装する)
- `LARK_*` と同じ仕組みで `apns-pusher.ts` がトリガ (Service 既存)
- 必要なのは APNs 認証情報 (Worker secrets):
  - `APNS_TEAM_ID` — Apple Developer Team ID
  - `APNS_KEY_ID` — APNs 認証 .p8 の Key ID
  - `APNS_AUTH_KEY` — .p8 の中身 (multi-line OK)
  - `APNS_BUNDLE_ID` — iOS アプリの Bundle ID (例: `co.hyhome.harness`)

## iOS アプリ要件

### 機能 (MVP)

| # | 機能 | 優先度 | 想定 |
|---|---|---|---|
| 1 | サインイン (Sign in with Apple → staff_id 紐付け) | 高 | OAuth + JWT |
| 2 | 友だち一覧 (検索可能) | 高 | List + pull-to-refresh |
| 3 | 個別チャット画面 | 高 | iMessage 風 UI |
| 4 | プッシュ通知 (新規追加・未対応・フォーム回答) | 高 | APNs |
| 5 | リッチメニュー切替 | 中 | Picker |
| 6 | シナリオ手動 enroll | 中 | Action sheet |
| 7 | 友だち詳細・タグ編集 | 中 | Form |
| 8 | Lark 通知設定との連動 (ON/OFF 切替) | 低 | Settings |

### 技術スタック

| 項目 | 推奨 |
|---|---|
| 言語 | Swift 5.10+ |
| UI | SwiftUI (iOS 17+) |
| API client | URLSession + async/await + Codable |
| Auth | Sign in with Apple + Worker 側で staff_members.email 突合 |
| Push | APNs (HTTP/2 + .p8 認証) |
| 永続化 | UserDefaults (api_key, staff_id) + SwiftData (オフラインキャッシュ) |
| 配布 | TestFlight → App Store |
| Bundle ID | `co.hyhome.harness` (前田さんの dev account 内で新規登録) |

### Sign in with Apple フロー

1. iOS アプリでログイン → Apple ID で identity token 取得
2. アプリは worker の `POST /api/staff/auth/apple` に identity token を送る (要新規実装)
3. worker は token を検証 → email を取得 → staff_members.email でマッチング
4. マッチした staff の api_key を返す
5. アプリは api_key を Keychain に保存、以降は Bearer 認証

### プッシュ通知の流れ

```
[ハーネス worker]
   ↓ (新規友だち追加 webhook を処理)
[lark-notifier-hooks.ts]
   ↓ (将来: apns-pusher.ts も呼ぶ)
[apns-pusher.ts]
   ↓ HTTP/2
[APNs]
   ↓
[iOS デバイス]
```

既に存在するもの:
- `apps/worker/src/services/apns-pusher.ts` — 雛形あり
- `device_tokens` テーブル — 雛形あり
- `apps/worker/src/routes/device-tokens.ts` — 雛形あり

不足:
- `LarkNotifier` と同じパターンの `iOSNotifier` を作る (apns-pusher.ts は基盤、これを通知 dispatcher として呼ぶ)
- ルール CRUD UI (Lark と同じ感じ)

## 別セッションの作業手順

このセッションは Claude Code 上で新規セッションを開いて、worktree を別ディレクトリに clone してから開始する。

### Step 0: 引継ぎを確認

このファイルを開き、引継ぎ内容を理解する。同時に：

```bash
cat ~/hyhome/ads/line/harness/fork/RUNBOOK.md  # 本番運用情報
cat ~/hyhome/ads/line/harness/fork/AGENTS.md  # Harness 全体の指針
```

### Step 1: 新規 worktree

```bash
cd ~/hyhome/ads/line/harness/fork
git worktree add -b ios-app ../fork-ios-app
cd ../fork-ios-app
```

### Step 2: iOS Xcode プロジェクト作成

このリポジトリ内に `apps/ios/` を作る。

```bash
mkdir -p apps/ios
cd apps/ios
# Xcode で新規 App プロジェクト, Bundle ID: co.hyhome.harness
```

### Step 3: APNs 認証情報を Worker secrets に登録

```bash
cd ~/hyhome/ads/line/harness/fork/apps/worker
pnpm exec wrangler secret put APNS_TEAM_ID --config wrangler-prod.toml
pnpm exec wrangler secret put APNS_KEY_ID --config wrangler-prod.toml
pnpm exec wrangler secret put APNS_AUTH_KEY --config wrangler-prod.toml
pnpm exec wrangler secret put APNS_BUNDLE_ID --config wrangler-prod.toml
```

`APNS_AUTH_KEY` は .p8 の中身を改行込みで貼り付け。

### Step 4: iOS Notifier dispatcher を実装

`apps/worker/src/services/ios-notifier.ts` を `lark-notifier.ts` と同じパターンで作る。
`apns-pusher.ts` は既存なので、その上に dispatcher を載せるイメージ。

Migration として `ios_notifications` テーブルを追加 (lark_notifications と同じ構造)。

### Step 5: webhook / form ハンドラに統合

`lark-notifier-hooks.ts` と同じパターンで `ios-notifier-hooks.ts` を作る。

### Step 6: iOS アプリ実装

- `apps/ios/Harness/` 配下に SwiftUI で実装
- API client は `apps/ios/Harness/Networking/APIClient.swift`
- モデルは worker の type と一致するように生成 (`pnpm tsx scripts/generate-swift-types.ts` を将来用意)

### Step 7: TestFlight 配信

- App Store Connect → TestFlight → Internal Testing
- 前田さん自身の Apple ID で登録 → アプリインストール → 動作確認

## 既知の落とし穴

1. **APNs の environment**
   - `sandbox` (TestFlight) と `production` (App Store) は別の API endpoint
   - device_tokens テーブルに environment カラムがあるので、登録時に正しく入れる
   - APNs サーバー URL: `https://api.push.apple.com` (production) / `https://api.sandbox.push.apple.com` (sandbox)

2. **JWT 署名 (APNs HTTP/2 認証)**
   - p8 ファイルから ES256 で署名
   - Cloudflare Worker は Web Crypto API で生成可能 (apns-pusher.ts に既にあるはず)
   - キャッシュ TTL は短め (1時間) にする

3. **iOS 17 の background remote-notification は untrusted-content-only**
   - silent push (content-available) は配信レート制限あり
   - 重要通知は visible alert に切替

4. **Sign in with Apple の email リレー問題**
   - relay email (xxxx@privaterelay.appleid.com) で来る場合あり
   - staff_members のスキーマで `apple_user_identifier` を別途持つほうが安全

## チェックリスト (引継ぎ先セッションが進捗確認できる粒度)

- [ ] Step 0: 引継ぎ確認
- [ ] Step 1: worktree
- [ ] Step 2: Xcode プロジェクト
- [ ] Step 3: APNs secrets
- [ ] Step 4: ios-notifier.ts
- [ ] Step 5: hooks 統合
- [ ] Step 6: iOS 実装 (機能ごとにサブタスク化)
  - [ ] Sign in with Apple
  - [ ] 友だち一覧
  - [ ] 個別チャット
  - [ ] プッシュ通知受信
  - [ ] リッチメニュー切替
  - [ ] 設定画面
- [ ] Step 7: TestFlight 配信

## 参考

- LINE Messaging API: https://developers.line.biz/ja/reference/messaging-api/
- Apple Sign in: https://developer.apple.com/documentation/sign_in_with_apple
- APNs: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
- 本リポ: https://github.com/maedayasao-tech/line-harness-oss (fork from Shudesu/line-harness-oss)
