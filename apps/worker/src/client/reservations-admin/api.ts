import { state, syncApiKeyFromInput } from './state.js';
import type { ApiResponse } from './types.js';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  syncApiKeyFromInput();

  if (!state.apiKey) {
    throw new Error('APIキーを入力してください');
  }

  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.apiKey}`,
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok || !body?.success) {
    throw new Error(body && !body.success ? body.error : `API error: ${response.status}`);
  }
  return body.data;
}
