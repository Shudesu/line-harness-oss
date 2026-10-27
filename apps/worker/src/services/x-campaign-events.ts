import type { Context } from 'hono';
import type { Env } from '../index.js';
import { getLineAccountById, jstNow } from '@line-crm/db';
import { bodyDigest } from './harness-gate-protocol.js';
import { sendGateLineMessage } from './x-gate-line-message.js';
import { dispatchLineProxyLocally } from './local-line-proxy.js';
export async function campaignDeliveryKey(value: string) {
  const h = await bodyDigest(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function handleCampaignEvent(
  c: Context<Env>,
  event: string,
  id: string,
  raw: string,
  body: Record<string, any>,
) {
  const db = c.env.DB,
    hash = await bodyDigest(raw);
  const validId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
  if (body?.schema !== 'xh.gate.v1')
    return c.json({ success: false, error: 'Invalid schema' }, 400);
  if (
    event === 'x.campaign.digest' &&
    ((body.kind === 'budget'
      ? body.gateId !== null && !validId(body.gateId)
      : !validId(body.gateId)) ||
      typeof body.periodKey !== 'string' ||
      body.periodKey.length < 1 ||
      body.periodKey.length > 100 ||
      !Array.isArray(body.lines) ||
      body.lines.length !== 3 ||
      body.lines.some(
        (s: unknown) => typeof s !== 'string' || !s.trim() || s.length > 500 || /[\r\n]/.test(s),
      ) ||
      !['ended', 'weekly', 'budget'].includes(body.kind))
  )
    return c.json({ success: false, error: 'Invalid digest' }, 400);
  if (
    event === 'x.campaign.early_notice' &&
    (!validId(body.gateId) ||
      !Array.isArray(body.sourceGateIds) ||
      !body.sourceGateIds.length ||
      body.sourceGateIds.length > 5 ||
      body.sourceGateIds.some((s: unknown) => !validId(s)) ||
      typeof body.title !== 'string' ||
      body.title.length > 100 ||
      typeof body.entryUrl !== 'string')
  )
    return c.json({ success: false, error: 'Invalid notice' }, 400);
  const receipt = await db
    .prepare('SELECT body_hash,status,last_error FROM x_gate_inbox WHERE delivery_id=?')
    .bind(id)
    .first<{ body_hash: string; status: string; last_error: string | null }>();
  if (receipt && receipt.body_hash !== hash)
    return c.json({ success: false, error: 'Delivery conflict' }, 409);
  if (receipt?.status === 'done')
    return c.json({
      success: true,
      duplicate: true,
      skipped: receipt.last_error === 'no_eligible_admin',
    });
  await db
    .prepare(
      'INSERT OR IGNORE INTO x_gate_inbox(delivery_id,body_hash,event,payload,created_at) VALUES (?,?,?,?,?)',
    )
    .bind(id, hash, event, raw, Date.now())
    .run();
  const owner = crypto.randomUUID();
  if (
    !(await db
      .prepare(
        "UPDATE x_gate_inbox SET owner=?,lease_until=? WHERE delivery_id=? AND status='pending' AND (lease_until IS NULL OR lease_until<?) RETURNING delivery_id",
      )
      .bind(owner, Date.now() + 120000, id, Date.now())
      .first())
  )
    return c.json({ success: false, error: 'Delivery busy' }, 503);
  let skipped = false;
  try {
    if (event === 'x.campaign.digest') {
      const accounts = (
        await db
          .prepare(
            `SELECT DISTINCT line_account_id FROM x_gate_campaigns WHERE connection_id=? ${body.gateId ? 'AND gate_id=?' : ''}`,
          )
          .bind(c.env.X_HARNESS_CONNECTION_ID, ...(body.gateId ? [body.gateId] : []))
          .all<{ line_account_id: string }>()
      ).results;
      let delivered = 0;
      for (const row of accounts) {
        const setting = await db
          .prepare(
            "SELECT value FROM account_settings WHERE line_account_id=? AND key='x_campaign_digest_friend_ids'",
          )
          .bind(row.line_account_id)
          .first<{ value: string }>();
        const ids: unknown = JSON.parse(setting?.value ?? '[]');
        if (!Array.isArray(ids) || ids.length > 5 || ids.some((v) => typeof v !== 'string'))
          continue;
        const account = await getLineAccountById(db, row.line_account_id);
        if (!account?.is_active) continue;
        for (const friendId of ids) {
          const friend = await db
            .prepare(
              'SELECT line_user_id FROM friends WHERE id=? AND line_account_id=? AND is_following=1',
            )
            .bind(friendId, row.line_account_id)
            .first<{ line_user_id: string }>();
          if (!friend) continue;
          const recipientId = await campaignDeliveryKey(`${id}:${row.line_account_id}:${friendId}`);
          const done = await db
            .prepare("SELECT delivery_id FROM x_gate_inbox WHERE delivery_id=? AND status='done'")
            .bind(recipientId)
            .first();
          if (!done) {
            await sendGateLineMessage(
              account.channel_access_token,
              friend.line_user_id,
              { type: 'text', text: body.lines.join('\n') },
              {
                deliveryId: recipientId,
                proxyBaseUrl: c.env.WORKER_URL,
                dispatch: (req) => dispatchLineProxyLocally(req, c.env, c.executionCtx),
              },
            );
            await db
              .prepare(
                "INSERT OR IGNORE INTO x_gate_inbox(delivery_id,body_hash,event,payload,status,created_at,completed_at) VALUES (?,?,?,'{}','done',?,?)",
              )
              .bind(recipientId, hash, 'x.campaign.digest.recipient', Date.now(), Date.now())
              .run();
          }
          delivered++;
        }
      }
      skipped = delivered === 0;
    } else {
      const target = await db
        .prepare(
          'SELECT line_account_id,slug FROM x_gate_campaigns WHERE gate_id=? AND connection_id=?',
        )
        .bind(body.gateId, c.env.X_HARNESS_CONNECTION_ID)
        .first<{ line_account_id: string; slug: string }>();
      if (!target) throw new Error('campaign_scope_mismatch');
      const expected = new URL(`/c/${target.slug}`, c.env.X_HARNESS_URL).toString();
      if (body.entryUrl !== expected) throw new Error('notice_url_mismatch');
      const sourceIds = [...new Set<string>(body.sourceGateIds)],
        ph = sourceIds.map(() => '?').join(',');
      const sources = (
        await db
          .prepare(
            `SELECT gate_id FROM x_gate_campaigns WHERE gate_id IN (${ph}) AND connection_id=? AND line_account_id=?`,
          )
          .bind(...sourceIds, c.env.X_HARNESS_CONNECTION_ID, target.line_account_id)
          .all()
      ).results;
      if (sources.length !== sourceIds.length) throw new Error('source_scope_mismatch');
      const tagId = `x-notice:${id}`,
        broadcastId = `x-notice:${id}`,
        now = jstNow();
      const batch = [
        db
          .prepare("INSERT OR IGNORE INTO tags(id,name,color,created_at) VALUES (?,?,'#2563eb',?)")
          .bind(tagId, `x-campaign-notice:${body.gateId}`, now),
      ];
      for (const source of sourceIds)
        batch.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO friend_tags(friend_id,tag_id,assigned_at) SELECT f.id,?,? FROM friends f JOIN friend_tags ft ON ft.friend_id=f.id JOIN tags t ON t.id=ft.tag_id WHERE t.id=? AND f.line_account_id=? AND f.is_following=1`,
            )
            .bind(tagId, now, `gate_followup_optin:${source}`, target.line_account_id),
        );
      batch.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,status,line_account_id,created_at) VALUES (?,?,'text',?,'tag',?,'draft',?,?)",
          )
          .bind(
            broadcastId,
            body.title,
            `${body.title}\n${body.entryUrl}`,
            tagId,
            target.line_account_id,
            now,
          ),
      );
      await db.batch(batch); // Never schedule or send; existing approval flow owns delivery.
    }
    await db
      .prepare(
        "UPDATE x_gate_inbox SET status='done',completed_at=?,last_error=?,owner=NULL,lease_until=NULL WHERE delivery_id=? AND owner=?",
      )
      .bind(Date.now(), skipped ? 'no_eligible_admin' : null, id, owner)
      .run();
    return c.json({ success: true, skipped });
  } catch {
    await db
      .prepare(
        "UPDATE x_gate_inbox SET last_error='campaign_delivery_failed',owner=NULL,lease_until=NULL WHERE delivery_id=? AND owner=?",
      )
      .bind(id, owner)
      .run();
    return c.json({ success: false, error: 'Campaign delivery pending' }, 503);
  }
}
