'use client'
import { useUpdateNotification } from '@/hooks/use-update-notification'
import { Button } from '@cloudflare/kumo/components/button'

export default function UpdateBanner() {
  const { release, dismiss } = useUpdateNotification()
  if (!release) return null

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span aria-hidden="true">🎉</span>
        <span className="text-blue-900">
          新バージョン <strong>{release.tag}</strong> がリリースされました
        </span>
        <a
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline hover:text-blue-900"
        >
          詳細を見る
        </a>
      </div>
      <Button
        type="button"
        onClick={dismiss}
        aria-label="このアップデート通知を閉じる"
        className="shrink-0 -mr-2"
        size="xs"
        shape="square"
        variant="ghost"
      >
        ✕
      </Button>
    </div>
  )
}
