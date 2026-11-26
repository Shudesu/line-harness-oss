import { messageItems, packMessageItems, parseMessageGroup, validateMessageContent } from '@line-crm/shared';
import type { Message } from '@line-crm/line-sdk';

type SingleBuilder = (type: string, content: string, altText?: string) => Message;
export function buildMessages(type: string, content: string, builder: SingleBuilder, altText?: string): Message[] {
  if (parseMessageGroup(content)) {
    const error = validateMessageContent(type, content);
    if (error) throw new Error(error);
  }
  return messageItems(type, content).map(item => builder(item.messageType, item.messageContent, altText));
}

export function messagesToLogPayload(messages: Message[], single: (message: Message) => { messageType: string; content: string }) {
  if (messages.length === 1) return single(messages[0]);
  const packed = packMessageItems(messages.map(message => {
    const log = single(message);
    return { messageType: log.messageType as 'text' | 'image' | 'flex', messageContent: log.content };
  }));
  return { messageType: packed.messageType, content: packed.messageContent };
}
