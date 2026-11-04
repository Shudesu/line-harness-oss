'use client'

import { useRouter } from 'next/navigation'
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

// Single row of the L-step style friend list. Renders 6 columns:
// 対応マーク / 名前 / アンケート / シナリオ / 受信メッセージ / ★つきタグ・友だち情報
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
      className="grid grid-cols-[80px_200px_180px_120px_1fr_260px] gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer items-start focus:outline-none focus:bg-gray-50"
    >
      {/* 対応マーク — chats.status 由来 (unread / in_progress / resolved). */}
      <div className="pt-1">
        {friend.chatStatus === 'unread' ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700">
            未対応
          </span>
        ) : friend.chatStatus === 'in_progress' ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-yellow-100 text-yellow-700">
            対応中
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-500">
            対応済み
          </span>
        )}
      </div>

      {/* 名前 + アバター + 登録日 */}
      <div className="flex items-start gap-2">
        {friend.pictureUrl ? (
          <img
            src={friend.pictureUrl}
            alt={friend.displayName}
            className="w-9 h-9 rounded-full object-cover bg-gray-100 flex-shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium flex-shrink-0">
            {friend.displayName?.charAt(0) ?? '?'}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{friend.displayName}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">登録: {formatJstDate(friend.createdAt)}</p>
          {!isFollowing && (
            <span className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
              ブロック中
            </span>
          )}
        </div>
      </div>

      {/* アンケート — KIDOUインターンの登録アンケートの答え（metadata の survey_step / university_name / grade / graduation_year） */}
      <SurveyAnswers metadata={friend.metadata} />

      {/* シナリオ */}
      <div className="pt-1">
        {scenario ? (
          <div>
            <p className="text-xs font-medium text-blue-700 truncate" title={scenario.name}>
              {scenario.name}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {scenario.status === 'active' ? '配信中' : scenario.status === 'delivering' ? '配信処理中' : scenario.status}
            </p>
          </div>
        ) : (
          <span className="text-xs text-gray-400">停止中</span>
        )}
      </div>

      {/* 受信メッセージ */}
      <div className="min-w-0">
        {incoming ? (
          <>
            <p className="text-xs text-gray-700 line-clamp-2 break-all">
              {incoming.messageType === 'text' ? incoming.content : `[${incoming.messageType}]`}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">
              ({formatJstTimestamp(incoming.createdAt)})
            </p>
          </>
        ) : (
          <span className="text-xs text-gray-400">受信なし</span>
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
          <p className="text-[10px] text-gray-500">
            <span className="text-gray-400">ASP_LP名：</span>
            {friend.firstTrackedLinkName}
          </p>
        )}
        {friend.refCode && !friend.firstTrackedLinkName && (
          <p className="text-[10px] text-gray-500">
            <span className="text-gray-400">流入：</span>
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
            <p className="text-[10px] text-pink-600">
              <span className="text-gray-400">IG流入：</span>
              {igUsername ? `@${igUsername}` : igAccountId}
            </p>
          )
        })()}
        {friend.tags.length === 0 && !friend.firstTrackedLinkName && !friend.refCode &&
          !(friend as unknown as { metadata?: Record<string, unknown> }).metadata?.ig_account_username &&
          !(friend as unknown as { metadata?: Record<string, unknown> }).metadata?.ig_account_id && (
          <span className="text-[10px] text-gray-300">—</span>
        )}
        {onTagEditClick && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTagEditClick() }}
            className="text-[10px] text-blue-600 hover:text-blue-800 underline mt-0.5"
          >
            タグ編集
          </button>
        )}
      </div>
    </div>
  )
}

const SURVEY_STEP_LABEL: Record<string, string> = {
  consent: '未回答（同意の前）',
  university: '回答中（大学名の前）',
  grade: '回答中（学年の前）',
  graduation_year: '回答中（卒業予定年の前）',
}

function text(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}

// アンケートの答えを日本語の見出しで出す。アンケートに入っていない友だち（ほかのアカウント等）は「—」
function SurveyAnswers({ metadata }: { metadata?: Record<string, unknown> }) {
  const step = text(metadata?.survey_step)
  const university = text(metadata?.university_name)
  const grade = text(metadata?.grade)
  const year = text(metadata?.graduation_year)
  if (!step && !university && !grade && !year) {
    return <div className="pt-1"><span className="text-xs text-gray-300">—</span></div>
  }
  const done = step === 'done'
  const completedAt = text(metadata?.survey_completed_at)
  return (
    <div className="pt-1 space-y-0.5 min-w-0">
      {done ? (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
          回答済み{completedAt ? `（${formatJstDate(completedAt)}）` : ''}
        </span>
      ) : (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
          {(step && SURVEY_STEP_LABEL[step]) ?? '未回答'}
        </span>
      )}
      {[
        ['大学', university],
        ['学年', grade],
        ['卒業予定', year ? `${year}年` : null],
      ].map(([label, value]) => value && (
        <p key={label} className="text-xs text-gray-700 truncate" title={value}>
          <span className="text-[10px] text-gray-400">{label}：</span>{value}
        </p>
      ))}
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
