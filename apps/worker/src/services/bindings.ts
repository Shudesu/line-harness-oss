export type SecretLike = string | { get: () => Promise<string> } | undefined | null;

export function isSecretStoreBinding(value: unknown): value is { get: () => Promise<string> } {
  return typeof value === 'object'
    && value !== null
    && 'get' in value
    && typeof (value as { get?: unknown }).get === 'function';
}

export async function resolveBindingValue(value: SecretLike): Promise<string> {
  if (typeof value === 'string') return value.trim();
  if (isSecretStoreBinding(value)) return (await value.get()).trim();
  return '';
}

export function liffIdToLoginChannelId(liffId?: string | null): string | null {
  const normalized = liffId?.trim();
  if (!normalized) return null;
  const [channelId] = normalized.split('-');
  return /^\d+$/.test(channelId) ? channelId : null;
}
