// LINE が同じ知らせを送り直したとき（返事が届かなかったと LINE が判断したとき）に、2回目を処理しないための覚え。
// 知らせごとの番号 webhookEventId を受け取った順に残し、同じ番号が来たら飛ばす（あいさつ・回答などの二重送信を防ぐ）。
// 表は使うときに無ければ作る（同じ中身を migrations/052 にも置いている）。覚えは7日で消す。
let tableReady = false;

const KEEP_MS = 7 * 24 * 60 * 60_000;

/** テスト用：表を作ったかどうかの覚えを消す */
export function resetWebhookEventsSeenFlag(): void {
  tableReady = false;
}

/**
 * この知らせを初めて受け取ったなら true（処理してよい）、前に受け取った番号なら false。
 * 番号が無いとき・覚えの読み書きに失敗したときは true にして、今までどおり処理する。
 */
export async function claimWebhookEvent(
  db: D1Database,
  eventId: string | null | undefined,
  opts: { now?: number; prune?: boolean } = {},
): Promise<boolean> {
  if (!eventId) return true;
  const now = opts.now ?? Date.now();
  try {
    if (!tableReady) {
      await db
        .prepare('CREATE TABLE IF NOT EXISTS webhook_events_seen (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)')
        .run();
      await db
        .prepare('CREATE INDEX IF NOT EXISTS idx_webhook_events_seen_received ON webhook_events_seen (received_at)')
        .run();
      tableReady = true;
    }
    const result = await db
      .prepare('INSERT OR IGNORE INTO webhook_events_seen (id, received_at) VALUES (?, ?)')
      .bind(eventId, now)
      .run();
    // 古い覚えの片付けはたまにだけ（毎回やると知らせのたびに消す処理が走る）
    if (opts.prune ?? Math.random() < 0.01) {
      await db.prepare('DELETE FROM webhook_events_seen WHERE received_at < ?').bind(now - KEEP_MS).run();
    }
    return (result.meta?.changes ?? 1) > 0;
  } catch (err) {
    console.error('[webhook-dedupe] failed to check event id', err);
    return true;
  }
}
