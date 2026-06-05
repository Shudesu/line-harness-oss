import { resolveBindingValue, type SecretLike } from './bindings.js';

export type SettingsEnv = {
  APP_ENCRYPTION_KEY?: SecretLike;
};

export const ENCRYPTED_PREFIX = 'enc:v1:';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(rawKey: string): Promise<CryptoKey | null> {
  const normalized = rawKey.trim();
  if (!normalized) return null;
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(normalized));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function getCryptoKey(env: SettingsEnv): Promise<CryptoKey | null> {
  const raw = await resolveBindingValue(env.APP_ENCRYPTION_KEY);
  return deriveKey(raw);
}

export function isEncryptedSettingValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

export async function encryptSettingValue(value: string, env: SettingsEnv): Promise<string> {
  const key = await getCryptoKey(env);
  if (!key) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(value),
  );
  return `${ENCRYPTED_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSettingValue(value: string, env: SettingsEnv): Promise<string> {
  if (!isEncryptedSettingValue(value)) return value;

  const key = await getCryptoKey(env);
  if (!key) {
    throw new Error('APP_ENCRYPTION_KEY is required to decrypt encrypted account setting');
  }

  const payload = value.slice(ENCRYPTED_PREFIX.length);
  const [ivBase64, encryptedBase64] = payload.split(':');
  if (!ivBase64 || !encryptedBase64) {
    throw new Error('Invalid encrypted account setting format');
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivBase64) },
    key,
    fromBase64(encryptedBase64),
  );
  return textDecoder.decode(decrypted);
}

export function maskSettingValue(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.length <= 8) return '********';
  return `${normalized.slice(0, 4)}********${normalized.slice(-4)}`;
}
