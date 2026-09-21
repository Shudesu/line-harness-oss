# マイル運用メモ（Phase C）

管理画面 **マイル**（`/scoring`）でルールを確認・編集します。ウェビナー連携の既定値は migration `063`（90% 視聴で `webinar_completed`）。

## 特典の例（既存機能の組み合わせ）

1. マイル付与は自動（視聴 heartbeat → `webinar-mileage` サービス）
2. **オートメーション** で「タグ X 付与時」→ 限定シナリオ開始
3. **リッチメニュー** をタグ別に切替え、高マイルユーザーのみ特典メニューを表示

## ブロック率と表現

- 残高は **有効友だち** のチャットサイドバーに表示
- 「ブロックするとマイルは失効」は利用規約・LINE 文言で明示（ledger 自体は履歴として残る）

詳細手順: [30-Video-Feature-Playbook.md](../wiki/30-Video-Feature-Playbook.md) Phase C
