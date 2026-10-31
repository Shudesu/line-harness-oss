// アカウントごとの色と、画面ごとの「アカウント別／全アカウント共通」の区別。
// 複数の LINE アカウントを同じ管理画面で扱うため、いまどのアカウントを
// 触っているかを色で見分けられるようにする（取り違え防止）。

export interface AccountTone {
  solid: string   // 帯・アイコンの塗り
  soft: string    // 薄い背景
  text: string    // 濃い文字
}

const TONES: AccountTone[] = [
  { solid: '#06C755', soft: '#E8F8EE', text: '#05803A' }, // 緑
  { solid: '#2563EB', soft: '#E8EFFD', text: '#1D4ED8' }, // 青
  { solid: '#EA580C', soft: '#FDEFE6', text: '#C2410C' }, // 橙
  { solid: '#9333EA', soft: '#F3E8FD', text: '#7E22CE' }, // 紫
  { solid: '#DB2777', soft: '#FCE7F1', text: '#BE185D' }, // 桃
]

/** アカウント一覧の並び順で色を割り当てる（5件までは必ず別の色になる） */
export function accountTone(id: string | null | undefined, accounts: { id: string }[]): AccountTone {
  const i = id ? accounts.findIndex((a) => a.id === id) : -1
  if (i < 0) return { solid: '#6B7280', soft: '#F3F4F6', text: '#374151' }
  return TONES[i % TONES.length]
}

// 選んだアカウントで中身が変わる画面。ここに無い画面は全アカウント共通
// （タグ・テンプレート・フォームなど、アカウントの区別がないもの）。
const ACCOUNT_SCOPED_PREFIXES = [
  '/friends',
  '/chats',
  '/broadcasts',
  '/scenarios',
  '/rich-menus',
  '/reminders',
  '/auto-replies',
  '/automations',
  '/inflow-links',
  '/booking',
  '/events',
]

export type PageScope = 'account' | 'shared' | 'none'

export function pageScope(pathname: string): PageScope {
  if (pathname === '/') return 'account'
  // 設定まわりはアカウントの切替と関係しない
  if (['/accounts', '/staff', '/updates', '/friend-add-settings'].some((p) => pathname.startsWith(p))) return 'none'
  return ACCOUNT_SCOPED_PREFIXES.some((p) => pathname.startsWith(p)) ? 'account' : 'shared'
}
