/** Safe operator-facing text; never persist upstream response bodies or tokens. */
export const BROADCAST_RECORDING_ERROR = 'LINEでは受付済みですが、送信記録の保存に失敗しました。再送せず配信状況を確認してください。';

export class BroadcastDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BroadcastDeliveryError';
  }
}

export function isDefiniteLineRejection(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error
    && typeof error.status === 'number' && error.status >= 400 && error.status < 500;
}

export function broadcastDeliveryFailure(error: unknown): string {
  if (isDefiniteLineRejection(error)) {
    const status = (error as { status: number }).status;
    return `LINEが配信リクエストを拒否しました（HTTP ${status}）。配信状況と設定を確認してください。`;
  }
  return 'LINEの受付結果を確認できませんでした。重複配信を避けるため、再送前に配信状況を確認してください。';
}
