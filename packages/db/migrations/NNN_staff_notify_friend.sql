-- Migration NNN: staff.notify_friend_id — 予約リクエストをスタッフの LINE へ通知する

-- 予約リクエストが入っても、スタッフ側には何の通知も飛ばない。booking.ts は
-- fireEvent を呼ばないため outgoing webhook にも automation にも乗らず、
-- 管理画面の pending-count を目視するプル型しか無い。
--
-- 承認制 (requested → confirmed) と組み合わさると実害が出る。予約リクエストは
-- 24 時間承認されないと expired になる (REQUEST_TTL_HOURS) ため、誰も管理画面を
-- 見ていないと、顧客には「お店からの返信をお待ちください」と伝えたまま静かに
-- 期限切れになる。
--
-- 送信先はスタッフ本人が公式アカウントを友だち追加した friends 行とする。
-- staff は line_user_id を持たないので、friends.id への参照を 1 列足す。
-- NULL = 通知しない (既存行はすべて NULL なので挙動は変わらない)。
--
-- 全件を受け取る店長などは account_settings の
-- 'booking_notify_friend_ids' (friends.id の JSON 配列) で指定する。
-- 汎用 KV なので追加のテーブルは要らない。
--
-- ⚠️ push はアカウントの配信通数を消費する。スタッフ通知を有効にすると
-- 1 予約あたり (指名スタッフ + 全件通知先) の通数が顧客配信と同じ枠から減る。

ALTER TABLE staff ADD COLUMN notify_friend_id TEXT;
