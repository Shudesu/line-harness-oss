'use client'

import { useRouter } from 'next/navigation'
import { TagIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Button } from '@cloudflare/kumo/components/button'
import type { FriendListItem } from '@/lib/api'
import TagBadge from './tag-badge'

interface Props {
  friend: FriendListItem
  // Toggles the inline tag-management section underneath the row. Wired up
  // to a discrete button (with stopPropagation) inside this component, NOT
  // to the row body — the row body navigates to /chats and we don't want
  // the tag-edit affordance to compete with that primary click target.
  onTagEditClick?: () => void
}

// Single row of the L-step style friend list. Renders 5 columns:
// 対応マーク / 名前 / シナリオ / 受信メッセージ / ★つきタグ・友だち情報
// Clicking the row navigates to the per-friend chat view at
// `/chats?friend=<id>` so the operator can read history / reply / mark as
// resolved without leaving the list. The "タグ" button at the end of the
// last column opens an inline tag editor (handled by the parent table).
export default function FriendListRow({ friend, onTagEditClick }: Props) {
  const router = useRouter()
  const navigateToChat = () => router.push(`/chats?friend=${friend.id}`)
  const incoming = friend.latestIncomingMessage
  const scenario = friend.activeScenario
  const isFollowing = friend.isFollowing

  return (
    <div
      onClick={navigateToChat}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        // Only react when the row itself is the keyboard target. Otherwise
        // an Enter/Space pressed on a nested button (e.g. タグ編集) would
        // bubble up here and override the button's own click handler,
        // navigating away instead of toggling the tag editor.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigateToChat()
        }
      }}
      className="grid cursor-pointer grid-cols-[80px_220px_120px_1fr_280px] items-start gap-3 border-b border-kumo-line px-4 py-3 hover:bg-kumo-tint focus:bg-kumo-tint focus:outline-none"
    >
      {/* 対応マーク — chats.status 由来 (unread / in_progress / resolved). */}
      <div className="pt-1">
        {friend.chatStatus === 'unread' ? (
          <Badge variant="error" appearance="dot">未対応</Badge>
        ) : friend.chatStatus === 'in_progress' ? (
          <Badge variant="warning" appearance="dot">対応中</Badge>
        ) : (
          <Badge variant="neutral" appearance="dot">対応済み</Badge>
        )}
      </div>

      {/* 名前 + アバター + 登録日 */}
      <div className="flex items-start gap-2">
        {friend.pictureUrl ? (
          <img
            src={friend.pictureUrl}
            alt={friend.displayName}
            className="h-9 w-9 flex-shrink-0 rounded-full bg-kumo-tint object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-kumo-fill text-sm font-medium text-kumo-subtle">
            {friend.displayName?.charAt(0) ?? '?'}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-kumo-strong">{friend.displayName}</p>
          <p className="mt-0.5 text-[10px] text-kumo-subtle">登録: {formatJstDate(friend.createdAt)}</p>
          {!isFollowing && (
            <p className="mt-0.5 text-[10px] text-kumo-danger">ブロック / 退会</p>
          )}
        </div>
      </div>

      {/* シナリオ */}
      <div className="pt-1">
        {scenario ? (
          <div>
            <p className="truncate text-xs font-medium text-kumo-link" title={scenario.name}>
              {scenario.name}
            </p>
            <p className="mt-0.5 text-[10px] text-kumo-subtle">
              {scenario.status === 'active' ? '配信中' : scenario.status === 'delivering' ? '配信処理中' : scenario.status}
            </p>
          </div>
        ) : (
          <span className="text-xs text-kumo-subtle">停止中</span>
        )}
      </div>

      {/* 受信メッセージ */}
      <div className="min-w-0">
        {incoming ? (
          <>
            <p className="line-clamp-2 break-all text-xs text-kumo-default">
              {incoming.messageType === 'text' ? incoming.content : `[${incoming.messageType}]`}
            </p>
            <p className="mt-1 text-[10px] text-kumo-subtle">
              ({formatJstTimestamp(incoming.createdAt)})
            </p>
          </>
        ) : (
          <span className="text-xs text-kumo-subtle">受信なし</span>
        )}
      </div>

      {/* ★つきタグ・友だち情報 */}
      <div className="space-y-1">
        {friend.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {friend.tags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
          </div>
        )}
        {friend.firstTrackedLinkName && (
          <p className="text-[10px] text-kumo-default">
            <span className="text-kumo-subtle">ASP_LP名：</span>
            {friend.firstTrackedLinkName}
          </p>
        )}
        {friend.refCode && !friend.firstTrackedLinkName && (
          <p className="text-[10px] text-kumo-default">
            <span className="text-kumo-subtle">流入：</span>
            {friend.refCode}
          </p>
        )}
        {/* IG account attribution (written by IG Harness cross-link, first touch) */}
        {(() => {
          const meta = (friend as unknown as { metadata?: Record<string, unknown> }).metadata
          const igUsername = meta?.ig_account_username as string | undefined
          const igAccountId = meta?.ig_account_id as string | undefined
          if (!igUsername && !igAccountId) return null
          return (
            <p className="text-[10px] text-kumo-badge-purple">
              <span className="text-kumo-subtle">IG流入：</span>
              {igUsername ? `@${igUsername}` : igAccountId}
            </p>
          )
        })()}
        {friend.tags.length === 0 && !friend.firstTrackedLinkName && !friend.refCode &&
          !(friend as unknown as { metadata?: Record<string, unknown> }).metadata?.ig_account_username &&
          !(friend as unknown as { metadata?: Record<string, unknown> }).metadata?.ig_account_id && (
          <span className="text-[10px] text-kumo-inactive">—</span>
        )}
        {onTagEditClick && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            icon={TagIcon}
            onClick={(e) => { e.stopPropagation(); onTagEditClick() }}
            className="mt-0.5 px-0 text-kumo-link"
          >
            タグ編集
          </Button>
        )}
      </div>
    </div>
  )
}

// Format ISO ts to "YYYY-MM-DD HH:MM:SS" in JST. The DB stores values
// already in JST (`+09:00` strftime), so we render as-is — using the
// browser's locale formatter would re-interpret as UTC and shift 9h.
function formatJstTimestamp(iso: string): string {
  // Accept both `2026-05-08T13:45:00.000+09:00` and `2026-05-08T13:45:00`.
  // Slice off the timezone suffix and the millisecond decimals to land on
  // the 19-char canonical form, then swap T → space.
  const trimmed = iso.replace(/(\.\d+)?(Z|[+\-]\d{2}:?\d{2})?$/, '')
  return trimmed.replace('T', ' ').slice(0, 19)
}

// Date-only variant for the registration column. Same JST-as-stored
// rationale — slice off everything after the date portion.
function formatJstDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '/')
}
