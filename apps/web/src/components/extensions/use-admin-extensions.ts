'use client'

import { useEffect, useState } from 'react'
import type { AdminExtension } from '@line-crm/shared'
import { fetchApi } from '@/lib/api'

export function useAdminExtensions() {
  const [extensions, setExtensions] = useState<AdminExtension[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetchApi<{ extensions: AdminExtension[] }>('/api/admin/extensions', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setExtensions(result.extensions) })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  return { extensions, loading, error }
}
