import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';
import { claimLineSend, failLineSend, completeLineSend, LINE_RETRY_WINDOW_MS, addScore } from '@line-crm/db';
import { runIdempotentLineSend } from './idempotent-line-send.js';
import { sqliteD1 } from '../test-support/sqlite-d1.js';

let fixture: ReturnType<typeof sqliteD1>;
const start = 1_800_000_000_000;
const input = {
  id: 'synthetic-action', retryKey: '00000000-0000-5000-8000-000000000000',
  accessToken: 'synthetic-token', accountId: 'synthetic-account', to: 'synthetic-recipient',
  messages: [{ type: 'text' as const, text: 'Original' }],
};
beforeEach(() => {
  fixture = sqliteD1();
  fixture.sqlite.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
  vi.spyOn(Date, 'now').mockReturnValue(start);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  fixture.sqlite.close();
});

it('freezes the payload and first start across an uncertain failure; deduplicates within 24h', async () => {
  const accepted = new Set<string>();
  let deliveries = 0;
  const requests: unknown[] = [];
  vi.spyOn(LineClient.prototype, 'request').mockImplementation(async (_method, _path, body, headers) => {
    requests.push(body);
    if (!accepted.has(headers!['X-Line-Retry-Key'])) {
      deliveries++;
      accepted.add(headers!['X-Line-Retry-Key']);
    }
    return { data: {}, headers: new Headers() };
  });
  const log = vi.fn().mockRejectedValueOnce(new Error('Synthetic log failure')).mockResolvedValue(undefined);
  await expect(runIdempotentLineSend(fixture.db, input, log)).rejects.toThrow('log failure');
  vi.mocked(Date.now).mockReturnValue(start + 23 * 3_600_000);
  await runIdempotentLineSend(fixture.db, { ...input, messages: [{ type: 'text', text: 'Template changed' }] }, log);
  expect(deliveries).toBe(1);
  expect(requests[1]).toEqual(requests[0]);
  expect(log.mock.calls[1][0]).toEqual(input.messages);
  expect((fixture.sqlite.prepare('SELECT request_body FROM api_line_sends').get() as { request_body: string }).request_body)
    .not.toContain(input.accessToken);
  expect(fixture.sqlite.prepare('SELECT first_started_at,status FROM api_line_sends').get())
    .toEqual({ first_started_at: start, status: 'completed' });
  vi.mocked(Date.now).mockReturnValue(start + 30 * LINE_RETRY_WINDOW_MS);
  await runIdempotentLineSend(fixture.db, input, log);
  expect(requests).toHaveLength(2);
  expect(log).toHaveBeenCalledTimes(2);
});

it.each(['sending', 'retryable'])('requires review at the exact 24h boundary for %s state', async (state) => {
  const claim = await claimLineSend(fixture.db, input.id, JSON.stringify(input), start);
  if (claim.state !== 'claimed') throw new Error('Expected claim');
  if (state === 'retryable') await failLineSend(fixture.db, input.id, claim.token);
  const request = vi.spyOn(LineClient.prototype, 'request');
  const log = vi.fn();
  vi.mocked(Date.now).mockReturnValue(start + LINE_RETRY_WINDOW_MS);
  await expect(runIdempotentLineSend(fixture.db, input, log))
    .rejects.toMatchObject({ code: 'line_delivery_requires_review' });
  expect(request).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

it('does not reclaim a disappeared in-flight attempt even after the API lease expires', async () => {
  const claim = await claimLineSend(fixture.db, input.id, JSON.stringify(input), start);
  if (claim.state !== 'claimed') throw new Error('Expected claim');
  vi.mocked(Date.now).mockReturnValue(start + 300_001);
  const request = vi.spyOn(LineClient.prototype, 'request');
  await expect(runIdempotentLineSend(fixture.db, input, vi.fn()))
    .rejects.toMatchObject({ code: 'line_send_in_progress' });
  expect(request).not.toHaveBeenCalled();
});

it('does not send a saved request with another account', async () => {
  const claim = await claimLineSend(fixture.db, input.id, JSON.stringify(input), start);
  if (claim.state !== 'claimed') throw new Error('Expected claim');
  await failLineSend(fixture.db, input.id, claim.token);
  const request = vi.spyOn(LineClient.prototype, 'request');
  await expect(runIdempotentLineSend(fixture.db, { ...input, accountId: 'another-account' }, vi.fn()))
    .rejects.toThrow('manual review');
  expect(request).not.toHaveBeenCalled();
});

it.each([100, 10_000, 100_000])('uses bounded SQL and primary-key lookups with %i unrelated sends/scores', async (rows) => {
  fixture.sqlite.exec("INSERT INTO friends(id,line_user_id) VALUES('target','synthetic-target')");
  const seed = fixture.sqlite.prepare("INSERT INTO api_line_sends VALUES(?, '{}', '', 'completed', 0)");
  const seedScore = fixture.sqlite.prepare("INSERT INTO friend_scores(id,friend_id,score_change) VALUES(?,'target',0)");
  fixture.sqlite.transaction(() => {
    for (let i = 0; i < rows; i++) { seed.run(`unrelated-${i}`); seedScore.run(`unrelated-${i}`); }
  })();
  const prepare = vi.spyOn(fixture.db, 'prepare');
  const claim = await claimLineSend(fixture.db, input.id, '{}', start);
  if (claim.state !== 'claimed') throw new Error('Expected claim');
  await failLineSend(fixture.db, input.id, claim.token);
  const retry = await claimLineSend(fixture.db, input.id, '{}', start + 1);
  if (retry.state !== 'claimed') throw new Error('Expected retry claim');
  await completeLineSend(fixture.db, input.id, retry.token);
  expect((await claimLineSend(fixture.db, input.id, '{}', start + LINE_RETRY_WINDOW_MS)).state).toBe('completed');
  expect(prepare).toHaveBeenCalledTimes(8);
  await addScore(fixture.db, { id: 'target-score', friendId: 'target', scoreChange: 10 });
  await addScore(fixture.db, { id: 'target-score', friendId: 'target', scoreChange: 10 });
  expect(prepare).toHaveBeenCalledTimes(12);
  expect(fixture.sqlite.prepare("SELECT score FROM friends WHERE id='target'").get()).toEqual({ score: 10 });
  for (const [sql] of prepare.mock.calls.filter(([sql]) => /^\s*(SELECT|UPDATE)/.test(sql))) {
    const plan = fixture.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array((sql.match(/\?/g) ?? []).length).fill(0)) as Array<{ detail: string }>;
    expect(plan.some(row => /SEARCH .* USING INDEX .*\(id=\?\)/.test(row.detail)), sql).toBe(true);
    expect(plan.some(row => /SCAN /.test(row.detail)), sql).toBe(false);
  }
});


it('checks the window again after a slow durable claim, before starting a LINE request', async () => {
  vi.mocked(Date.now).mockReturnValueOnce(start).mockReturnValue(start + 25 * 3_600_000);
  const request = vi.spyOn(LineClient.prototype, 'request');
  await expect(runIdempotentLineSend(fixture.db, input, vi.fn()))
    .rejects.toMatchObject({ code: 'line_delivery_requires_review' });
  expect(request).not.toHaveBeenCalled();
});

it('rejects stale completion/failure writes and serializes concurrent retry claims', async () => {
  const first = await claimLineSend(fixture.db, input.id, '{}', start);
  if (first.state !== 'claimed') throw new Error('Expected claim');
  await failLineSend(fixture.db, input.id, first.token);
  const retries = await Promise.all([
    claimLineSend(fixture.db, input.id, '{}', start + 1),
    claimLineSend(fixture.db, input.id, '{}', start + 1),
  ]);
  expect(retries.map(row => row.state).sort()).toEqual(['claimed', 'in_progress']);
  await completeLineSend(fixture.db, input.id, first.token);
  await failLineSend(fixture.db, input.id, first.token);
  expect(fixture.sqlite.prepare('SELECT status FROM api_line_sends WHERE id=?').get(input.id))
    .toEqual({ status: 'sending' });
  const owner = retries.find(row => row.state === 'claimed');
  if (!owner || owner.state !== 'claimed') throw new Error('Expected retry owner');
  await completeLineSend(fixture.db, input.id, owner.token);
  expect(fixture.sqlite.prepare('SELECT status FROM api_line_sends WHERE id=?').get(input.id))
    .toEqual({ status: 'completed' });
});
