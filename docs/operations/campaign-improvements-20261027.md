# X-43〜X-48 適用記録（2026-10-27）

対象: X Harness `b70655f` と L Harness `c5a14f5` を基準にした独立作業ブランチ `codex/campaign-improvements-20261027`。制御プレーン、本番DB、本番テナントには変更していない。

X側と共有する適用記録。LINE側のソース変更は運営者通知、表示、同意、配信下書きに限定する。

## 実装

| ID | 内容 | 既定・制限 |
|---|---|---|
| X-43 | D1共通集計、終了時/週次の3行通知、任意Grokと数値検証、Slack暗号化、LINE管理者、メール、再送、テストAPI、MCP参照 | 通知チャネルは空配列。未対応LINEには新イベントを送らず保留。 |
| X-44 | 共通入力検証、保存しない下書きAPI、1回の再生成、欄別フォールバック、フォーム選択反映、MCP | 作成者が確認して従来の作成ボタンを押す。Xへ自動投稿しない。 |
| X-45 | 公開残数/参加人数、20秒サーバーキャッシュ、LIFF/Flex表示、全特典残数の確定時文面、テンプレート、中間ページ | 参加人数は10未満を隠す。中間ページはOFF、既存302を維持。 |
| X-46 | 同意内容別のフォロー、専用クーポン割り当て、同意タグ、先行案内見込みとLINE配信下書き | 既定OFF。クーポンのみの同意を先行案内に転用しない。reply失効時にpushへ切り替えない。 |
| X-47a | 月末推定、企画別内訳、見積API、70%/90%の自動減速、予算通知 | cron/DOの自動実行も間隔を守る。本人の明示再確認は既存10秒クールダウン。請求上限は保証しない。 |
| X-47b | アカウントDO/DBロック、512文字単位の分割、共有カーソル、追加ゲートの追いつき、ゲート別照合/確定 | `claim_batch_search` は既定OFF。実課金・性能比較後に有効化する。 |
| X-48 | 条件ポリシー、有限在庫の候補窓、繰り上げ、在庫切れ後の無課金確定、1poll1回のいいね取得、お願い表示 | 標準の条件確認は明示オプトイン。無制限/抽選は全員確認。 |

## 指示書から補正した点

- SQLiteのUNIQUEはNULL同士を重複とみなさない。アカウント全体の予算通知には `COALESCE(gate_id,'')` と接続IDを含む一意インデックスを追加した。
- 既存 `gate_allocations` は参加者を主キーとし、確定後の追加割り当てを禁止している。通常参加賞を保持するため、オプトイン専用の `gate_followup_allocations` と原子的な在庫/個別コードトリガーを追加した。既存の当選割り当てを置換しない。
- 作成前にはサーバー採番のreward IDがないため、`couponRewardIndex` を受け付け、保存時に同じゲートのreward IDへ解決する。選択した特典は通常の参加賞から除外する。simpleでは別途、無制限の参加特典が必須。
- rankは確定順。抽選を「N番目の参加」とは表示せず「確定 #N」とした。
- クーポン希望は次回案内への同意ではない。`offer` を同意イベントに記録し、early_notice/bothだけを次回配信対象にする。ボタンのカスタム文言に関わらず同意の説明を表示する。
- いいね一覧に次ページが残る場合も確認不能と扱う。上限100件の他、部分ページを誤って「未いいね」と断定しない。
- 文字数判定は公式 `twitter-text` 3.1.0を使用（Apache-2.0、ライセンスを同梱）。日本語・URL・複合絵文字の独自近似を避けた。
- 共通集計は安全なゲート属性のみを返す。旧ゲートの認証情報を集計/AI入力に混ぜない。
- 週次はゲートごとに所有LINE接続を保って生成する。LINEで受け取る場合の通数は対象ゲート数と管理者数に依存する。
- メールは宛先ごとに受付状況を記録する。受付結果が不明な宛先は自動再送せず `email_delivery_uncertain` として確認を求める。Slackのタイムアウト再送は受信側の厳密な重複排除を保証しない。
- 下書きはキャンペーンを保存しない。Grok利用時の既存ai_runs、予算ロック、支出台帳は予算管理のため維持する。

## 設定

Xの設定画面に「結果の通知」を追加。Slack URLは書き込み専用で、ENCRYPTION_KEY（base64の32バイト鍵）で暗号化。`GET /api/settings` は `(set)` のみを返す。

- `digest_channels`: `[]`、またはline/slack/emailの部分集合をJSON文字列で設定。
- `digest_weekly_enabled`: `false`/`true`。
- `digest_email_to`: カンマ区切り、最大5件。
- メール: 任意の `DIGEST_EMAIL` send_email bindingと `DIGEST_EMAIL_FROM` が必要。既存の設定には追加していない。未設定ならskip。
- LINE管理者: LINE側の所有者/管理者が `PUT /api/x-campaign-notifications/:accountId` に `{"friendIds":["同じアカウントの管理者friend ID"]}` を設定（最大5人）。X側に宛先指定権限はない。未設定/配信可能な管理者なしなら2xx/skipped。
- LINEの今月残り通数は既存のアカウント概要（quota/consumption）を利用。推定push件数とは区別する。
- `claim_batch_search`: API設定で明示的にtrueにした場合だけ検索集約。通常の設定画面では自動で有効化しない。

通知テストは管理者限定、ゲート×チャネルごとに10分に1回。UIで保存済みの宛先を確認して実行する。MCPには送信ツールを追加していない。

## DB・リリース

X: 021と022をupgrade/bootstrapに同内容で追加。schema.sqlも全bootstrapと同じ現行スキーマへ更新し、表/列/トリガーの一致を自動検証する。既存データを削除するmigrationはない。

LINE: 073と既存account_settings/broadcastsを使用。追加migrationなし。新イベントはHMAC署名、接続/アカウント照合、受信IDの冪等制御を通る。すべてのLINEメッセージは既存のHarnessプロキシ経路を使用する。

版番号はレビュー用にX v0.9.0 / LINE v0.26.0を準備した。XのMCP/SDKはchangesetを追加し、npm公開・バージョン適用は未実行。元の計画どおり段階リリースする場合、v0.8.0とv0.9.0のchangeset/PRを分け、MCP 0.5.0→0.6.0を順に作る必要がある。

依頼文で先行指定された **X-36b-v0.7.0.mdの残り3点は原文未確認**。追加で共有されたENGAGEMENT-GATE v2.1は参照したが、X-36bの3点そのものではない。公開前にX-36b/v0.7.1と中間版v0.8.0のリリース順を確認する。準備版を公開済みとは扱わない。

本番migration適用、Cloudflareデプロイ、GitHubへのpush/PR/タグ、npm公開、実メッセージ送信は実施していない。

## 検証

合成データのSQLite/D1、モックAPI、両リポジトリの実HTTPルート、ローカルworkerdを使用。ブラウザ擬似操作は使用していない。

- X: `pnpm release:check`（version/lint/typecheck/test/migration/assets/build/built-version/production audit）
- X: `LINE_GATE_REPO=<LINE作業コピー> pnpm exec vitest run --config vitest.cross.config.ts`
- X: `node scripts/smoke-gates.mjs`（ローカルD1移行、公開status、PNG、署名claim、DO、原子的在庫）
- X: Worker `wrangler deploy --dry-run`
- LINE: Worker typecheck、x-gates/x-gate-challengeテスト、packages build、Worker/LIFF build

最終結果（2026-10-27）:

- X: 20ファイル・224テスト成功。lint/typecheck、migration/schema一致、assets、Web/SDK/MCP build、配信版照合成功。production auditは既知の脆弱性0件。
- LINE: Worker型チェック、136ファイル・1,676テスト成功。新設APIをOpenAPIにも登録済み。packagesとWorker/LIFFのビルド成功。
- 両repo HTTP契約: 1テスト成功（参加→結果通知→運営者ダイジェスト、二重通知なし）。
- ローカルworkerd: D1 bootstrap（000 baseline・019〜022）、公開status、1200×630 PNG、HMAC claim、DO、在庫トランザクション成功。
- X Workerのdry-run成功。公開や本番へのアップロードはなし。

実X課金API、実Grok、実Slack/Email/LINE配信、実OAuth/Turnstile、iOS/Androidは未検証。メール宛先制約・課金は実運用環境の設定も確認する。

## 一次資料

- Xの文字数: https://docs.x.com/fundamentals/counting-characters
- X検索クエリ上限（Self-serve recentは512）: https://docs.x.com/x-api/posts/search/integrate/build-a-query
- いいねの取得上限100: https://github.com/xdevplatform/docs/blob/main/x-api/posts/likes/introduction.mdx
- LINE replyの通数: https://developers.line.biz/en/faq/
- LINE reply token: https://developers.line.biz/en/reference/messaging-api/nojs/
- Cloudflare send_email: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- Cloudflare宛先設定: https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/

2026-10-27に参照。単価は既存UNIT_PRICESを変更していない。

## 公開依頼後の更新

2026-10-27、本人から公開・アップデートとUI改善の指示を受領。X-36b本文を受領し、v0.7.1（PR #52）で先行公開。この修正をv0.9.0へ統合。機能分はX v0.9.0 / LINE v0.26.0として一括公開する。上の「未公開」「原文未確認」は初回実装時点の履歴であり、現在の保留事項ではない。更新モーダル、作成手順、名前による企画・通知先選択を追加。Cloudへの反映記録は制御プレーン側に保存する。

Cloud実機試験でfetchのredirect:error非対応と、Worker間のHTTP接続に必要なglobal_fetch_strictly_publicを確認。manualで転送を追わず非2xxを拒否し、X/LINEと共通ディスパッチャーに互換設定を反映した。隔離環境で企画作成→署名claim→特典→status/OGP/秘密のマスクを確認。実SNS送信は行っていない。
