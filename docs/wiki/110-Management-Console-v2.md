# 110. 事業者向け簡易管理画面 v2 議論用ドキュメント

## 目的

既存のWeb管理画面は、LINE Harnessの機能を開発者・構築担当者が設定するための画面になっている。  
一方で、実際に営業対象となる中小事業者が日常的に使いたい画面はもっと単純でよい。

この v2 管理画面では、既存ページを壊さずに、整体、スポーツ教室、パーソナルジム、クリニック、美容サロンなどの担当者が毎日使える「顧客対応・配信・分析」に絞った簡易コンソールを作る。

営業上の軸は次の3つにする。

- チャット: 顧客情報を見ながら、LINEで素早く対応できる。
- 配信構築: テンプレート、タグ、AI補助で、配信文作成の負担を下げる。
- データ分析: 流入、クリック、フォーム、CVを見て、経営改善に使える。

## 営業対象と課題

### 対象

- 整体、整骨院、鍼灸院
- スポーツ教室、習い事、スクール
- パーソナルジム
- クリニック、歯科、自由診療
- 美容サロン、エステ
- 採用応募窓口
- 小規模店舗の問い合わせ対応

多くは既存の予約システムを持っている。  
そのため、最初から予約機能を前面に出すよりも、LINE上の顧客接点を強化する方が導入しやすい。

### 営業文句

```text
LINEでお客様を取りこぼしていませんか。
連絡が散らばって、対応漏れに困っていませんか。
LINE配信の内容を考えるのが面倒で、配信が止まっていませんか。
```

### 導入メリット

- LINEでの顧客対応を1画面に集約できる。
- 既存顧客データからLINEアカウントを検索し、チャットできる。
- 顧客メモ、タグ、来店済み、リピート見込みなどを見ながら対応できる。
- 作成済みテンプレートをチャットで簡単に送れる。
- タグに応じた配信で、LINEのメッセージ枠を節約できる。
- リッチメニュー、LIFF導線、フォーム、トラッキングリンクをまとめて構築できる。
- フォーム作成と回答集計により、簡易予約・問診・応募受付にも使える。
- Instagram、Google Map、HP、広告などの流入経路を計測できる。
- Discord通知で、スマホに予約・問い合わせ・要確認情報を集約できる。
- AIによる配信文・返信文・画像生成をオプションとして追加できる。

## 既存画面の課題

既存のWeb管理画面は機能単位では十分だが、事業者向けの導線としては分かりづらい。

```text
課題1: 機能がページごとに分かれ、日常業務の流れが見えにくい
課題2: チャット、顧客情報、タグ、テンプレートが分断されている
課題3: 配信作成が「何を誰に送るか」ではなく、設定項目中心に見える
課題4: フォーム、タグ、イベント、CV計測が経営改善につながる形で見えない
課題5: 予約管理が前面に出すぎると、既存予約システムを持つ事業者に刺さりにくい
課題6: リッチメニューやAutomationなど高度機能が、日常操作と同じ重さで並んでいる
```

v2では、機能名ではなく業務の流れで画面を作る。

## 画面構成

v2のURLは既存管理画面と分ける。

```text
既存管理画面
  /chats
  /broadcasts
  /friends
  /templates
  /automations
  /rich-menus
  /forms
  /tracked-links
  /tags-events
  /reservations
  /reservation-ops

新管理画面 v2
  /console-v2
```

既存ページは削除しない。  
v2は、既存APIを使って事業者向けに再構成する。

### 基本タブ

```text
対応
  未読チャット
  顧客検索
  顧客情報を見ながら返信
  テンプレート挿入

配信
  テンプレート作成
  配信下書き
  タグ指定配信
  プレビュー

フォーム
  フォーム作成
  回答一覧
  回答者へのタグ付け
  集計

分析
  流入経路
  クリック
  フォーム完了
  CV
  タグ/イベント推移
```

### 設定から追加する機能

日常画面に全部出さない。必要な機能だけ設定から有効化する。

```text
リッチメニュー
オートメーション
トラッキングリンク
高度なタグ/イベントルール
AI返信補助
AI画像生成
Discord通知
外部予約連携
Google Calendar連携
予約管理
```

## 主要UX

### 1. 対応タブ

目的は「顧客情報を見ながら、すぐ返信できる」こと。

```text
上部
  未読チャット数
  今日の新規友だち数
  要対応件数

左
  チャット一覧
  未読 / 対応中 / すべて
  名前・電話・メール・LINE名検索

中央
  チャット履歴
  返信入力
  テンプレート挿入
  AI返信案

右
  顧客プロフィール
  LINE表示名
  外部顧客名
  電話番号
  メール
  メモ
  タグ
  イベント履歴
  フォーム回答
  流入経路
```

重要なのは、LINE友だち一覧ではなく「顧客対応画面」にすること。

### 2. 顧客検索と紐づけ

既存予約システムや既存顧客リストを持つ事業者を想定する。  
LINE friendと外部顧客情報は最初から完全統合しない。

```text
LINE friend
  line_user_id
  display_name
  picture_url
  tags
  chat history

External customer profile
  name
  phone
  email
  source
  external_id
  metadata
```

候補表示の順序:

```text
1. phone完全一致
2. email完全一致
3. name部分一致 + phone下4桁
4. 管理者による手動リンク
```

MVPでは自動で確定リンクしない。  
誤紐づけは運用事故になるため、候補表示と手動確定を優先する。

### 3. 配信タブ

目的は「配信内容を考えるのが面倒」を解消すること。

```text
テンプレート選択
配信目的
対象タグ
本文作成
カード作成
画像アップロード
LINEプレビュー
下書き保存
送信前確認
```

配信対象は、全員送信よりタグ指定を基本にする。  
LINEのメッセージ通数を節約し、CV率の高い配信を目指す。

AI補助は下書き作成までに制限する。  
AIが直接送信する設計にはしない。

### 4. フォームタブ

既存予約システムがある事業者でも、フォームは使いやすい。  
問診、体験申込、キャンペーン応募、アンケート、採用応募に使える。

MVP項目:

```text
フォーム名
説明
質問
  text
  textarea
  select
  checkbox
  phone
  email
送信後メッセージ
送信後タグ付け
回答一覧
CSV export
```

予約機能を使わない事業者では、フォームが簡易受付機能になる。

### 5. 分析タブ

目的は、LINE運用を経営改善につなげること。

見るべき指標:

```text
流入経路別
  友だち追加数
  チャット開始数
  フォーム送信数
  CV数

配信別
  送信数
  クリック数
  返信数
  ブロック推定

顧客別
  タグ
  イベント
  最終接触
  リピート見込み

導線別
  リッチメニュータップ
  トラッキングリンククリック
  フォーム到達
  フォーム完了
```

## 既存で流用できるAPI

v2は新規APIを増やしすぎない。まず既存APIを組み合わせる。

| 領域 | 既存Webページ | 既存Worker API | 既存DB/実装 | v2での使い方 |
|---|---|---|---|---|
| チャット | `/chats` | `/api/chats`, `/api/chats/:id` | `packages/db/src/chats.ts`, `messages_log`, `friends` | 対応タブの中心機能として再利用 |
| 友だち/顧客 | `/friends` | `/api/friends`, `/api/friends/count` | `friends`, `users` | LINE友だち検索、顧客候補表示に利用 |
| タグ | `/tags-events` | `/api/tags`, `/api/friends/:id/tags` | `tags`, `friend_tags` | セグメント配信、顧客状態表示に利用 |
| イベント | `/tags-events`, `/conversions` | `/api/events`, `/api/event-definitions`, `/api/event-tag-rules` | `user_events`, `conversion_events` | CV、流入、行動履歴に利用 |
| テンプレート | `/templates` | `/api/templates` | `templates` | チャット返信、配信下書きに利用 |
| 一斉配信 | `/broadcasts` | `/api/broadcasts` | `broadcasts` | 配信タブで下書き・送信に利用 |
| フォーム | `/form-submissions` | `/api/forms`, `/api/form-submissions` | `forms`, `form_submissions` | フォーム作成と集計に利用 |
| トラッキングリンク | `/tracked-links` | `/api/tracked-links`, `/t/:linkId` | `tracked_links`, `link_clicks` | 流入経路分析に利用 |
| リッチメニュー | `/rich-menus` | `/api/rich-menus` | LINE API連携 | 設定モーダルから利用 |
| オートメーション | `/automations` | `/api/automations` | `automations`, `automation_logs` | よく使うルールUIから利用 |
| 通知 | `/notifications` | `/api/notifications` | `notifications`, `notification_rules` | Discord通知設定に利用 |
| LINEアカウント | `/accounts` | `/api/line-accounts` | `line_accounts` | 選択中アカウント、token状態確認に利用 |
| 画像 | テンプレート/リッチメニュー周辺 | `/api/images` | R2 | 配信カード、リッチメニュー画像に利用 |

## 既存UIを流用する部分

最初から全画面を作り直さない。

```text
流用する
  チャット取得/送信
  テンプレート一覧
  タグ一覧
  一斉配信API
  フォームAPI
  トラッキングリンクAPI
  リッチメニューAPI
  オートメーションAPI

作り直す
  日常業務の画面構成
  顧客プロフィールの見せ方
  配信作成のUI
  分析ダッシュボードの見せ方
  設定モーダル
```

## DB変更の必要度

### DB変更なしで始められるもの

```text
/console-v2 の画面シェル
チャット一覧/詳細/返信
テンプレート挿入
タグ表示
配信下書き作成
フォーム一覧/回答表示
トラッキングリンクの簡易集計
リッチメニュー設定への導線
オートメーション設定への導線
```

### 小さなDB追加が必要なもの

既存顧客データとLINE friendの紐づけには、新しいテーブルが必要。

```sql
CREATE TABLE external_customer_profiles (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_customer_profiles_source_external
ON external_customer_profiles(source, external_id)
WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_customer_profiles_phone
ON external_customer_profiles(phone);

CREATE INDEX IF NOT EXISTS idx_external_customer_profiles_email
ON external_customer_profiles(email);

CREATE TABLE friend_external_customer_links (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  external_customer_id TEXT NOT NULL REFERENCES external_customer_profiles(id) ON DELETE CASCADE,
  link_method TEXT NOT NULL CHECK (link_method IN ('manual', 'phone', 'email', 'import')),
  confidence INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  UNIQUE(friend_id, external_customer_id)
);

CREATE TABLE customer_notes (
  id TEXT PRIMARY KEY,
  friend_id TEXT REFERENCES friends(id) ON DELETE CASCADE,
  external_customer_id TEXT REFERENCES external_customer_profiles(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

注意点:

- phone/emailは正規化して保存する。
- 自動リンク確定はMVPでは行わない。
- 顧客メモはチャット送信とは分離して保存する。

### 中規模の仕様追加が必要なもの

```text
外部CSV import
外部予約システムWebhook
顧客横断検索API
分析summary API
Discord通知の汎用化
AI返信/配信文生成API
AI画像生成とR2保存
```

## 追加API案

必要最小限のBFFだけ追加する。

```text
GET /api/console-v2/summary
  未読件数、今日の新規友だち数、要対応数、直近CV

GET /api/console-v2/customer-search?q=
  friends + external_customer_profiles の横断検索

POST /api/console-v2/customer-links
  friend_id と external_customer_id を手動リンク

POST /api/console-v2/customer-notes
  顧客メモ追加

POST /api/ai/message-draft
  返信文/配信文の下書き生成

POST /api/ai/image
  配信用画像生成 + R2保存
```

## 権限設計

v2は現場担当者が触るため、権限を分ける。

```text
staff
  チャット返信
  顧客閲覧
  タグ閲覧
  テンプレート利用

admin
  配信下書き
  フォーム作成
  タグ編集
  顧客リンク
  メモ編集

owner
  一斉配信送信
  リッチメニュー反映
  オートメーション有効化
  LINE API token設定
  AI/Discord/外部連携設定
```

MVPではUI上の操作制御から始める。  
本番運用ではAPI側でも権限チェックが必要。

## 実装方針

### Phase 1: 画面シェル

```text
apps/web/src/app/console-v2/page.tsx
```

作るもの:

- 4タブ構成: 対応 / 配信 / フォーム / 分析
- 設定ボタン
- 既存LINEアカウント選択
- モバイルでも操作しやすいレイアウト

DB変更なし。

### Phase 2: 対応タブ

作るもの:

- チャット一覧
- チャット詳細
- 返信入力
- テンプレート挿入
- 顧客プロフィール表示
- タグ表示

既存 `/api/chats`, `/api/templates`, `/api/tags`, `/api/friends` を使う。

### Phase 3: 顧客検索

作るもの:

- 名前/電話/メール/LINE名検索
- LINE friend検索
- 外部顧客profileは最初は未実装またはmock

ここまではDB変更なしでも進められる。

### Phase 4: 外部顧客profile

作るもの:

- `external_customer_profiles`
- `friend_external_customer_links`
- `customer_notes`
- CSV import
- 手動リンクUI

ここでDB migrationが必要。

### Phase 5: 配信タブ

作るもの:

- テンプレート選択
- タグ指定
- 配信プレビュー
- 下書き保存
- 送信前確認

既存 `/api/templates`, `/api/broadcasts`, `/api/tags` を使う。

### Phase 6: フォーム/分析

作るもの:

- フォーム一覧
- 回答一覧
- 回答後タグ付け導線
- トラッキングリンク集計
- CVサマリー

既存 `/api/forms`, `/api/form-submissions`, `/api/tracked-links`, `/api/conversions` を使う。

### Phase 7: AI/Discord

作るもの:

- AI返信案
- AI配信文案
- AI画像生成
- Discord通知設定

AIは必ず下書き止まり。  
Discordは通知だけにし、顧客情報の過剰送信を避ける。

## テスト方針

### UI helper test

- タブ定義が崩れない。
- staff/admin/ownerで表示される操作が変わる。
- 電話番号とメールが正規化される。
- 設定OFFの機能がメイン画面に出ない。

### API test

- `GET /api/console-v2/summary`
- `GET /api/console-v2/customer-search`
- `POST /api/console-v2/customer-links`
- `POST /api/console-v2/customer-notes`
- 外部顧客リンクが重複しない。
- 自動リンク確定をしない。

### 回帰テスト

- 既存 `/chats` が動く。
- 既存 `/broadcasts` が動く。
- 既存 `/templates` が動く。
- 既存 `/forms` が動く。
- 既存 `/rich-menus` が動く。
- 既存 `/reservation-ops` が動く。

## 非目標

MVPではやらない。

- 既存Web管理画面の削除
- 予約管理の完全統合
- AIによる自動送信
- 自動顧客リンク確定
- 外部CRMとの双方向同期
- 高度分析ダッシュボードの完全実装
- 権限システムの完全実装

## 受け入れ条件

- `/console-v2` を開ける。
- 既存管理画面が壊れない。
- LINE友だちを検索できる。
- チャットを見ながらテンプレート返信できる。
- 顧客プロフィール、タグ、メモを見られる設計になっている。
- 配信はタグ指定を基本にできる。
- フォームを予約代替・問診・応募受付として扱える。
- 分析では流入、クリック、フォーム完了、CVを見られる設計になっている。
- 予約機能がなくても価値が伝わる。
- 高度機能は設定から追加できる。

## 現時点の判断

最初に作るべきものは、予約管理画面の改善ではなく、事業者が毎日開く `console-v2` である。  
理由は、営業対象の多くが既存予約システムを持っており、予約枠管理よりも「LINEで顧客対応できる」「配信を作れる」「効果が見える」ことの方が導入価値として伝わりやすいから。

実装は、DB変更なしで作れる画面シェルと対応タブから始める。  
外部顧客データ連携、メモ、手動紐づけは、画面の価値が確認できてからDB migrationを入れる。

## 実装状況

2026-05-29時点。

### 実装済み

```text
apps/web/src/app/console-v2/page.tsx
```

DB変更なしで、既存APIを組み合わせた簡易コンソールを追加した。

- 対応 / 配信 / フォーム / 分析 の4タブ
- 未読チャット、対応中、友だち数、流入クリックのサマリー
- 既存 `/api/chats` を使ったチャット一覧と詳細表示
- 既存 `/api/chats/:id/send` を使ったテキスト返信
- 既存 `/api/chats/:id` 更新を使った対応メモ保存
- 既存 `/api/templates` を使ったテンプレート送信
- 既存 `/api/friends` を使った顧客検索
- 顧客検索結果から `friend.id` を指定してチャットを直接表示
- 既存 `/api/friends/:id` を使った選択中顧客のタグ取得
- 既存 `/api/friends/:id/tags` を使ったタグ追加
- 既存 `/api/friends/:id/tags/:tagId` を使ったタグ解除
- 既存 `/api/tags` を使ったタグ表示
- 既存 `/api/broadcasts` を使った最近の配信表示
- 既存 `/api/forms` を使ったフォーム一覧表示
- 既存 `/api/tracked-links` を使ったクリック概要表示
- サイドバーに `/console-v2` 導線を追加

検索結果からチャットを開く場合、`POST /api/chats` で新規作成しない。  
`GET /api/chats/:id` と `POST /api/chats/:id/send` は `friend.id` を受け取れるため、既存チャットがない友だちでも遅延作成で処理する。これにより、同一friendに対する重複chat作成を避ける。

### まだ未実装

- 顧客メモの専用保存
- AI返信/配信文生成
- AI画像生成
- Discord通知設定

### 検証済み

```text
pnpm --filter @line-crm/db test -- src/external-customers-d1.test.ts
pnpm --filter worker build
pnpm --filter web build
```

Next.js buildは成功している。

### 外部顧客profile 実装済み

DBとWorker APIを追加した。

```text
packages/db/src/external-customers.ts
packages/db/src/external-customers-d1.test.ts
apps/worker/src/routes/external-customers.ts
```

追加テーブル:

- `external_customer_profiles`
- `friend_external_customer_links`
- `customer_notes`

追加API:

- `GET /api/external-customers?q=...`
- `POST /api/external-customers`
- `GET /api/friends/:id/external-customers`
- `POST /api/friends/:id/external-customers`
- `DELETE /api/friends/:id/external-customers/:externalCustomerId`

console-v2では、選択中顧客の右ペインから外部顧客を検索、新規作成、紐づけ、解除できる。

安全制約:

- `source + externalId` がある外部顧客は冪等upsertする。
- `externalId` がない手動顧客は複数作成を許可する。
- phone/emailは保存前に正規化する。
- `friend_id + external_customer_id` は重複リンクしない。
- 自動確定リンクはしない。MVPでは管理者の手動リンクのみ。

### CSV import 実装済み

console-v2の外部顧客データセクションからCSVを選択し、既存 `POST /api/external-customers` に順次upsertする。

```text
apps/web/src/lib/external-customer-csv.ts
apps/web/src/lib/external-customer-csv.test.ts
```

対応カラム:

```text
name / 氏名 / 名前 / 顧客名
phone / tel / 電話 / 電話番号
email / mail / メール / メールアドレス
source / ソース / 媒体 / システム
externalId / external_id / id / 顧客ID / 会員ID
```

安全制約:

- 取り込みはWebから1行ずつ既存APIに送るため、Workerに巨大CSVを直接渡さない。
- `source + externalId` がある行はDB helper側で冪等upsertされる。
- 名前・電話・メールがすべて空の行は取り込まない。
- CSVの全列は `metadata` に残す。

検証:

```text
pnpm --filter web test -- src/lib/external-customer-csv.test.ts
```

### 配信下書き作成 実装済み

console-v2の配信タブから、テンプレートと対象を選んで一斉配信の下書きを作成できる。

利用API:

```text
GET /api/templates
GET /api/tags
POST /api/broadcasts
GET /api/broadcasts
```

安全制約:

- console-v2では送信しない。
- 作成するbroadcastは `status='draft'` に固定する。
- タグ配信の場合は `targetTagId` が必須。
- 送信は既存 `/broadcasts` で内容確認後に行う。

この設計により、事業者向けの画面では「作成しやすさ」を優先し、誤送信リスクの高い実送信は既存の確認画面に逃がす。

### 簡易フォーム作成 実装済み

console-v2のフォームタブから、用途別presetで最小フォームを作成できる。

利用API:

```text
GET /api/forms
POST /api/forms
GET /api/tags
```

preset:

- 問い合わせ
- 体験申込
- 問診・アンケート

共通項目:

- お名前
- 電話番号
- メールアドレス

安全制約:

- console-v2では複雑なフォームビルダーを作らない。
- 作成後の詳細編集や回答確認は既存 `/form-submissions` に逃がす。
- 回答後タグ付けは `onSubmitTagId` を使う。
- `saveToMetadata=true` にして、回答内容を顧客情報に活かせるようにする。

### 分析タブ強化 実装済み

既存APIだけで、console-v2の分析タブを強化した。

利用API:

```text
GET /api/tracked-links
GET /api/conversions/report
GET /api/events
```

表示内容:

- 有効リンク数
- 総クリック数
- CV数
- CVレポート上位
- 直近イベント
- イベント種別の件数
- クリック上位リンク
- 経営改善で見るべき指標

安全制約:

- 新しい分析summary APIはまだ作らない。
- 高度なファネル分析やCV率計算は次フェーズにする。
- 既存の `tracked-links`, `conversions`, `tags-events` へ誘導し、詳細設定は既存画面で行う。

### console-v2 ファイル分割 実装済み

`page.tsx` が肥大化していたため、画面表示の責務をタブ別に分割した。

```text
apps/web/src/app/console-v2/page.tsx
apps/web/src/app/console-v2/types.ts
apps/web/src/app/console-v2/utils.ts
apps/web/src/app/console-v2/_components/shared.tsx
apps/web/src/app/console-v2/_components/support-tab.tsx
apps/web/src/app/console-v2/_components/broadcast-tab.tsx
apps/web/src/app/console-v2/_components/forms-tab.tsx
apps/web/src/app/console-v2/_components/analytics-tab.tsx
```

設計ルール:

- `page.tsx` は状態管理、API呼び出し、タブ切り替えだけを持つ。
- 各タブのDOMと操作UIは `_components/*` に閉じる。
- 共通カード、ミニリスト、手順カードは `shared.tsx` に寄せる。
- 型は `types.ts`、表示補助関数は `utils.ts` に寄せる。
- 新しいAPIやDB変更は入れず、既存の動作を保ったまま保守性を上げる。

確認:

```text
pnpm --filter web build
```
