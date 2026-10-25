# プロジェクトの対応状況

更新: 2026-10-25。L Harnessの公開版で配布済みの変更と、保守作業中の変更を分けて掲載しています。

## 公開済み

- [v0.24.3](https://github.com/Shudesu/line-harness-oss/releases/tag/v0.24.3): 2026-10-20公開。Webhookの安全性を改善。
- [v0.24.2](https://github.com/Shudesu/line-harness-oss/releases/tag/v0.24.2): 2026-10-13 JST公開。型付きメッセージ編集・複数メッセージの送信に対応。
- Calendarのmanaged接続と予約ダイアログの修正は[PR #383](https://github.com/Shudesu/line-harness-oss/pull/383)を参照してください。

導入する版は[Releases](https://github.com/Shudesu/line-harness-oss/releases)の配布物・更新手順を確認してください。Cloudの反映状況と、OSSの公開リリースは別です。

## 検証が進んだもの

- [PR #394](https://github.com/Shudesu/line-harness-oss/pull/394)・[PR #395](https://github.com/Shudesu/line-harness-oss/pull/395): 再送の受付判定とキュー取得時の競合を保守側でも検証。公開mainを基点に両変更を組み合わせた1,682テスト・型検査が成功しました。Cloud側へは適応済みですが、公開版への取り込み・配布はまだです。
- [PR #403](https://github.com/Shudesu/line-harness-oss/pull/403): 配信開始前の編集・延期との競合を確認。Cloud向け適応版では周辺の編集処理も合わせて検証し、1,829テスト・型検査・ビルドが成功しました。専用環境では合成のLINE/Google応答を用いて、競合・途中失敗など9項目を確認しています。公開版への取り込みと本番反映は未完了です。この件数は公開PR単独の結果ではなく、Cloud向け適応版の結果です。
- [PR #401](https://github.com/Shudesu/line-harness-oss/pull/401): Draftを維持。DB移行番号、旧Workerからの引継ぎ、未完了配信の照合、戻す条件を先に整理する対象です。

これらは配信安全性の一部の改善です。[Issue #64](https://github.com/Shudesu/line-harness-oss/issues/64)全体の完了を意味しません。実ユーザーへの試験送信や、受付不明の配信の再送は行っていません。

## 次に確認するもの

- [PR #389 / Issue #388](https://github.com/Shudesu/line-harness-oss/pull/389): ダイアログの余白・スマートフォン幅。報告と修正案を一つの作業として確認します。
- [PR #370 / Issue #369](https://github.com/Shudesu/line-harness-oss/pull/370): 公開画像のレート制限。画像取得と、認証を要する管理APIの制限を分けて検証します。
- [Issue #351](https://github.com/Shudesu/line-harness-oss/issues/351)・[Issue #358](https://github.com/Shudesu/line-harness-oss/issues/358): セットアップ時のSQL引数の受け渡し。Windowsでの挙動と、移行を途中状態にしないことを確認します。

ここでの掲載順は確認の優先度で、実装や公開日の確約ではありません。既存の利用者への約束を変更するものでもありません。

## 状態の読み方

- 一次確認: 報告内容・関連する変更を読み、確認項目を整理した段階。
- 検証中: 再現・追加確認を進めている段階。
- 検証済み・反映準備: 対象の変更で必要な検証を終えた段階。公開・配布済みとは異なります。
- 情報待ち: 判断に必要な情報を具体的に依頼した段階。依頼を出す前にこの表示にはしません。
- 保留: 採用範囲、依存する変更、移行条件などの判断が残る段階。理由と再開条件を残します。
- 公開済み: 公開コミットやリリースに反映した段階。実際に導入した版の確認は別に必要です。

公開PR・Issueの全件一次分類は[確認対象一覧](maintenance-queue-2026-10-25.md)に記載しています。詳細な進展は元のスレッドで共有します。

## 貢献への謝辞と参加方法

再現手順、回帰テスト、独立プラグイン、利用時の気付きが改善につながっています。今回の再送・キュー・開始競合の検証では、yamayuedさんのPRとテストを起点にしました。画面の余白はbbbyk105さん、画像取得の制限はnamico-design-worksさん、Windowsセットアップはstarykitazawa-ossさんの報告・修正案を確認しています。

変更をそのままmergeせず、互換性を保つために適応する場合も、元のPRと貢献者を記録します。報告の際は[CONTRIBUTING.md](../CONTRIBUTING.md)を参照し、秘密情報・顧客情報を公開スレッドへ載せないでください。
