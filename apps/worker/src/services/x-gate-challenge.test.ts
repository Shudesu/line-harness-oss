import { afterEach, it, expect, vi } from 'vitest';
import { verifyGateChallenge } from './x-gate-challenge.js';
const env = {
  WORKER_URL: 'https://line.example',
  X_GATE_TURNSTILE_SECRET_KEY: 'synthetic-secret',
} as any;
afterEach(() => vi.unstubAllGlobals());
it('requires server-side proof tied to gate, action and deployment hostname', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        success: true,
        action: 'x_gate_join',
        cdata: 'gate',
        hostname: 'line.example',
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        success: true,
        action: 'x_gate_join',
        cdata: 'another',
        hostname: 'line.example',
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        success: true,
        action: 'x_gate_join',
        cdata: 'gate',
        hostname: 'attacker.example',
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  expect(await verifyGateChallenge(env, 'gate', 'synthetic-token')).toBe(true);
  expect(await verifyGateChallenge(env, 'gate', 'synthetic-token')).toBe(false);
  expect(await verifyGateChallenge(env, 'gate', 'synthetic-token')).toBe(false);
});
it('fails closed for a missing, oversized or unavailable challenge response', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  expect(await verifyGateChallenge(env, 'gate', undefined)).toBe(false);
  expect(await verifyGateChallenge(env, 'gate', 'x'.repeat(2049))).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await verifyGateChallenge(env, 'gate', 'synthetic')).toBe(false);
});
