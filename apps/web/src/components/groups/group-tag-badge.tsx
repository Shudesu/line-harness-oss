import { Button } from '@cloudflare/kumo/components/button'

export type GroupTag = { id: string; name: string; color: string }

/**
 * Same look as the friend tag badge, but typed for the trimmed-down tag shape
 * the groups API returns (id / name / color only).
 */
export default function GroupTagBadge({
  tag,
  onRemove,
}: {
  tag: GroupTag
  onRemove?: () => void
}) {
  // Pick the text colour from the background's brightness so light and dark
  // tag colours both stay readable.
  const hex = tag.color.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const textColor = luminance > 0.5 ? '#1f2937' : '#ffffff'

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: tag.color, color: textColor }}
    >
      {tag.name}
      {onRemove ? (
        <Button
          type="button"
          onClick={onRemove}
          className="ml-0.5 min-h-0 min-w-0 p-0 hover:opacity-70"
          size="xs"
          shape="square"
          variant="ghost"
          aria-label={`タグ「${tag.name}」を外す`}
        >
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </Button>
      ) : null}
    </span>
  )
}
