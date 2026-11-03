import type { AdminExtension } from '@line-crm/shared'

/** Narrow relative paths only: no query, percent encoding, fragment or traversal. */
export function extensionFrameUrl(extension: AdminExtension, path: string | null,
  accountId: string | null, adminOrigin: string): string | null {
  let url: URL
  try { url = new URL(extension.url) } catch { return null }
  if (url.protocol !== 'https:' || url.origin === adminOrigin || url.username || url.password || url.hash) return null
  if (path) {
    if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*(?:\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)*\/?$/.test(path)) return null
    url.pathname = url.pathname.replace(/\/?$/, '/') + path
  }
  if (accountId) url.searchParams.set('lh_account', accountId)
  else url.searchParams.delete('lh_account')
  return url.href
}
