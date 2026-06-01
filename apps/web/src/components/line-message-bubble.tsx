import FlexPreviewComponent from '@/components/flex-preview'

type LineMessageBubbleProps = {
  content: string
  messageType?: string | null
  outgoing: boolean
  createdAt?: string | null
  avatarUrl?: string | null
  maxWidth?: number
}

export function LineMessageBubble({
  content,
  messageType,
  outgoing,
  createdAt,
  avatarUrl,
  maxWidth = 320,
}: LineMessageBubbleProps) {
  return (
    <div className={`flex items-end gap-2 ${outgoing ? 'justify-end' : 'justify-start'}`}>
      {!outgoing && (
        avatarUrl ? (
          <img src={avatarUrl} alt="" className="mb-1 h-8 w-8 flex-shrink-0 rounded-full object-cover" />
        ) : (
          <div className="mb-1 h-8 w-8 flex-shrink-0 rounded-full bg-gray-300" />
        )
      )}

      <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}>
        <div
          className={`break-words whitespace-pre-wrap px-3 py-2 text-sm ${
            outgoing
              ? 'rounded-bl-2xl rounded-br-2xl rounded-tl-2xl rounded-tr-md text-white'
              : 'rounded-bl-2xl rounded-br-2xl rounded-tl-md rounded-tr-2xl bg-white text-gray-900'
          }`}
          style={{
            maxWidth,
            ...(outgoing ? { backgroundColor: '#06C755' } : {}),
          }}
        >
          <LineMessageContent content={content} messageType={messageType} maxWidth={Math.max(maxWidth - 40, 220)} />
        </div>
        {createdAt && (
          <span className="mt-0.5 px-1 text-xs text-white/60">
            {new Date(createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  )
}

function LineMessageContent({ content, messageType, maxWidth }: { content: string; messageType?: string | null; maxWidth: number }) {
  if (messageType === 'flex') {
    return (
      <div style={{ maxWidth }}>
        <FlexPreviewComponent content={content} maxWidth={maxWidth} />
      </div>
    )
  }
  if (messageType === 'image') {
    const imageUrl = readImageUrl(content)
    return imageUrl ? (
      <img src={imageUrl} alt="" className="max-h-64 rounded-lg object-contain" style={{ maxWidth }} />
    ) : (
      <span>画像メッセージ</span>
    )
  }
  return <span>{content}</span>
}

function readImageUrl(content: string): string | null {
  const trimmed = content.trim()
  if (/^https?:\/\//.test(trimmed)) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as { originalContentUrl?: string; previewImageUrl?: string }
    return parsed.originalContentUrl || parsed.previewImageUrl || null
  } catch {
    return null
  }
}
