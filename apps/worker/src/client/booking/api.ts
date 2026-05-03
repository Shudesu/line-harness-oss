export async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const json = await res.json().catch(() => null) as { success?: boolean; data?: T; error?: string; code?: string } | null;
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || json?.code || `API request failed: ${res.status}`);
  }
  return json.data as T;
}
