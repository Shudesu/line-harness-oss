import { jstNow } from './utils.js';
// Stripe決済連携クエリヘルパー

export interface StripeEventRow {
  id: string;
  stripe_event_id: string;
  event_type: string;
  friend_id: string | null;
  amount: number | null;
  currency: string | null;
  metadata: string | null;
  processed_at: string;
}

export async function getStripeEvents(db: D1Database, opts: { friendId?: string; eventType?: string; limit?: number } = {}): Promise<StripeEventRow[]> {
  const limit = opts.limit ?? 100;
  if (opts.friendId) {
    const result = await db.prepare(`SELECT * FROM stripe_events WHERE friend_id = ? ORDER BY processed_at DESC LIMIT ?`)
      .bind(opts.friendId, limit).all<StripeEventRow>();
    return result.results;
  }
  if (opts.eventType) {
    const result = await db.prepare(`SELECT * FROM stripe_events WHERE event_type = ? ORDER BY processed_at DESC LIMIT ?`)
      .bind(opts.eventType, limit).all<StripeEventRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM stripe_events ORDER BY processed_at DESC LIMIT ?`)
    .bind(limit).all<StripeEventRow>();
  return result.results;
}

export async function getStripeEventByStripeId(db: D1Database, stripeEventId: string): Promise<StripeEventRow | null> {
  return db.prepare(`SELECT * FROM stripe_events WHERE stripe_event_id = ?`).bind(stripeEventId).first<StripeEventRow>();
}

export async function createStripeEvent(
  db: D1Database,
  input: { stripeEventId: string; eventType: string; friendId?: string; amount?: number; currency?: string; metadata?: string },
): Promise<StripeEventRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO stripe_events (id, stripe_event_id, event_type, friend_id, amount, currency, metadata, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.stripeEventId, input.eventType, input.friendId ?? null, input.amount ?? null, input.currency ?? null, input.metadata ?? null, now).run();
  return (await db.prepare(`SELECT * FROM stripe_events WHERE id = ?`).bind(id).first<StripeEventRow>())!;
}
