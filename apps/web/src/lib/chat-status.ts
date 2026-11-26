export type ChatStatus = 'unread' | 'in_progress' | 'resolved'

/**
 * 未読のチャットを開いたときに「対応中」へ自動遷移させるかどうか。
 * 手動で付けた「対応中」「解決済」を上書きしないよう、未読のときだけ遷移させる。
 */
export function shouldAcknowledgeOnOpen(status: ChatStatus): boolean {
  return status === 'unread'
}

/**
 * 一覧上の1件を「未読 → 対応中」に差し替える。対象が未読でなければ
 * (すでに別のステータスへ変わっていれば) 一覧をそのまま返す。
 */
export function acknowledgeChatInList<T extends { id: string; status: ChatStatus }>(
  chats: T[],
  chatId: string,
): T[] {
  if (!chats.some((chat) => chat.id === chatId && shouldAcknowledgeOnOpen(chat.status))) return chats
  return chats.map((chat) => (chat.id === chatId ? { ...chat, status: 'in_progress' as const } : chat))
}
