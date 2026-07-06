# LINE Harness Plugin: Restaurant（飲食店特化拡張）

LINE Harness を飲食店向けに拡張するプラグイン。1店舗 = 1デプロイの汎用プロダクトとして設計。

| 機能 | 内容 |
|---|---|
| デジタル会員証・スタンプカード | LIFF会員証（会員番号自動発行）、店内掲示の「本日の来店コード」入力 or スタッフ操作でスタンプ、満了で特典クーポン自動発行＋LINE通知 |
| 再来店促進 | 誕生日クーポン（年1回）、離反防止の呼び戻しクーポン（最終来店からN日、60日クールダウン、「離反リスク」タグ自動付与） |
| 予約受付＋リマインド | LIFF予約フォーム→LINE確認メッセージ→前日18時＋2時間前リマインド。無断キャンセル抑止 |
| スタッフページ | 来店コード表示・スタンプ押印・特典消込・予約台帳（来店/無断/取消） |
| 配信自動生成 | `tools/campaign.mjs` — 概要1行から Claude が配信文面、Codex image_gen がリッチメッセージ画像・クーポン画像を自動生成し、テキスト→リッチの2連配信を Harness に作成 |
| キャンペーンクーポン | 全員向け共通コード（CP-XXXXXX・複数回消込・使用回数カウント・期限つき） |
| Googleレビュー誘導 | クーポン消込・スタンプ取得＝来店と判定し、**2時間後**に口コミ依頼を自動送信（90日に1回まで） |
| テイクアウト注文 | LIFFでメニュー注文→スタッフに ntfy プッシュ→調理中/準備完了をLINE通知。支払いは店頭 |
| MCPサーバー | Claude Code から予約確認・会員検索・統計・特典発行・クーポン作成・テイクアウトメニュー管理 |

メッセージ送信はすべて LINE Harness API 経由（このWorkerはLINE Messaging APIを直接呼ばない）。

## アーキテクチャ

```
お客様のLINE ── LIFF (/liff/card, /liff/reserve)
                     │ LIFFアクセストークン（サーバー側でLINE検証）
                     ▼
   [ このWorker (Hono + 専用D1) ] ──── LINE Harness API ──── LINEへ配信
                     ▲                    (SDK @line-harness/sdk)
   スタッフ (/staff, PIN認証)
   Claude Code (MCP → /api/admin, APIキー認証)
   Cron */10分（予約リマインド／日次: 誕生日・呼び戻し）
```

## セットアップ（店舗ごと）

前提: LINE Harness 本体がデプロイ済み（`npx create-line-harness`）。

```bash
cd packages/plugin-restaurant

# 1. D1作成 → 出力された database_id を wrangler.toml に反映
wrangler d1 create restaurant-plugin
pnpm db:apply

# 2. wrangler.toml の [vars] を店舗に合わせて編集
#    LINE_HARNESS_API_URL / STORE_NAME / STAMP_GOAL / REWARD_NAME / WINBACK_DAYS

# 3. シークレット設定
wrangler secret put LINE_HARNESS_API_KEY   # Harness の API キー
wrangler secret put STAFF_PIN              # スタッフページ用PIN（4〜8桁推奨）
wrangler secret put PLUGIN_API_KEY         # MCP用（openssl rand -hex 24 など）

# 4. デプロイ → URLを控える
pnpm deploy
```

### LIFF アプリの作成

1. [LINE Developers](https://developers.line.biz/) で LINE Login チャネルに LIFF アプリを追加
   - エンドポイントURL: `https://<worker-url>/liff/card`
   - サイズ: Full / スコープ: `profile`
2. 発行された LIFF ID を `wrangler.toml` の `LIFF_ID` に設定して再デプロイ
   - トークンのなりすまし対策を厳格にする場合は `LIFF_CHANNEL_ID`（LINE LoginチャネルID）も設定
3. リッチメニューやあいさつメッセージ（Harness側で設定）から `https://liff.line.me/<LIFF_ID>` へ誘導

### 来店判定とGoogleレビュー誘導

`wrangler.toml` に `GOOGLE_REVIEW_URL`（Googleビジネスプロフィール > 「クチコミを増やす」のURL）を設定すると有効になる。

- **来店判定のトリガー（5系統）**: ①来店QRスキャン/来店コード/スタッフ押印でのスタンプ ②個人特典（RW-）の消込 ③共通クーポン（CP-）の消込＋会員番号入力 ④予約を「来店」にした時 ⑤テイクアウトの受け取り完了（お客様のスライド操作 or スタッフ操作）
- **来店QR**: スタッフページに毎日自動更新されるQRを表示。お客様はスキャンするだけで自動スタンプ（手入力ゼロ）。レジ横掲示が最も低摩擦な来店把握手段
- 判定から**2時間後**（滞在中に届かないように）に口コミ依頼をLINEで自動送信。同じ会員には**90日に1回まで**
- CP-クーポンは匿名でも消込できるが、スタッフページで会員番号を添えると来店記録・レビュー依頼・離反防止（last_visit_at）まで効く

### テイクアウト注文

- メニューの追加・編集・公開/非公開は**スタッフページ**（/staff）から直接行える（admin API / MCP `upsert_takeout_menu_item` でも可）
- お客様は `/liff/takeout` で数量選択→受取時間（本日・15分後以降・15分刻み）→注文。**支払いは店頭**（決済連携なし）
- **新規注文の店側通知は5系統**（すべて任意・併用可）。**標準構成は「① ntfy ＋ ③ CallMeBot電話」**:
  1. `NTFY_TOPIC` — ntfy.sh プッシュ（無料）。urgent優先度で送るので、ntfyアプリ側で「最大優先度＝アラーム音を鳴らし続ける・サイレント貫通」に設定すればレジ端末が**着信のように鳴り続ける**（常時併用推奨・完全無料）
  2. `CALLMEBOT_TELEGRAM_USER` — 無料の音声通話（店長のTelegramに着信・日本語TTS読み上げ。@CallMeBot_txtbot へ /start で認可）
  3. `CALLMEBOT_PHONE_NUMBER` / `CALLMEBOT_PHONE_APIKEY` — **実電話への架電（導入時の標準）**。審査なし・WhatsAppで5分で開通。下記「CallMeBot電話のセットアップ」参照
  4. `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` — **実電話への架電・回数無制限（繁盛店の移行先）**。メール登録のみで審査なし・番号購入不要・従量課金。宛先は `STORE_PHONE_NUMBER` に設定。**注文が月30件を超えたらこちらへ切り替え**（CallMeBotの環境変数を消してこの2つを設定するだけ）
  5. `TWILIO_*` / `STORE_PHONE_NUMBER` — 最後の手段（発信元番号を自前で持ちたい場合のみ。要アカウント審査）

### CallMeBot電話のセットアップ（5分・審査なし）

1. スマホの連絡先に **+34 611 01 16 37** を追加し、WhatsApp で「**I allow callmebot to call me**」と送信 → 2分以内にAPIキーが返ってくる
2. プランを選ぶ: **Medium $2/月（15回・日本語対応）** か **Big $3/月（30回・日本語対応）**。※Lite $1/月は英語のみなので不可
3. `wrangler.toml` に `CALLMEBOT_PHONE_NUMBER`、`wrangler secret put CALLMEBOT_PHONE_APIKEY` でキー設定 → デプロイ

**重要な制約**:
- **架電先はAPIキーを取得したWhatsApp登録番号**（=手順1で送信した番号）に限られる。**店の固定電話で受けたい場合は、固定電話番号で WhatsApp Business を登録**（認証を「電話で受ける」にすれば固定電話でも登録可能）してから手順1を行う。店長の携帯で受けるならそのまま携帯でOK
- **月の回数上限（15回/30回）を超えた分は鳴らない**。ntfy併用が前提。注文が月30件を超えるようになったらClickSendへ移行（上記④）
- スタッフページで「調理開始→準備完了」を進めると、準備完了時にお客様へLINE通知が飛ぶ
- **受け取り完了はお客様のスライド操作**（注文カードの「スライドして受け取り完了」をスタッフの面前で操作）— スタッフ側のボタンでも可。どちらでも来店判定→レビュー依頼につながる
- 注文キャンセルはお客様側からは調理開始前のみ

### 店舗オペレーション

- **スタッフページ**: `https://<worker-url>/staff` をレジ端末でブックマーク（PIN認証）
- **来店コード**: スタッフページに毎日自動発行される4桁コードを店内掲示（レジ横・卓上）。お客様が会員証に入力するとスタンプが押される（1日1回・10回試行制限）
- **特典消込**: お客様提示の `RW-XXXXXX` をスタッフページで消込

## 配信自動生成（Claude Code + Codex）

キャンペーン概要ひとつから「テキスト配信 → リッチメッセージ（Flex）→ クーポン」を全自動生成する。
運営者のMac上で実行するローカルツール（要: `claude` CLI / Codex CLIログイン済み / macOS）。

```bash
cd packages/plugin-restaurant

# .env に接続情報（または環境変数）
#   LINE_HARNESS_API_URL / LINE_HARNESS_API_KEY
#   RESTAURANT_PLUGIN_URL / RESTAURANT_PLUGIN_API_KEY   ← --coupon 時のみ

# ドラフト作成（既定・Harness管理画面で確認して送信）
node tools/campaign.mjs --brief "雨の日限定10%オフ。雨の日に来店したら全品10%引き" \
  --coupon --discount "10%OFF" --expires 2026-07-31

# 確認済みならそのまま送信（テキスト→リッチの順に自動送信）
node tools/campaign.mjs --brief "..." --coupon --send now

# 画像を使い回す / 画像なし
node tools/campaign.mjs --brief "..." --banner-url https://... 
node tools/campaign.mjs --brief "..." --skip-images
```

パイプライン: ① `claude -p`（sonnet）が配信文・見出し・画像プロンプトをJSON生成 → ② Codex `image_gen` がバナー（1:1）とクーポン背景（横長）を生成（**画像内に文字は入れない**方針。文字はFlexの実テキストで載せるため崩れない）→ ③ `--coupon` 時はプラグインAPIで共通コード CP-XXXXXX を発行 → ④ Harness に画像アップロード → ⑤ テキスト配信＋Flexリッチ配信（バナー+クーポンのカルーセル、CTAは会員証LIFF）を作成。

生成物（copy.json / flex.json / 画像 / summary.json）は `tools/out/<日時>/` に残る。**既定はドラフト**なので、送る前に必ず Harness 管理画面か `flex.json` で内容を確認すること。

## MCP サーバー（Claude Code 連携）

```bash
pnpm build:mcp
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "restaurant": {
      "command": "node",
      "args": ["packages/plugin-restaurant/dist-mcp/index.js"],
      "env": {
        "RESTAURANT_PLUGIN_URL": "https://<worker-url>",
        "RESTAURANT_PLUGIN_API_KEY": "<PLUGIN_API_KEY>"
      }
    }
  }
}
```

ツール: `list_reservations` / `lookup_member` / `get_restaurant_stats` / `issue_reward` / `create_campaign_coupon` / `list_campaign_coupons` / `list_takeout_menu` / `upsert_takeout_menu_item`

## 開発

```bash
pnpm db:apply:local   # ローカルD1にスキーマ適用
pnpm dev              # wrangler dev
pnpm test             # ユニットテスト（純ロジック20件）
pnpm typecheck
```

ローカル用シークレットは `.dev.vars`（gitignore済み）に置く。

## 設計メモ

- 時刻はすべて **UTCで保存**（D1の `datetime('now')` 形式に統一）、表示・判定はJST換算。予約リマインドは「前日18:00 JST」「2時間前」の2本で、送信済みフラグにより重複送信しない
- 日次ジョブ（誕生日・呼び戻し）は10分毎cronの中で `daily_jobs:<date>` キーの INSERT-once により**JSTの日に1回だけ**実行（10:00 JST以降の最初の発火）
- 誕生日・呼び戻しの重複防止は `message_log.dedupe_key`（UNIQUE）で保証
- LIFFのユーザー識別はクライアント申告を信用せず、アクセストークンを LINE の verify + profile API でサーバー検証
- Harness の friend 解決は friends 一覧のページングで `lineUserId` を突合し、`members.friend_id` にキャッシュ（未解決でも動作し、次回アクセスで再試行）
