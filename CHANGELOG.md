# Changelog

## v0.23.2 (2026-09-02)

### D1ヘルスログのrows_read超過

- v0.23.1で追加した最新ヘルス状態の参照が、履歴の多い環境で
  `account_health_logs`を広く読み取る問題を修正
- `(line_account_id, created_at DESC)`の複合インデックスと既存環境向け
  migration 072を追加。古いヘルス履歴を削除せずに更新可能
- sandbox D1の10,000件履歴で、最新1件クエリのrows_readが20,000から1へ
  減ることを確認

### その他の修正

- リッチメニュー切替postbackをシステム通知としてチャット履歴へ表示
- L Harnessのfaviconを追加

## v0.23.1 (2026-08-27)

### 管理画面ログイン 405（v0.23.0 回帰）

- 公式bundleから更新した通常版の管理画面が、Worker APIではなくCloudflare Pages自身へ
  `POST /api/auth/login`を送り、405でログインできなくなる問題を修正
- 通常版の`worker-origin`とCloud共有ビルドの`same-origin`を明示的に分離し、
  URLプレースホルダーの置換結果から構成を推測しないよう変更
- v0.23.0の二重置換、通常版の未置換設定、Cloud版の同一オリジン設定に回帰テストを追加

### その他の修正

- 5分cronのみの環境でも5分ごとの定期処理が確実に動作するよう修正
- ヘルスチェックの不要な毎分ログ書き込みを停止
- 管理画面のチャット入力欄のはみ出しとFlexメッセージのプレビュー崩れを修正

## Brand name update (2026-08-19)

- Public product display name changed from the former name to **L Harness**.
- Repository URLs, npm package names, CLI commands, and internal identifiers
  remain unchanged for backward compatibility.
- Added [BRAND.md](BRAND.md) with naming and third-party trademark policy.

## v0.21.3 (2026-08-15)

### Worker Assetsアップロードの修正（2026-08-16）

- Cloudflare Workers Assets APIへ送るmanifestキーを必須の`/`始まりへ修正
- migration完了後、Assets upload session作成時にHTTP 400（code 10304）で停止する問題を解消
- 修正版CLI `create-line-harness@0.2.8` / update engine `0.0.10`を公開
- Cloudflare Pagesのasset keyをWrangler互換BLAKE3へ修正し、deploy成功後に全パスHTTP 500となる問題を解消
- Adminのみを安全に再同期する修正版CLI `create-line-harness@0.2.9` / update engine `0.0.11`を公開

### 安全なアップデート経路

- Worker本体と `apps/worker/dist/client` のWorker Assetsを同じリリースbundleに同梱し、一体で更新
- v0.14.1〜v0.21.2のDBを、037以降の累積マイグレーションで直接最新版へ収束
- マイグレーションをSQL文単位で適用し、途中適用されたファイルも未適用文だけ継続
- 適用済みファイルのチェックサム台帳を追加し、再実行時のDML重複を防止
- 破壊的DDLを更新開始前に拒否
- Worker Versionを保存し、失敗時にコード・bindings・Assetsをまとめてロールバック
- CLIの途中失敗後は、同じupdateコマンドの再実行でWorker・Admin・LIFFを再同期
- 旧形式の `?page=webinar&slug=...` をLIFF Pagesのウェビナー画面へ転送

### 更新方法

Worker Assets対応前のバージョンでは、管理画面内の更新ボタンではなく次を実行してください。

```bash
npx create-line-harness@latest update
```

## v0.21.0 (2026-08-14)

### ライブCTAから個別相談を即時確定

- オートウェビナーのフォーム送信後、その画面のまま空き枠を選び、個別相談を即時確定
- L Harnessの受付時間、日付別枠、既存予約、Google Calendarの予定、60分のリードタイムを反映し、確定直前にも二重予約を検査
- Google Meet付き予定、`meet_consultations`、前日・1時間前のLINEリマインド、確定通知を一括作成
- 管理画面からGoogleアカウント本人が許可するOAuth接続を追加。サービスアカウントキーとカレンダー共有は不要
- OAuth権限は `calendar.events` と `calendar.events.freebusy` の2つだけに限定
- 設定とエラー解決を `docs/wiki/28-Google-Calendar-and-Webinar-Booking.md` に追加

### その他

- シナリオ・自動応答の友だち別送信でも `{{liff_id}}` を配信アカウントへ追従
- 「マイル」キーワードで、ユーザー本人のマイルページをreply messageで返信
- メディア問い合わせをD1へ保存し、通知成否を記録
- 即時ステップ配信がcronと同じ条件判定を行うよう修正
- チャット一覧のプレビュー・並び順・ページングを、プロキシ送信を含む実際の最新メッセージへ統一

### Database

- migration 067: 「マイル」キーワード自動返信
- migration 068: メディア問い合わせ保存

過去の変更は [GitHub Releases](https://github.com/Shudesu/line-harness-oss/releases) を参照してください。
