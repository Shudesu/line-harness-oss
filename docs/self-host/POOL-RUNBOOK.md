# プール運用メモ（Phase D）

## 最小構成（2 無料 LINE アカウント）

1. `/accounts` で 2 チャネルを登録
2. `/pools` でプール作成 → 両アカウントをプールに追加 → `active_account_id` を現在の送信用に設定
3. **リファラルリンク / 流入** で `entry_routes` に ref を登録し **プール ID** を紐付け（プールだけでは UI が未登録表示）

## 200 通/月

- ダッシュボード **配信健全性** で残クォータを監視
- 枯渇前に `active_account_id` をプール内の別アカウントへ切替

## BAN

[18-Multi-Account-and-BAN.md](../wiki/18-Multi-Account-and-BAN.md) の移行フローに従う。

図解: [30-Video-Feature-Playbook.md](../wiki/30-Video-Feature-Playbook.md) Phase D
