import type { Env } from '../index.js';
import { callXGate } from './x-gate-client.js';
import { jstNow } from '@line-crm/db';
export async function acceptXGateFollowup(
  env: Env['Bindings'],
  gateId: string,
  friendId: string,
  accountId: string,
) {
  const entry = await env.DB.prepare(
    "SELECT result FROM x_gate_entries WHERE gate_id=? AND friend_id=? AND line_account_id=? AND state='lost'",
  )
    .bind(gateId, friendId, accountId)
    .first<{ result: string }>();
  if (!entry) throw new Error('followup_unavailable');
  const result = await callXGate(env, '/api/integrations/line-harness/events', 'line.gate.event', {
    gateId,
    lineFriendId: friendId,
    type: 'followup_opt_in',
    sourceId: `followup:${friendId}`,
  });
  const data = result.data as unknown as {
    offer: string;
    coupon: { label: string; value: string; type: string } | null;
  };
  if (
    !['coupon', 'early_notice', 'both'].includes(data.offer) ||
    (data.coupon &&
      (typeof data.coupon.label !== 'string' || typeof data.coupon.value !== 'string'))
  )
    throw new Error('invalid_followup');
  const batch: D1PreparedStatement[] = [];
  if (data.offer !== 'coupon') {
    const tag = `gate_followup_optin:${gateId}`;
    batch.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO tags(id,name,color,created_at) VALUES (?,?,'#2563eb',?)",
      ).bind(tag, tag, jstNow()),
      env.DB.prepare(
        'INSERT OR IGNORE INTO friend_tags(friend_id,tag_id,assigned_at) VALUES (?,?,?)',
      ).bind(friendId, tag, jstNow()),
    );
  }
  const saved = JSON.parse(entry.result || '{}');
  batch.push(
    env.DB.prepare('UPDATE x_gate_entries SET result=? WHERE gate_id=? AND friend_id=?').bind(
      JSON.stringify({ ...saved, followupAccepted: true, followupCoupon: data.coupon }),
      gateId,
      friendId,
    ),
  );
  await env.DB.batch(batch);
  return {
    ...data,
    status: 'lost',
    title: 'フォローの受付',
    message: data.coupon
      ? `${data.coupon.label}\n${data.coupon.value}`
      : data.offer === 'coupon'
        ? 'クーポンは終了しました。'
        : '次回のキャンペーンをLINEでお知らせします。',
  };
}
