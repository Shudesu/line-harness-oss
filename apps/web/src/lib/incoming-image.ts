/** Only the configured API origin receives credentials. Legacy URLs are mapped
 * to the private route without rewriting stored message history. */
export function incomingImageUrl(src: string, apiBase: string): string | null {
  const base = new URL(apiBase);
  const url = new URL(src, base);
  const match = /^\/(?:images|api\/incoming-images)\/(incoming-[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp))$/.exec(url.pathname);
  if (!match) return null;
  if (url.origin !== base.origin) throw new Error('Unexpected incoming image origin');
  return `${base.origin}/api/incoming-images/${match[1]}`;
}

export async function fetchIncomingImage(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal });
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
  return response.blob();
}
