import type { ApiBroadcast } from './api';
import type { BadgeVariant } from '@cloudflare/kumo/components/badge';

export function broadcastStatus(broadcast: Pick<ApiBroadcast, 'status' | 'lastError' | 'failedAccountIds'>): { label: string; variant: BadgeVariant } {
  if (broadcast.status === 'sent' && (broadcast.lastError || broadcast.failedAccountIds?.length)) {
    return { label: '要確認', variant: 'warning' };
  }
  if (broadcast.status === 'sending' && broadcast.lastError) {
    return { label: '送信中・要確認', variant: 'warning' };
  }
  return {
    draft: { label: '下書き', variant: 'neutral' },
    scheduled: { label: '予約済み', variant: 'info' },
    sending: { label: '送信中', variant: 'warning' },
    sent: { label: '送信完了', variant: 'success' },
  }[broadcast.status] as { label: string; variant: BadgeVariant };
}
