# 2026-10-25 開発・保守の進捗

PR・Issueでの報告、修正案、回帰テストの提供ありがとうございます。保守作業の進み具合が公開側で分かりにくかったため、[対応状況](../project-status.md)と[公開案件の一次分類](../maintenance-queue-2026-10-25.md)を用意しました。

## 公開済みの更新

直近の公開リリースは、10月20日の[v0.24.3](https://github.com/Shudesu/line-harness-oss/releases/tag/v0.24.3)です。Webhookの安全性を改善しました。READMEの固定バージョン表示も、最新リリースを参照する案内へ更新しました。

## 投稿から進んだ改善

yamayuedさんの[PR #394](https://github.com/Shudesu/line-harness-oss/pull/394)・[PR #395](https://github.com/Shudesu/line-harness-oss/pull/395)を起点に、再送の受付判定と古いキュー取得を検証しました。Cloud側には適応済みで、公開側への取り込みを準備しています。

[PR #403](https://github.com/Shudesu/line-harness-oss/pull/403)の開始競合も保守側で検証しました。Cloud向け適応版では、追加の回帰検証、全1,829テスト、型検査・ビルドが成功しています。専用環境の9項目も確認できましたが、公開版への取り込みと本番反映は未完了です。配信を実顧客へ送る試験は行っていません。

## 次の確認対象

- ダイアログの余白・画面幅: [PR #389](https://github.com/Shudesu/line-harness-oss/pull/389) / [Issue #388](https://github.com/Shudesu/line-harness-oss/issues/388)
- 公開画像の取得制限: [PR #370](https://github.com/Shudesu/line-harness-oss/pull/370) / [Issue #369](https://github.com/Shudesu/line-harness-oss/issues/369)
- セットアップ時のSQL引数: [Issue #351](https://github.com/Shudesu/line-harness-oss/issues/351) / [Issue #358](https://github.com/Shudesu/line-harness-oss/issues/358)

確認対象への掲載は、採用や公開日の約束ではありません。保留や追加確認が必要な場合も、理由と次の確認点を元のスレッドに残す運用へ整えます。

貢献を適応して取り込む場合も、元のPRと貢献者を記録します。報告・参加の方法は[CONTRIBUTING.md](../../CONTRIBUTING.md)をご覧ください。
