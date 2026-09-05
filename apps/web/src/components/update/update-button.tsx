'use client'

import { useState } from 'react'
import { startUpdate } from '@/lib/update-client'
import { ProgressModal } from './progress-modal'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'

/**
 * Kicks off an update via `POST /admin/update/start` and mounts a
 * ProgressModal bound to the returned updateId. The modal manages its own
 * SSE/polling lifecycle and calls `onClose` when the operator dismisses it.
 */
export function UpdateButton({ targetVersion }: { targetVersion: string }) {
  const [loading, setLoading] = useState(false)
  const [updateId, setUpdateId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setLoading(true)
    setError(null)
    try {
      const r = await startUpdate()
      setUpdateId(r.updateId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`update failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        disabled={loading}
        size="sm"
        variant="primary"
        loading={loading}
      >
        {loading ? '開始中...' : `v${targetVersion} にアップデート`}
      </Button>
      {error && <Banner className="mt-2" size="sm" variant="error" title="アップデートを開始できませんでした" description={error} />}
      {updateId && (
        <ProgressModal
          updateId={updateId}
          onClose={() => setUpdateId(null)}
        />
      )}
    </>
  )
}
