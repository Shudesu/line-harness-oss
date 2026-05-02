---
chapter: 4
title: キャンペーン設計
tier: paid
status: draft
---

# 第4章 キャンペーン設計

> 【tier: 🔒 有料】「測れない配信は打たない」を実装に落とし込む章。トラッキングリンク・ref_code first-touch・診断セグメント・ステップ配信・CV計測まで、1キャンペーンを「設計→計測→改善」の閉じたループにする。

## 章の目的

- 「全ての配信URLはトラッキングリンク経由」を運用ルールではなく**設計上の前提**として組み込めるようになる
- 友だち1人ごとに「最初に踏んだref_code」を保持し、後続配信の出し分け・効果測定の軸にできる
- LIFFフォームによる診断 → タグ付け → セグメント絞り込み → 段階配信を1本の導線として設計できる
- 「フォーム送信」「決済完了」「来場」など何をCVとするかを最初に定義し、`/api/conversions/track` への送信内容まで決められる

## 想定読者

- LINE公式アカウントを既に運用していて、配信して反応が薄い／CVRが計測できない／流入元が混ざるのが気持ち悪い人
- L社・U社で「配信はできるが、何が効いて何が効いてないか分からない」状態に苛立っているマーケター
- AAA・Harnessコミュニティで自社獲得ファネルを立て直そうとしている事業者

---

## 4.1 設計の原則 — 「測れない配信は打たない」

LINE配信の運用が3ヶ月で破綻する原因は、ほぼ全て同じだ。**最初に計測点を決めずに配信を打ち始める**こと。タグも作る、シナリオも組む、URLも貼る。それで2週間後に「で、結局どこから来た友だちが買ったの?」と聞かれて答えられない。URLの後ろに `?utm_source=` を付けただけで満足し、LINEのメッセージ吹き出しから飛んだクリックを誰一人として識別していなかったからだ。

L社・U社のステップ配信を運用したことがある人なら覚えがあるはず。配信は飛ぶ、開封もされている、たぶんクリックもされている。しかし「直リンク」をメッセージに貼った瞬間、そのクリックは**LINEの外**で消える。LINE公式の管理画面が出してくれるのは配信通数とブロック率だけ。誰が、どのキャンペーンで、いつクリックして、決済に至ったか — このチェーンを切らずに保持するのは、既存ツールでは構造的にほぼ不可能。

LINE Harnessの設計思想は、この欠落を埋めることに全振りしている。原則はたった一つ。

> **「測れない配信は打たない」**

ここから派生する運用ルールが3つ。

1. **配信に出るURLは1本残らずトラッキングリンク** — 直リンク禁止。LP、カレンダー、フォーム、決済ページ、外部SNS、すべて `create_tracked_link` を一度通す
2. **1キャンペーン = 1ref_code = 1tracked_link** — Instagram経由・X経由・オフラインQR経由を同じリンクで束ねたら、計測した瞬間に意味を失う
3. **CVは最初に1つ決める** — フォーム送信か、決済完了か、オフライン来場か。**運用しながら変える**のは厳禁

この3つを守るだけで、配信効果は「なんとなく良かった気がする」から「この導線のCVRはX%、こっちはY%、だから次はXに予算を寄せる」に変わる。第4章は、この3原則を実装ベースに翻訳する章だ。

頻出する誤解を1つ潰しておく。「Harnessなら配信内のURLは自動でトラッキングされるんでしょ?」 — 半分は正しい。`send_message` / `broadcast` / ステップ配信の本文中URLは、Worker側で自動的にトラッキングリンクに包まれる(URL自動追跡、v0.4.0+)。だがこれは**保険**であって設計の代替ではない。自動ラップでは `name` が機械生成になり `tagId/scenarioId` も NULL。**設計したいなら手動で `create_tracked_link` を発行**し、自動ラップは「うっかり生URLを混ぜた時の保険」として割り切る。

---

## 4.2 トラッキングリンク設計 — `create_tracked_link` の正しい使い方と落とし穴

### なぜ直リンクが禁止なのか

直リンクをメッセージに貼ると、構造的に3つの数字が永遠に取れなくなる。

| 取れなくなる数字 | 影響 |
|---|---|
| **誰がクリックしたか** | friend_id 単位のCV経路追跡が不能。LTV計算もできない |
| **何経由のクリックか** | Instagram と X のどちらから来た友だちが買ったか分離不能 |
| **いつクリックされたか** | 配信から何時間以内に反応する友だちが多いかの時間分布が取れない |

「GA4 で拾えばいい」は半分しか正しくない。LINE in-app browser は session として正しく扱えないケースがあり UTM が落ちる。仮に取れても**LINE Harness の friend_id と紐付ける手段がない**。「どの友だちがクリックしたか」は Harness の中でしか解けない問題で、外部解析ツールでは原理的に無理。

### `create_tracked_link` の最小構成

トラッキングリンクは**毎キャンペーン専用に1本発行**する。流用しない。

```bash
# 1. tracked_link を発行 (originalUrl は LP やフォームのトップ URL でよい)
curl -X POST "https://<your-worker>.workers.dev/api/tracked-links" \
  -H "Authorization: Bearer <your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "2026-04-IG-harness-seminar",
    "originalUrl": "https://liff.line.me/<your_liff_id>?form=<your_form_id>",
    "tagId": "<tag_id_ig_lead>",
    "scenarioId": "<scenario_id_seminar_followup>",
    "rewardTemplateId": "<template_id_for_ig_reward>"
  }'
# → レスポンスの id (UUID) をメモする
```

配布する URL は **`/t/<tracked_link_id>` (汎用クリック計測経路)** を基本とする。`/t/` ハンドラは `link_clicks` にクリックを記録してから `originalUrl` へ 302 リダイレクトする。LINE 友だち追加導線に乗せたいなら、`originalUrl` を LIFF URL (`https://liff.line.me/<liff_id>?form=<form_id>`) にしておけばよい。

```
配布する URL: https://<your-worker>.workers.dev/t/<tracked_link_id>
```

ここに 4 つの設計判断が詰まっている。

1. **`name` は「日付-流入元-施策」** — `2026-04-IG-harness-seminar` のように後で grep できる命名規則を決める。手動で発行するなら絶対に「セミナー申込」みたいな名詞だけにしない、被るから
2. **`originalUrl` は LIFF の URL** — トラッキングリンクの飛び先は LP ではなく**先に LIFF フォーム**を通すケースが多い (4.3 で詳述)。`originalUrl` は作成後 PATCH で変更できない (PATCH 可能フィールドは `name` / `tagId` / `scenarioId` / `introTemplateId` / `rewardTemplateId` / `isActive` のみ) ため、URL は最初から確定させる
3. **`tagId`** — リンク経由で流入したユーザに「IG 経由リード」タグを自動付与。**ただし発火条件付き** — `friendId` が解決できたクリックだけ(LINE アプリ内クリックや LIFF 経由のリダイレクト)。Instagram/X の in-app browser からの匿名クリックでは `friendId=NULL` のためタグは付かず、後段の `/auth/line` または LIFF 経由で friend が紐付いた時点で `applyRefAttribution` が同じ tracked_link を引いてタグを付ける
4. **`scenarioId`** — `tagId` と同じく **`friendId` 解決後**にエンロール。LIFF 経由は即時、外部ブラウザ匿名クリックは LINE 復帰後に遅れて発火する

> ⚠️ **`/t/:linkId` だけでは per-campaign reward は引けない**。reward を効かせるには submit body に `trackedLinkId` を載せる必要があり、それは LIFF 側が `?ref=<tracked_link_id>` を URL から拾って付ける仕組み。`originalUrl` は作成後変更できないので「自分の id を `?ref=` に埋めた LIFF URL」を作れない。**LIFF + reward を同時に使う場合は `/r/<tracked_link_id>` を使う**(後述「短縮ハブ `/r/:ref`」)。`/t/` で十分なのはクリック計測 + リダイレクトだけが目的の汎用 LP 経路。

### よくある落とし穴

- **リンクを複数キャンペーンで使い回す** — 「セミナー申込LP」を2月・3月・4月で使い回すとクリック数は累積されるが月別CVRが分離不能になる。**毎月新しい tracked_link を発行**し、古いリンクは触らずそのまま active で残す(古い `/t/<id>` や `/r/<id>` を SNS や QR、過去の LINE メッセージに既に流通させているため、`is_active=false` にすると 404 化して残骸が事故る。クリックログは累積するが集計時に `name` 接頭辞 (`2026-04-...`) で月を絞ればよい)
- **`originalUrl` に固有クエリを直接埋め込む** — `?utm_source=line` を固定するとリンク流用が辛い。utm 系は LIFF / ランディング側で `?ref=` から自動生成
- **リッチメニューに直接 LP の生 URL を貼る** — リッチメニューは LINE 友だちにしか表示されない (= friend は確定済み) ので、`/t/<tracked_link_id>` 経由ならクリック計測 + `lu=` 付き LIFF サンドイッチで `friend_id` を確実に拾えてから originalUrl にリダイレクトする。生 URL を貼ると Worker を通らないのでクリック数も `friend_id` 紐付けも失う
- **自動ラップ任せで命名規則を持たない** — 本文にうっかり生 URL を混ぜると Worker が自動ラップしてくれるが、`name="auto-wrapped-..."` の汎用名 + `tagId/scenarioId` NULL。数週間放置で「謎のリンクが10本」になる。手動発行 → 本文に直貼りで統一

### ABテストはリンクを分けるだけ

「ABテストしたい」と思った瞬間にやることは1つ。**ABそれぞれに別のトラッキングリンクを発行**する。同じ LP に飛ばす A 版・B 版でも `name=2026-04-seminar-a` / `2026-04-seminar-b`、`tagId` も別にする。これだけで `link_clicks` から AB クリック差分が、`conversion_events` から CVR 差分が、追加コードなしで出る。分けなかったキャンペーンは**永遠に比較できない**。

### 短縮ハブ `/r/:ref` を SNS / オフライン QR で使う

`/t/:linkId` がブラウザクリック計測専用なのに対し、`/r/:ref` は**LINE 友だち追加導線専用**の短縮 URL ハブ。Worker が `/r/:ref` で受けて、デバイス判定 + LIFF Universal Link 解決 + 失敗時の help ページを 1 URL で内包する。Instagram のプロフ欄・X のリンク・名刺やチラシの QR にこれ 1 本貼る運用が想定。

```
https://<your-worker>.workers.dev/r/<tracked_link_id>?form=<form_id>
                                           ^                ^
                                           |                |
                          tracked_link の id を入れる  optional: LIFF で開かせるフォーム
```

挙動:
- **モバイル**: User-Agent で iOS / Android 判定 → LIFF (`liff.line.me/...`) を Universal Link で開く。X / Instagram / FB 等の in-app browser がリンクを握り潰す問題への保険として、長押しヒント (iOS) / `intent://` (Android) を画面に同梱
- **デスクトップ**: QR コード (LIFF URL を encode) を表示。スマホで読んで友だち追加 → そのまま LIFF へ
- **失敗時**: `/r/:ref/help?t=<resolved_liff_url>` で「URL をコピーして Safari で開く」escape ページ。pooled ref で help ページを別タブで開いてもアカウントが re-roll しないように `t=` で resolved LIFF URL を固定
- **`?ref=` の解決**: Worker (`applyRefAttribution`) が `entry_routes` テーブルを先に試し (legacy slug 互換)、無ければ `tracked_links.id` で UUID ルックアップ。前者は tag/scenario の付与、後者は per-campaign reward 解決まで通る

> **どちらを使うか**:
> `/t/:linkId` = 「ブラウザで何かを表示するタイプの LP / 外部サイトへの導線で計測したい」
> `/r/:ref`   = 「LINE 友だち追加が最終目的、SNS のリンク欄や QR で 1 本だけ貼りたい」

---

## 4.3 ref_code first-touch モデル — 「最初に踏んだ流入元」を友だちに焼き付ける

### なぜ first-touch か

友だち追加から購入までに何週間もかかるのが普通。IG広告から流入 → LINE追加 → 翌週セミナーURLクリック → さらに翌週フォーム送信 → 1ヶ月後決済。この間に friend は**3つのキャンペーンのトラッキングリンクをクリックしうる**。CV発生時に「最終クリック」だけで attribution すると、1ヶ月前にIGから連れてきた価値はゼロ評価。マーケで何度もやらかされる last-touch attribution の罠を、Harness は **first-touch を default で焼き付ける** ことで回避する。

### 焼き付けの仕組み

`friends.first_tracked_link_id` カラム(マイグレーション `022_friend_first_tracked_link.sql`)に**LIFF / form 経由で friend が初めて確定した時点の tracked_link** が入る。以後どれだけ別キャンペーンのリンクを踏んでもこのカラムは上書きされない。

> ⚠️ このカラムが pin されるのは現状 **`/auth/callback` の form フローと `/api/liff/send-form-link`** のみ。`/t/:linkId` のクリック単独 (LP 経由 LINE 追加なし) ではセットされないため、**「友だち追加に LIFF/form を経由しないキャンペーン」では first-touch が空のままになる**。reward fallback や CV attribution の議論はこの前提で読む — `/t/<id>` のみ運用なら CV 時に明示的に `metadata.trackedLinkId` を渡す経路が必須。

```sql
-- 概念図
SELECT
  f.id,
  f.display_name,
  tl.name AS first_touch_campaign,
  COUNT(lc.id) AS total_clicks
FROM friends f
LEFT JOIN tracked_links tl ON f.first_tracked_link_id = tl.id
LEFT JOIN link_clicks lc ON lc.friend_id = f.id
GROUP BY f.id;
```

これでCV発生時に「この友だちは何経由で連れてこられたか」が確定する。IGキャンペーンのリンク経由で友だち追加 → 3週間後にメルマガからLP行って買っても、**CVはIGに attribute** される。マーケ的にこれが一番「実態に合う」。

### ref を導線で受け渡す

配布 URL `/r/<tracked_link_id>` 経由で LIFF に着地すると、`?ref=<tracked_link_id>` が URL に乗って LIFF クライアントが拾い、`/api/forms/:id/submit` の body に `trackedLinkId` として積む。Worker (`resolveRewardTemplate`) は submit を受けた時に:

1. `body.trackedLinkId` で `getTrackedLinkById` を引いて解決できる場合:
   - `reward_template_id` が NULL でなければそのテンプレートを返す (v0.10.1+)
   - **NULL の場合は明示的に `null` を返してフォームの `on_submit_message_*` にフォールバック** — first-touch には行かない (キャンペーン側で意図的に reward を出さない選択を尊重するため)
2. `body.trackedLinkId` が解決できない (typo / 削除済み / 流出した古い id) 場合のみ、`friends.first_tracked_link_id` を引いて first-touch fallback を試みる

この**「キャンペーン優先 + first-touch フォールバック」の二段構え**がHarnessの肝。L社の `URL クリック計測` は単発のクリック数しか見られず、Utage もタグ付与はできるが submit 時の「どのキャンペーン経由か」識別は持たない。

> ⚠️ **`?ref=` には UUID を入れる**。`?ref=ig-2604-seminar` のようなスラッグを直接入れると `getTrackedLinkById` が解決できず必ず first-touch fallback になるので、per-campaign reward は機能しない。スラッグで運用したい場合は `entry_routes` テーブル経由(`getEntryRouteByRefCode` 互換、tag/scenario の付与は OK だが reward 引きには使われない)。

### 設計上の判断ポイント

**「同じフォームを複数キャンペーンで使い回したい」** — Harnessの真価が出るシーン。AAAで「無料相談フォーム」をIG広告経由・X経由・既存LINE再エンゲージ経由で使い回す時、フォームは1本のままで、キャンペーンごとに別の tracked_link を作って `reward_template_id` を変える。submit 後に届く reward メッセージはキャンペーン固有 — IG経由にはIG限定特典、X経由にはX限定特典(v0.10.1+ の reward 解決優先度)。

**`requestedTrackedLinkId` が解決して `reward_template_id=NULL` の場合**は **first-touch fallback には行かず**、フォームの `on_submit_message_*` (フォーム標準完了メッセージ)にフォールバックする。これは「reward を意図的に出さないキャンペーン」のときに他キャンペーンの reward が漏れないための設計。first-touch fallback が動くのは `requestedTrackedLinkId` 自体が引けなかった (typo / 削除済み / 流出した古い ID 等) ケースのみ。v0.10.1 でこの挙動に変わっているので、古い知識(v0.10.0)で運用すると事故る。

---

## 4.4 診断 → セグメントの組み立て — LIFFフォーム + タグ + メタデータ

### 診断は「分けるためにやる」

「友だち追加してくれた人にとりあえずアンケート」は最悪のパターン。回答コストに対しユーザーにリターンが見えないから離脱する。診断フォームの目的は1つに絞る。

> **後続配信を出し分けるための、最小限の属性収集**

集めるべきは「興味分野」「予算感」「現状ステージ」程度。名前・メアド・電話番号はCV直前のフォームでまとめて取る。診断フォームは**ファネルを進めるためのチケット**であってリード情報の総ざらいではない。

### LIFF フォーム + 自動タグ付与

`forms` テーブルの `on_submit_tag_id` と `on_submit_scenario_id` を使う。これがHarnessでセグメント化を最も低コストで作る方法。

```bash
# 例: AAA向け「興味分野診断」フォーム
curl -X POST "https://<your-worker>.workers.dev/api/forms" \
  -H "Authorization: Bearer <your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "興味分野診断",
    "fields": [
      {
        "name": "interest",
        "label": "今いちばん知りたいことは?",
        "type": "radio",
        "required": true,
        "options": ["AI で集客", "AI で制作効率化", "AI で新規事業"]
      },
      {
        "name": "stage",
        "label": "現状の事業ステージ",
        "type": "radio",
        "required": true,
        "options": ["これから立ち上げ", "月商100万未満", "月商100万-500万", "月商500万以上"]
      }
    ],
    "onSubmitTagId": "<tag_id_diagnosed>",
    "onSubmitScenarioId": "<scenario_id_post_diagnosis>",
    "saveToMetadata": true
  }'
```

`saveToMetadata: true` がポイント。`friends.metadata` に `{"interest":"AI で集客","stage":"月商100万-500万"}` がマージ保存され、後でセグメント配信時に `condition_type=metadata_equals` で「月商500万以上だけに送る」が一発。

### タグ命名規則 — 排他か包含か

セグメント運用で破綻する最大原因は**タグ命名の混在**。「興味:AI集客」と「集客興味あり」が両方あると3ヶ月後に分からなくなる。最初に決める。

| カテゴリ | プレフィックス | 排他/包含 |
|---|---|---|
| 流入元 | `src:` (`src:ig`, `src:x`, `src:offline`) | **排他**(first-touchで1つ) |
| 興味分野 | `int:` (`int:marketing`, `int:product`) | **包含**(複数OK) |
| ステージ | `stage:` (`stage:idea`, `stage:m500`) | **排他**(常に最新1つ) |
| ステータス | `status:` (`status:lead`, `status:paid`) | **排他**(ライフサイクル) |

排他タグは、新しい値が付く時に古い値を `removeTagFromFriend` するオートメーションを1本書く。サボると「stage:idea と stage:m500 が両方ついてる人」が量産される。

### メタデータ vs タグ — 使い分け

|  | タグ | メタデータ |
|---|---|---|
| **用途** | 配信条件の絞り込み、シナリオトリガー | 個別化(差し込み)、CV後の分析 |
| **多対多** | 多対多リレーション | 1:1 KV |
| **配信条件で使う** | 高速 (`tag_exists` / `tag_not_exists`) | 中速 (`metadata_equals`) |
| **シナリオトリガー** | `tag_added` トリガーが使える | トリガーにできない |

ルール: **「配信を出し分ける軸」はタグ**、**「テキスト差し込み・分析の属性」はメタデータ**。月商をタグにすると範囲検索が効かないので、月商はメタデータに数値で持ち → タグは閾値超えで自動付与、の二段構え。

### セグメントは「配信時に決まる」

L社・U社で慣れている人は「セグメントを事前に作って保存」しがちだが、Harness では `POST /api/broadcasts/:id/send-segment` の `conditions` でその場で組み立てる。

```typescript
// 「IG経由 かつ 月商100-500万 かつ 診断完了済み」
// (現状の buildSegmentQuery は tag_exists/tag_not_exists/metadata_equals/
//  metadata_not_equals/ref_code/is_following/friend_ids のみ対応。
//  「過去N日以内」のような時間フィルタは未対応 — 必要なら期間専用タグを
//  cron で付与/剥がす運用にする)
{
  operator: 'AND',
  rules: [
    { type: 'tag_exists', value: '<tag_id_src_ig>' },
    { type: 'tag_exists', value: '<tag_id_stage_m100>' },
    { type: 'tag_exists', value: '<tag_id_diagnosed>' }
  ]
}
```

これでセグメント定義を保存・管理する手間がなくなる。一見面倒だが、保存しないことで「古いセグメント定義が腐る」事故を構造的に防げる。

---

## 4.5 ステップ配信シナリオの組み方 — トリガー、ジッター、分岐

### キャンペーン分離の鉄則

> **1キャンペーン = 1シナリオ + 1タグ + 1ref_code**

混ぜたら計測できない。「3月セミナー」と「4月セミナー」を1シナリオに統合して条件分岐で出し分け、を始めるとメンテ不能。**シナリオはコピーして増やす**。前月のシナリオをコピー → メッセージ差し替え → 別シナリオで登録。古いシナリオは `is_active=false` で残す(進行中の友だちを止めないため)。

### 3つのトリガータイプの使い分け

| トリガー | 使うべきシーン | 注意点 |
|---|---|---|
| `friend_add` | 全新規友だち向けの**汎用ウェルカム**(1本だけ) | キャンペーン別ウェルカムに使うと混ざる |
| `tag_added` | キャンペーン別フォローアップ、診断結果別の分岐 | `trigger_tag_id` を必ず指定 |
| `manual` | 営業手動エンロール、Webhook 経由のカスタム連携 | enroll API を呼ぶ責任が呼び出し側 |

**`friend_add` は1アカウントに1本**。複数走らせると配信が衝突して友だちが混乱する。キャンペーン別に出し分けたいなら、`friend_add` は「ようこそ」だけにして、IF-THEN オートメーションでタグ付与 → `tag_added` シナリオに繋ぐ二段構えが綺麗。

### 即時配信とジッター

Harness は `delay_minutes=0` の最初のステップを、**特定の経路でのみ Cron を待たず即時配信** する。即時 push が走るのは:

- `/r/:ref` クリック経由で `applyRefAttribution` が tracked_link の scenario を引き当てたとき (LIFF callback / LIFF link)
- リッチメニュー postback などで明示的にステップ 0 を push する経路

**`enrollFriendInScenario()` を直接呼ぶ汎用経路** (form の `onSubmitScenarioId` / 手動 enroll API / `tag_added` トリガー等) は `next_delivery_at` を書き込むだけで、次の Cron (5分間隔) を待つ。フォーム submit 直後の reward を「秒で」届けたい場合は経路を意識する。

**Cron 駆動の遅延ステップは ±5 分のジッター**が入る (`step-delivery.ts` の `jitterDeliveryTime()`)。LINE 配信のBAN対策で、毎日 9:00:00 ジャストに数千通出るとスパム検知に引っかかるリスクを潰すため。運用者は気にする必要ないが「9:00きっかりに届くと思ったのに 9:03 に届いた」と言われた時に説明できるように知っておく。即時 push (上記の経路) は `webhook.ts` / `liff.ts` から直接スケジュールされるためこのジッターは適用されない。

### 条件分岐の典型パターン

最もよく使うのが「行動した人とそうでない人の分岐」。

```bash
# 概念例: セミナー前リマインドシナリオ
# Step 1 (delay 0)    : セミナー3日前 → 「予習資料はこちら」(LP リンク)
# Step 2 (delay 1d)   : 条件: tag_exists "clicked_lp"
#                       true  → Step 3 (詳細解説)
#                       false → next_step_on_false=4 (再リマインド)
# Step 3 (delay 0)    : 「資料見てくれた人向け追加情報」
# Step 4 (delay 0)    : 「まだ見てない方へ - 5分で読めます」
# Step 5 (delay 1d)   : セミナー前日リマインド (全員共通)
```

Step 1 のリンクはトラッキングリンクで `tagId=<tag_id_clicked_lp>` を仕込んでおく。これだけで Step 2 の分岐が機能する。**LP踏んだら自動でタグ → タグの有無で次の配信が変わる**、この連鎖がHarnessの最も気持ちいい部分。

### ステップ間の delay 設計

| 間隔 | 用途 |
|---|---|
| 即時 (`0m`) | フォーム送信 reward、行動への反応 |
| 1時間 (`60m`) | ウェルカム後の追い |
| 1日 (`1d`) | 教育コンテンツの連投 |
| 3日 (`3d`) | リマインド、温度感の再確認 |
| 1週間 (`1w`) | 中期フォロー、休眠予防 |

**毎日連投は基本ブロックされる**。教育コンテンツでも「1日空ける」が最低ライン、できれば「1日 → 1日 → 2日 → 3日 → 5日」のような疎密で組む。L社・U社で「毎日配信して50%ブロックされた」はだいたいこれが原因。

---

## 4.6 CV計測と効果測定 — `/api/conversions/*` 設計、ABテスト、レポーティング

### CVは1キャンペーンに1つだけ

「フォーム送信もCV、決済もCV、来場もCV」は計測の自殺。**1キャンペーンに対しCVは1つ**に決める。

| キャンペーン目的 | CVの定義 | conversion_point.eventType |
|---|---|---|
| メルマガリスト構築 | フォーム送信 | `form_submit` |
| セミナー集客 | 申込フォーム送信 | `seminar_apply` |
| 商品販売 | 決済完了 (Stripe webhook) | `purchase` |
| オフラインイベント | 当日来場(QRスキャン) | `offline_attend` |

複数指標を見たければ「CVポイントを複数作る」、それぞれ独立CVRで測る。ファネル全体は CV ポイント A→B→C を順に並べてレポーティング側で繋ぐ。

### `/api/conversions/track` への送信タイミング

CV発火タイミングはキャンペーンの種類で全く違う。

```typescript
// 例1: フォーム送信をCVにする (best-effort, Worker 内部で発火させる)
// → on_submit_scenario_id 経由ではなく、明示的に track API を叩くのが望ましい
await fetch(`${apiBase}/api/conversions/track`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    conversionPointId: '<cv_point_id_form_submit>',
    friendId: '<friend_id>',
    metadata: {
      formId: '<form_id>',
      trackedLinkId: '<tracked_link_id>'  // first-touch の tracked_link id を一緒に焼き込む
    }
  })
})

// 例2: Stripe 決済完了は webhook 経由で自動 (Stripe metadata.line_friend_id が必要)
// → wiki/17-CV-Tracking-and-Affiliates.md の Stripe 連携節を参照
```

**`metadata` に first-touch の `trackedLinkId` を毎回入れる**のがコツ。これがないと、CVテーブル単体で「どのキャンペーンのCVか」を復元できず、毎回 `friends.first_tracked_link_id` を JOIN するハメになる。CV 1件 JSON 1個のコストで自己完結する設計に。

### ABテストの最小構成

A/B 比較のために必要なものは厳密には3つだけ。

1. **トラッキングリンク2本** (`name=...-a`, `name=...-b`)
2. **CVポイント1つ** (両者で共通)
3. **集計クエリ1本**

```sql
-- A/B のCVR比較 (概念SQL)
SELECT
  tl.name AS variant,
  COUNT(DISTINCT lc.friend_id) AS unique_clickers,
  COUNT(DISTINCT ce.friend_id) AS converters,
  ROUND(100.0 * COUNT(DISTINCT ce.friend_id) / NULLIF(COUNT(DISTINCT lc.friend_id), 0), 2) AS cvr_pct
FROM tracked_links tl
LEFT JOIN link_clicks lc ON lc.tracked_link_id = tl.id
LEFT JOIN conversion_events ce
  ON ce.friend_id = lc.friend_id
  AND ce.conversion_point_id = '<cv_point_id>'
  AND ce.created_at > lc.clicked_at
WHERE tl.name LIKE '2026-04-seminar-%'
GROUP BY tl.name;
```

注意: A・Bのクリッカー集合に重複(両方踏んだ人)が出る場合は first_tracked_link_id ベースで分離する方が綺麗。実務では「クリック後14日以内」など窓を切って計測することが多い。

### レポートを「自分で出す」習慣

`/api/conversions/report` で集計は取れるが、本気で運用するなら**週次でSQLを書いて自分で出す**。マネージド集計画面に頼ると後で「あの時の数字が再現できない」事故が起きる。

- 週次: トラッキングリンク別 unique_clickers / converters / cvr / 平均 first→cv 経過日数
- 月次: 流入元別 (`src:ig` / `src:x` / `src:offline`) LTV(7日/30日/90日)
- キャンペーン終了時: そのキャンペーンの CV を ref で絞った clicks_to_cv 漏斗

これらは全部 Harness の D1 から SQL 一本で出る。Harnessを「配信ツール」と捉える限り真価の3割しか引き出せない。**「測定基盤」として捉え直す**と、L社・U社では書けないクエリで意思決定が速くなる。

### 落とし穴: CVを変えるな

最後に最大の運用事故を1つ。**運用しながらCVの定義を変えない**。「先月は申込CV、今月は決済CV」をやると過去比較が全部死ぬ。CVを増やしたいなら**新しいCVポイントを追加**する。古いものはそのまま残す。CV 1つあたりのDBコストはほぼゼロ — **消すな、足せ**。

---

## 章のまとめにかえて

1キャンペーンを設計する時に必要な5つの判断を扱った。

1. トラッキングリンクをいつ・何本発行するか(4.2)
2. ref_code をどこから受け渡すか(4.3)
3. 診断フォームで何を聞き、どのタグ・メタデータに落とすか(4.4)
4. どのトリガーで・どの delay でステップ配信を組むか(4.5)
5. CV を何にし、何をメタデータに焼き込み、どんなレポートで見るか(4.6)

この5つを**キャンペーン開始前に紙1枚で書ききる**。書ききれないキャンペーンは走らせても測定できないので走らせない。これが「測れない配信は打たない」の運用への翻訳だ。

第5章では、設計したキャンペーンを継続運用するための週次フロー(ABテスト回し方、BAN対策、配信ガバナンス)に進む。
