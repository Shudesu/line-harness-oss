# 公開PR・Issueの確認対象一覧

2026-10-25時点の公開PR39件・Issue41件を一次分類した一覧です。全件の再現や採用が済んだという意味ではありません。Issueと対応PRは同じ作業として扱います。

状態に進展があった案件は[対応状況](project-status.md)と元のスレッドで共有します。保留は実装日の確約や、既存の約束の撤回を意味しません。

## 安全性を優先確認

- [PR #403](https://github.com/Shudesu/line-harness-oss/pull/403) fix(broadcast): respect edits and reschedules before starting delivery — 適応版を検証済み・公開/本番は未反映
- [PR #401](https://github.com/Shudesu/line-harness-oss/pull/401) fix(broadcast): persist exact queued requests for safe acceptance recovery — Draft・移行条件の確認
- [PR #400](https://github.com/Shudesu/line-harness-oss/pull/400) fix(reminders): preserve delivery intent across edits and retries — 一次分類・詳細確認前
- [PR #399](https://github.com/Shudesu/line-harness-oss/pull/399) fix(insights): retain recorded accounts and refreshed credentials — 一次分類・詳細確認前
- [PR #398](https://github.com/Shudesu/line-harness-oss/pull/398) fix(mileage): fence queue results by the claimed attempt — 一次分類・詳細確認前
- [PR #397](https://github.com/Shudesu/line-harness-oss/pull/397) fix(mileage): keep referral grants unique across identity linking — 一次分類・詳細確認前
- [PR #396](https://github.com/Shudesu/line-harness-oss/pull/396) fix(scenarios): recheck campaign and enrollment state before delivery — 一次分類・詳細確認前
- [PR #362](https://github.com/Shudesu/line-harness-oss/pull/362) fix(tracked-links): don't borrow the global LIFF for accounts without liff_id — 一次分類・詳細確認前
- [PR #318](https://github.com/Shudesu/line-harness-oss/pull/318) security: protect incoming LINE evidence media — 一次分類・詳細確認前
- [PR #306](https://github.com/Shudesu/line-harness-oss/pull/306) fix(scenarios): never enroll or push a scenario across LINE accounts — 一次分類・詳細確認前
- [PR #239](https://github.com/Shudesu/line-harness-oss/pull/239) feat: operator chat user search + POST /api/push, and two security fixes — 一次分類・詳細確認前
- [PR #229](https://github.com/Shudesu/line-harness-oss/pull/229) feat(runtime): persist LINE provider receipts for durable send readback — 一次分類・詳細確認前
- [Issue #380](https://github.com/Shudesu/line-harness-oss/issues/380) Stall recovery restarts a plain multicast from offset 0 when `{{name}}` is mistyped (e.g. `{ {name}}`) — 一次分類・詳細確認前
- [Issue #377](https://github.com/Shudesu/line-harness-oss/issues/377) Worker 自動デプロイでビルド出力の仮の値（R2・vars・キャッシュ）が本番に載る — 一次分類・詳細確認前
- [Issue #371](https://github.com/Shudesu/line-harness-oss/issues/371) 予約配信が status='sending' のまま永久に固着し、送信0件のまま失われる（tag/all 経路に復旧手段がない） — 一次分類・詳細確認前
- [Issue #259](https://github.com/Shudesu/line-harness-oss/issues/259) Broadcast send silently falls back to `env.LINE_CHANNEL_ACCESS_TOKEN` when `line_account_id` is unset, and the create response never reflects the persisted value — 一次分類・詳細確認前
- [Issue #64](https://github.com/Shudesu/line-harness-oss/issues/64) 安全性: 配信セーフガード・誤送信防止 — 一次分類・詳細確認前

## 導入・更新の不具合

- [Issue #359](https://github.com/Shudesu/line-harness-oss/issues/359) Bug: pages project create の失敗が握りつぶされ「準備完了」と表示される（次のデプロイで対話待ちになる） — 一次分類・詳細確認前
- [Issue #358](https://github.com/Shudesu/line-harness-oss/issues/358) Bug: applySqlFile の文単位フォールバックで、先頭コメント付きの SQL が wrangler の引数として解釈される — 修正候補を検証済み・公開/配布は未反映（[検証結果](https://github.com/Shudesu/line-harness-oss/issues/358#issuecomment-6397816202)）
- [Issue #353](https://github.com/Shudesu/line-harness-oss/issues/353) Bug: Admin UI setup deploy lands on Cloudflare Pages Preview, not Production (detached HEAD branch name) — 一次分類・詳細確認前
- [Issue #352](https://github.com/Shudesu/line-harness-oss/issues/352) Bug: failed R2 bucket creation is reported as success and marked done in setup state — 一次分類・詳細確認前
- [Issue #351](https://github.com/Shudesu/line-harness-oss/issues/351) Bug: multi-line SQL in database.ts breaks `wrangler d1 execute --command` on Windows — 修正候補を検証済み・公開/配布は未反映（[検証結果](https://github.com/Shudesu/line-harness-oss/issues/351#issuecomment-6397815972)）
- [Issue #325](https://github.com/Shudesu/line-harness-oss/issues/325) create-line-harness: セットアップの案内文が実画面と合っていない箇所（R2 有効化 / Messaging API 有効化 / 友だち追加オプション） — 一次分類・詳細確認前
- [Issue #324](https://github.com/Shudesu/line-harness-oss/issues/324) create-line-harness: R2 有効化と cron 空き本数を事前チェックしないため、リソース作成後に失敗する — 一次分類・詳細確認前
- [Issue #281](https://github.com/Shudesu/line-harness-oss/issues/281) update: adoption path (unstamped/v0.0.0-dev) validates full migration history and always fails on historical destructive migrations (#027, #029), even when checksums are correctly recorded — 一次分類・詳細確認前
- [Issue #232](https://github.com/Shudesu/line-harness-oss/issues/232) Bug: API TOKENが作られない — 一次分類・詳細確認前
- [Issue #209](https://github.com/Shudesu/line-harness-oss/issues/209) update: Worker deploy fails with 10021 'invalid or missing text property for binding WORKER_URL' (secret bindings not preserved via inherit) — 一次分類・詳細確認前

## 通常の不具合・保守

- [PR #389](https://github.com/Shudesu/line-harness-oss/pull/389) fix(web): ダイアログの余白と、スマホでの左右の余白を直す — 修正候補を検証済み・公開/配布は未反映（[検証結果](https://github.com/Shudesu/line-harness-oss/pull/389#issuecomment-6397811181)）
- [PR #386](https://github.com/Shudesu/line-harness-oss/pull/386) fix: 同時刻に記録されたメッセージがチャット履歴で逆順に表示される — 一次分類・詳細確認前
- [PR #370](https://github.com/Shudesu/line-harness-oss/pull/370) fix: 公開画像のGET・HEADをAPI共通レート制限から除外 — 修正候補を検証済み・公開/配布は未反映（[検証結果](https://github.com/Shudesu/line-harness-oss/pull/370#issuecomment-6397811529)）
- [PR #356](https://github.com/Shudesu/line-harness-oss/pull/356) fix(webinar): 相談枠の案内文を「15分」固定から予約メニューの所要時間に合わせる — 一次分類・詳細確認前
- [PR #317](https://github.com/Shudesu/line-harness-oss/pull/317) fix(forms): allow webhook notifications without LINE replies — 一次分類・詳細確認前
- [PR #261](https://github.com/Shudesu/line-harness-oss/pull/261) fix(liff): upsert friend in /api/liff/link to survive the follow-webhook race — 一次分類・詳細確認前
- [PR #253](https://github.com/Shudesu/line-harness-oss/pull/253) fix(mcp): stop flagging the expected friend-count gap as broken sync — 一次分類・詳細確認前
- [PR #236](https://github.com/Shudesu/line-harness-oss/pull/236) fix(db): messages_log の delivery_type CHECK に 'test' を追加(レガシーDBのテスト配信ログ失敗の修正) — 一次分類・詳細確認前
- [PR #224](https://github.com/Shudesu/line-harness-oss/pull/224) fix(worker): scenario step の到達タグ付与で tag_change イベントを発火する — 一次分類・詳細確認前
- [Issue #388](https://github.com/Shudesu/line-harness-oss/issues/388) Bug: 管理画面のダイアログの余白が無い・スマホで画面の左右に接する — 修正候補を検証済み・公開/配布は未反映（[検証結果](https://github.com/Shudesu/line-harness-oss/issues/388#issuecomment-6397811352)）
- [Issue #369](https://github.com/Shudesu/line-harness-oss/issues/369) 公開画像のGET・HEADにもAPI共通レート制限が適用される — 修正候補を検証済み・公開/配布は未反映（[検証結果](https://github.com/Shudesu/line-harness-oss/issues/369#issuecomment-6397815774)）
- [Issue #233](https://github.com/Shudesu/line-harness-oss/issues/233) テスト配信のログ書き込みがレガシーDBで CHECK constraint failed になる(migration 026 の前提誤り) — 一次分類・詳細確認前
- [Issue #185](https://github.com/Shudesu/line-harness-oss/issues/185) [Bug] manage_tracked_links (action=list) always returns empty array — 一次分類・詳細確認前
- [Issue #119](https://github.com/Shudesu/line-harness-oss/issues/119) Outgoing Webhook が message.received で発火しない — 一次分類・詳細確認前
- [Issue #96](https://github.com/Shudesu/line-harness-oss/issues/96) Chat: no visual indicator for new incoming messages — 一次分類・詳細確認前
- [Issue #82](https://github.com/Shudesu/line-harness-oss/issues/82) 管理画面でシナリオが表示されない（401 Unauthorized） — 一次分類・詳細確認前

## 新機能・採用範囲の確認

- [PR #393](https://github.com/Shudesu/line-harness-oss/pull/393) feat(plugins): PayPay継続課金と配送復旧を追加 — 採用範囲・依存条件の確認前
- [PR #392](https://github.com/Shudesu/line-harness-oss/pull/392) feat(plugins): LINE本人確認付きStripe定期便販売を追加 — 採用範囲・依存条件の確認前
- [PR #391](https://github.com/Shudesu/line-harness-oss/pull/391) feat(plugins): 汎用の定期便配送管理プラグインを追加 — 採用範囲・依存条件の確認前
- [PR #385](https://github.com/Shudesu/line-harness-oss/pull/385) feat(groups): LINEグループのタグ分けとグループ単位のタスク管理 — 採用範囲・依存条件の確認前
- [PR #372](https://github.com/Shudesu/line-harness-oss/pull/372) feat(liff): persist ad click IDs (fbclid) + UA/IP on /api/liff/link for Meta CAPI — 採用範囲・依存条件の確認前
- [PR #365](https://github.com/Shudesu/line-harness-oss/pull/365) feat: 案内ページの文言を管理画面から設定可能にする — 採用範囲・依存条件の確認前
- [PR #364](https://github.com/Shudesu/line-harness-oss/pull/364) refactor(worker): 案内ページHTMLの描画を共通化 — 採用範囲・依存条件の確認前
- [PR #321](https://github.com/Shudesu/line-harness-oss/pull/321) feat(booking): 指名なし予約を空いている実スタッフへ自動割当する — 採用範囲・依存条件の確認前
- [PR #320](https://github.com/Shudesu/line-harness-oss/pull/320) feat(booking): 予約リクエストをスタッフの LINE へ通知する — 採用範囲・依存条件の確認前
- [PR #319](https://github.com/Shudesu/line-harness-oss/pull/319) feat(booking): 予約不可時間 (休憩・外出) を空き枠から除外する — 採用範囲・依存条件の確認前
- [PR #267](https://github.com/Shudesu/line-harness-oss/pull/267) feat(sender): per-message icon and display name for operator replies — 採用範囲・依存条件の確認前
- [PR #248](https://github.com/Shudesu/line-harness-oss/pull/248) feat(broadcasts): send LINE imagemap (rich message) from image broadcasts — 採用範囲・依存条件の確認前
- [PR #228](https://github.com/Shudesu/line-harness-oss/pull/228) Add Shuuka link integration support — 採用範囲・依存条件の確認前
- [PR #223](https://github.com/Shudesu/line-harness-oss/pull/223) トラッキングリンクに時限失効機能を追加（絶対期限＋友だち別相対期限） — 採用範囲・依存条件の確認前
- [PR #214](https://github.com/Shudesu/line-harness-oss/pull/214) Add opt-in LLM fallback reply for free-text messages — 採用範囲・依存条件の確認前
- [Issue #387](https://github.com/Shudesu/line-harness-oss/issues/387) Feature: 個別チャットの返信欄から、登録済みのテンプレートを挿入できるようにしたい — 採用範囲・依存条件の確認前
- [Issue #382](https://github.com/Shudesu/line-harness-oss/issues/382) Feature: 友だち追加時シナリオを、再フォロー（ブロック解除）では始めない設定 — 採用範囲・依存条件の確認前
- [Issue #381](https://github.com/Shudesu/line-harness-oss/issues/381) Feature: 管理画面の左メニューを、役割ごとに表示／非表示できるようにしたい — 採用範囲・依存条件の確認前
- [Issue #379](https://github.com/Shudesu/line-harness-oss/issues/379) Feature: [RFC-0001] LineHarness Plugin Platform v1 — 管理・権限・非同期フック・審査・更新の実装計画 — 採用範囲・依存条件の確認前
- [Issue #378](https://github.com/Shudesu/line-harness-oss/issues/378) [Plugin] LineHarness Form Theme Studio v0.1.0 — 採用範囲・依存条件の確認前
- [Issue #363](https://github.com/Shudesu/line-harness-oss/issues/363) Feature: 案内ページ（/r, /o, /auth/line）の固定文言を運営者が変更できるようにしたい — 採用範囲・依存条件の確認前
- [Issue #357](https://github.com/Shudesu/line-harness-oss/issues/357) [Plugin] 来店実績同期 (visit-sync) 0.1.0 — 採用範囲・依存条件の確認前
- [Issue #329](https://github.com/Shudesu/line-harness-oss/issues/329) feat: GET /api/friends で LINE user ID の完全一致検索を追加する — 採用範囲・依存条件の確認前
- [Issue #218](https://github.com/Shudesu/line-harness-oss/issues/218) feat: 友だち選択配信（friend_ids セグメント）（idea from PR #98） — 採用範囲・依存条件の確認前
- [Issue #217](https://github.com/Shudesu/line-harness-oss/issues/217) feat: 承認制グループ転送機能（idea from PR #152） — 採用範囲・依存条件の確認前
- [Issue #170](https://github.com/Shudesu/line-harness-oss/issues/170) Feature: コンバージョンレポートに軸（タグ/流入/スコア帯）を追加してクロス集計 — 採用範囲・依存条件の確認前
- [Issue #169](https://github.com/Shudesu/line-harness-oss/issues/169) Feature: 友だち＋タグ＋スコアの CSV エクスポート — 採用範囲・依存条件の確認前
- [Issue #127](https://github.com/Shudesu/line-harness-oss/issues/127) [Feature Request] 友だちレコードの削除機能（管理画面・API） — 採用範囲・依存条件の確認前
- [Issue #117](https://github.com/Shudesu/line-harness-oss/issues/117) 個別チャット画面に表示するユーザーMeta情報とタグを選択可能にしてほしい — 採用範囲・依存条件の確認前
- [Issue #60](https://github.com/Shudesu/line-harness-oss/issues/60) 配信: 配信機能の強化 — 採用範囲・依存条件の確認前
- [Issue #63](https://github.com/Shudesu/line-harness-oss/issues/63) ブランディング: ホワイトラベル対応 — 採用範囲・依存条件の確認前
- [Issue #61](https://github.com/Shudesu/line-harness-oss/issues/61) 分析: CTR計測・配信レポート — 採用範囲・依存条件の確認前

## 反映状況・重複候補の照合

- [PR #395](https://github.com/Shudesu/line-harness-oss/pull/395) fix(broadcast): reject stale queue snapshots when claiming a batch — 検証済み・公開反映準備
- [PR #394](https://github.com/Shudesu/line-harness-oss/pull/394) fix(line-sdk): verify retry acceptance and retain original send ID — 検証済み・公開反映準備
- [PR #354](https://github.com/Shudesu/line-harness-oss/pull/354) chore: prepare v0.24.2 broadcast safety release — 一次分類・詳細確認前

## 情報確認

- [Issue #366](https://github.com/Shudesu/line-harness-oss/issues/366) 新規LINEログインチャネルにChannel Secretが表示されず、LINE_LOGIN_CHANNEL_SECRETを設定できない — 一次分類・詳細確認前
- [Issue #118](https://github.com/Shudesu/line-harness-oss/issues/118) iOS アプリ (the-harness-ios) の入手方法・配布形態を教えてください — 一次分類・詳細確認前
