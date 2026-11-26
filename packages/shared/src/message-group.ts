/** Versioned storage codec for an ordered send. Single messages retain their legacy
 * representation; groups live in message_content without destructive table rebuilds.
 * message_type is the first item's type. Never send the envelope itself to LINE.
 * One log row represents one recipient/request, preserving quota and resume counts.
 */
export type MessageItem = { messageType: 'text' | 'image' | 'flex'; messageContent: string };
export const MAX_MESSAGE_ITEMS = 5;
const GROUP_KEY = '$lineHarnessMessages';

export function parseMessageGroup(content: string): MessageItem[] | null {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return null; }
  if (!value || typeof value !== 'object' || !(GROUP_KEY in value)) return null;
  const group = value as Record<string, unknown>;
  if (group[GROUP_KEY] !== 1 || !Array.isArray(group.items)
      || group.items.length < 1 || group.items.length > MAX_MESSAGE_ITEMS) {
    throw new Error('メッセージは1〜5つで指定してください');
  }
  return group.items.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('メッセージの形式が不正です');
    const v = item as Record<string, unknown>;
    if (!['text', 'image', 'flex'].includes(String(v.messageType)) || typeof v.messageContent !== 'string') {
      throw new Error('メッセージの種類または内容が不正です');
    }
    let nested: unknown;
    try { nested = JSON.parse(v.messageContent); } catch { /* Plain text is valid. */ }
    if (nested && typeof nested === 'object' && GROUP_KEY in nested) throw new Error('メッセージを入れ子にすることはできません');
    return { messageType: v.messageType, messageContent: v.messageContent } as MessageItem;
  });
}

export function messageItems(messageType: string, messageContent: string): MessageItem[] {
  return parseMessageGroup(messageContent) ?? [{ messageType: messageType as MessageItem['messageType'], messageContent }];
}

export function packMessageItems(items: MessageItem[]): MessageItem {
  if (items.length < 1 || items.length > MAX_MESSAGE_ITEMS) throw new Error('メッセージは1〜5つで指定してください');
  return items.length === 1 ? { ...items[0] } : {
    messageType: items[0].messageType,
    messageContent: JSON.stringify({ [GROUP_KEY]: 1, items }),
  };
}

/** Validate drafts at save/send boundaries; legacy delivery remains backwards compatible. */
export function validateMessageContent(messageType: string, content: string): string | null {
  try {
    if (!['text', 'image', 'flex'].includes(messageType)) return '未対応のメッセージタイプです';
    if (typeof content !== 'string') return 'メッセージの形式が不正です';
    const items = messageItems(messageType, content);
    for (const [index, item] of items.entries()) {
      const prefix = `${index + 1}つ目: `;
      if (!item.messageContent.trim()) return prefix + '内容を入力してください';
      if (item.messageType === 'text') {
        if (item.messageContent.length > 5000) return prefix + 'テキストは5000文字以内で入力してください';
      } else if (item.messageType === 'image') {
        const image = JSON.parse(item.messageContent);
        for (const key of ['originalContentUrl', 'previewImageUrl']) {
          if (typeof image?.[key] !== 'string' || !/^https:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/.test(image[key])) return prefix + '画像にはHTTPSの画像URLが必要です';
        }
      } else if (item.messageType === 'flex') {
        const flex = JSON.parse(item.messageContent);
        if (!flex || !['bubble', 'carousel'].includes(flex.type)) return prefix + 'FlexはbubbleまたはcarouselのJSONを指定してください';
      } else return prefix + '未対応のメッセージタイプです';
    }
    return null;
  } catch (error) {
    return error instanceof SyntaxError ? '画像・FlexのJSONを確認してください' : error instanceof Error ? error.message : 'メッセージを確認してください';
  }
}
