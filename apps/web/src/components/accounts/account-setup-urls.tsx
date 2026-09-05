import { ClipboardText } from '@cloudflare/kumo/components/clipboard-text'
import { Input } from '@cloudflare/kumo/components/input'
import { getApiBase } from '@/lib/api-base'

interface Props {
  liffId: string | null
  // Heading shown above the URL list. Defaults to a registration-friendly
  // wording ("以下を LINE Developers Console に貼ってください") but the edit
  // modal can override it to "現在の設定値".
  heading?: string
}

// Worker base URL for webhook / OAuth / LIFF endpoint registration.
// In production this is something like https://your-worker.your-subdomain.workers.dev,
// or (shared build, same origin as the admin) resolved from the browser's own
// origin — see getApiBase() in '@/lib/api-base' for the precedence rule.
function workerBase(): string {
  const url = getApiBase()
  if (!url) return ''
  return url.replace(/\/$/, '')
}

export default function AccountSetupUrls({ liffId, heading }: Props) {
  const base = workerBase()
  const webhookUrl = base ? `${base}/webhook` : ''
  const callbackUrl = base ? `${base}/auth/callback` : ''
  // For multi-account, every LIFF endpoint URL must include `?liffId=` so the
  // LIFF page knows which account to init for. Without it, the LIFF page
  // falls back to VITE_LIFF_ID (account ①) and non-default accounts hit an
  // auth loop. See memory: liff-endpoint-url-rule.md.
  const liffEndpointUrl = base && liffId ? `${base}?liffId=${encodeURIComponent(liffId)}` : ''

  return (
    <div className="space-y-3 mt-4 pt-4 border-t border-gray-100">
      <p className="text-xs font-medium text-gray-700">
        {heading ?? 'LINE Developers Console に登録すべき URL'}
      </p>
      <div className="space-y-2">
        <UrlRow label="Webhook URL" hint="Messaging API channel に貼る" url={webhookUrl} />
        <UrlRow
          label="Callback URL"
          hint="LINE Login channel の Callback URL に貼る"
          url={callbackUrl}
        />
        <UrlRow
          label="LIFF Endpoint URL"
          hint={
            liffId
              ? '?liffId= 付き — LIFF 設定画面に貼る'
              : 'LIFF ID 入力後に表示されます'
          }
          url={liffEndpointUrl}
        />
      </div>
    </div>
  )
}

function UrlRow({ label, hint, url }: { label: string; hint: string; url: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-kumo-default">{label}</span>
        <span className="text-right text-[10px] text-kumo-subtle">{hint}</span>
      </div>
      {url ? (
        <ClipboardText size="sm" text={url} tooltip={{ text: 'コピー', copiedText: 'コピーしました' }} labels={{ copyAction: `${label}をコピー` }} />
      ) : (
        <Input aria-label={label} size="sm" value="" placeholder="—" disabled readOnly />
      )}
    </div>
  )
}
