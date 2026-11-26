export type AdminSession = {
  data: { name?: string; role: 'owner' | 'admin' | 'staff'; staffRolePolicy?: string }
  csrfToken?: string
}

export class SessionCheckError extends Error {
  constructor(readonly status?: number) {
    super(status ? `セッション確認に失敗しました (HTTP ${status})` : 'セッション確認に失敗しました')
  }
}

/** Only a confirmed 401 means the caller needs to sign in again. */
export async function readAdminSession(apiBase: string | undefined, signal: AbortSignal): Promise<AdminSession | null> {
  if (!apiBase) throw new SessionCheckError()
  const res = await fetch(`${apiBase}/api/auth/session`, {
    credentials: 'include', cache: 'no-store', signal,
  })
  if (res.status === 401) return null
  if (!res.ok) throw new SessionCheckError(res.status)
  const body = await res.json()
  if (!body?.success || !body.data || !['owner', 'admin', 'staff'].includes(body.data.role)) {
    throw new SessionCheckError()
  }
  return body as AdminSession
}

/** Display metadata is optional; storage restrictions must not invalidate a verified session. */
export function cacheAdminSession(session: AdminSession, getStorage: () => Storage): void {
  try {
    const storage = getStorage()
    storage.removeItem('lh_api_key')
    if (session.data.name) storage.setItem('lh_staff_name', session.data.name)
    storage.setItem('lh_staff_role', session.data.role)
    storage.setItem('lh_staff_policy', session.data.staffRolePolicy === 'strict' ? 'strict' : 'legacy')
    if (session.csrfToken) storage.setItem('lh_csrf', session.csrfToken)
  } catch {
    // The credential remains in the HttpOnly cookie. No credential fallback.
  }
}
