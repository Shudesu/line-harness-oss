import type { Message } from '@line-crm/line-sdk';

interface MessageSender {
  name?: string;
  iconUrl?: string;
}

type MessageWithSender = Message & { sender?: MessageSender };

type MessageSenderValidation =
  | { valid: true; sender: MessageSender | undefined }
  | { valid: false };

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('https://')) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateMessageSender(value: unknown): MessageSenderValidation {
  if (value === undefined) return { valid: true, sender: undefined };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false };

  const { name, iconUrl } = value as Record<string, unknown>;
  const nameLength = typeof name === 'string' ? Array.from(name).length : 0;
  if (name !== undefined && (typeof name !== 'string' || nameLength < 1 || nameLength > 20)) {
    return { valid: false };
  }
  if (iconUrl !== undefined && !isHttpsUrl(iconUrl)) return { valid: false };

  return {
    valid: true,
    sender: {
      ...(name !== undefined ? { name } : {}),
      ...(iconUrl !== undefined ? { iconUrl } : {}),
    },
  };
}

export function withMessageSender(message: Message, sender?: MessageSender): MessageWithSender {
  return sender ? { ...message, sender } : message;
}
