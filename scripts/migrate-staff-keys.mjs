/** Existing self-hosters run this AFTER SQL migration and Worker upgrade.
 * Secrets come from the environment, never CLI arguments or output. */
const base = new URL(process.env.HARNESS_WORKER_URL ?? '');
if (base.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) {
  throw new Error('Use an HTTPS Worker URL');
}
const key = process.env.HARNESS_OWNER_API_KEY;
if (!key) throw new Error('HARNESS_OWNER_API_KEY is required');
let total = 0;
for (let batch = 0; batch < 1000; batch++) {
  const response = await fetch(new URL('/api/auth/migrate-keys', base), {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Migration stopped (HTTP ${response.status}); check server configuration before resuming`);
  const body = await response.json();
  const count = body?.data?.migrated;
  if (!Number.isInteger(count) || count < 0 || count > 25) throw new Error('Unexpected migration result');
  total += count;
  if (count === 0) {
    console.log(`Backfill complete: ${total} keys converted. Original client credentials remain valid.`);
    process.exit(0);
  }
}
throw new Error('Bounded migration batch limit reached; rerun to continue');
