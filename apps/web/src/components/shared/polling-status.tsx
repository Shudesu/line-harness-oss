import React from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import type { PollingReason } from '../../lib/activity-polling'

export function PollingStatus({ reason, onResume }: { reason: PollingReason; onResume: () => void }) {
  if (reason === 'active') return null
  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600" role="status">
      <p>{reason === 'hidden' ? '画面が非表示のため自動更新を一時停止しています。' : '5分間操作がなかったため自動更新を一時停止しています。'} 前回取得した内容を表示しています。</p>
      <p>画面に戻って操作すると再開します。</p>
      <Button type="button" size="sm" variant="secondary" onClick={onResume}>更新を再開</Button>
    </div>
  )
}
