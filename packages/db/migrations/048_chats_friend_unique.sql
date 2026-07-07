-- chats を 1 friend = 1 行に統一する。
-- 書き手 (resolveOrCreateChat 経由の status 更新) が最古行、読み手 (未対応判定の
-- CANDIDATES_SQL / latest_chat CTE / getChatByFriendId) が最新行を選んでいたため、
-- friend_id 重複がある DB では「解決済にしても未対応バッジから消えない」不整合が起きる。

-- 重複がある friend では、削除前にオペレーター操作の状態を残す行へ引き継ぐ。
-- status は updated_at が最新の行 (最後に更新された行) から取る。operator_id / notes
-- は「非 NULL の中で最新」を取る — webhook が最新行の updated_at だけ進めたケースで
-- 古い行のアサイン・メモが NULL に潰されるのを防ぐ。last_message_at は全行の MAX。
-- 最古行だけ resolved にされていたケースのデータロスを防ぐ (2026-07 バグ報告の実シナリオ)。
UPDATE chats SET
  status = (
    SELECT c2.status FROM chats c2
    WHERE c2.friend_id = chats.friend_id
    ORDER BY c2.updated_at DESC, c2.rowid DESC LIMIT 1
  ),
  operator_id = (
    SELECT c2.operator_id FROM chats c2
    WHERE c2.friend_id = chats.friend_id AND c2.operator_id IS NOT NULL
    ORDER BY c2.updated_at DESC, c2.rowid DESC LIMIT 1
  ),
  notes = (
    SELECT c2.notes FROM chats c2
    WHERE c2.friend_id = chats.friend_id AND c2.notes IS NOT NULL
    ORDER BY c2.updated_at DESC, c2.rowid DESC LIMIT 1
  ),
  last_message_at = (
    SELECT MAX(c2.last_message_at) FROM chats c2
    WHERE c2.friend_id = chats.friend_id
  )
WHERE EXISTS (
  SELECT 1 FROM chats c2
  WHERE c2.friend_id = chats.friend_id AND c2.rowid != chats.rowid
);

-- 既存の重複は最新行 (created_at 最大、同時刻なら rowid 最大) に寄せて他を削除する。
DELETE FROM chats
WHERE EXISTS (
  SELECT 1 FROM chats c2
  WHERE c2.friend_id = chats.friend_id
    AND (c2.created_at > chats.created_at
         OR (c2.created_at = chats.created_at AND c2.rowid > chats.rowid))
);

-- 以後の重複を DB レベルで禁止する。非 UNIQUE の旧インデックスは冗長になるので落とす。
DROP INDEX IF EXISTS idx_chats_friend;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_friend_unique ON chats (friend_id);
