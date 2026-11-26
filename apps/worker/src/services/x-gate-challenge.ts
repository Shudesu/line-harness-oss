import type { Env } from '../index.js';
export async function verifyGateChallenge(
  env: Env['Bindings'],
  gateId: string,
  token: unknown,
  ip?: string,
): Promise<boolean> {
  if (
    !env.X_GATE_TURNSTILE_SECRET_KEY ||
    typeof token !== 'string' ||
    token.length < 1 ||
    token.length > 2048
  )
    return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.X_GATE_TURNSTILE_SECRET_KEY,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
        idempotency_key: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as {
      success?: boolean;
      action?: string;
      cdata?: string;
      hostname?: string;
    };
    const hosts = new Set([
      new URL(env.WORKER_URL).hostname,
      ...(env.X_GATE_TURNSTILE_HOSTNAMES ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ]);
    return (
      result.success === true &&
      result.action === 'x_gate_join' &&
      result.cdata === gateId &&
      !!result.hostname &&
      hosts.has(result.hostname)
    );
  } catch {
    return false;
  }
}
