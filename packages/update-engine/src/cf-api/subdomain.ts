import type { CfApiCreds } from '../types.js';
import { authHeader, readBodyExcerpt } from './_shared.js';

/**
 * Cloudflare error codes for the workers.dev subdomain endpoints, as used by
 * wrangler itself (packages/deploy-helpers/src/triggers/subdomain.ts in
 * cloudflare/workers-sdk):
 *   - 10007: no subdomain registered on the account (GET "not found")
 *   - 10031: subdomain name is unavailable / already taken (PUT)
 */
const CF_ERROR_SUBDOMAIN_NOT_FOUND = 10007;
const CF_ERROR_SUBDOMAIN_UNAVAILABLE = 10031;

/** Thrown by {@link putWorkersSubdomain} when the requested name is taken. */
export class SubdomainConflictError extends Error {
  constructor(subdomain: string) {
    super(`workers.dev subdomain "${subdomain}" is unavailable (already taken)`);
    this.name = 'SubdomainConflictError';
  }
}

interface CfEnvelope {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: { subdomain?: string | null } | null;
}

function workersSubdomainApiUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
}

/**
 * Parse a CF API response body without assuming it is valid JSON — 5xx
 * responses can be a wall-of-HTML error page. Returns null when unparsable.
 */
async function parseEnvelope(res: Response): Promise<{ envelope: CfEnvelope | null; raw: string }> {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    return { envelope: null, raw: '' };
  }
  try {
    return { envelope: JSON.parse(raw) as CfEnvelope, raw };
  } catch {
    return { envelope: null, raw };
  }
}

function hasErrorCode(envelope: CfEnvelope | null, code: number): boolean {
  return envelope?.errors?.some((e) => e.code === code) ?? false;
}

function excerpt(raw: string): string {
  return raw.length > 500 ? raw.slice(0, 500) + '…' : raw;
}

/**
 * Fetch the account-level workers.dev subdomain.
 *
 * Returns the bare subdomain name (`"example"` for
 * `https://<worker>.example.workers.dev`) or `null` when the account has not
 * registered one yet (CF answers 404 with error code 10007). Any other
 * non-2xx — including auth failures — throws so callers can distinguish
 * "definitely unregistered" from "could not check".
 */
export async function getWorkersSubdomain(opts: {
  creds: CfApiCreds;
}): Promise<string | null> {
  const { creds } = opts;
  const res = await fetch(workersSubdomainApiUrl(creds.accountId), {
    method: 'GET',
    headers: authHeader(creds.apiToken),
  });

  const { envelope, raw } = await parseEnvelope(res);

  if (res.ok) {
    const subdomain = envelope?.result?.subdomain;
    return typeof subdomain === 'string' && subdomain.length > 0 ? subdomain : null;
  }

  if (hasErrorCode(envelope, CF_ERROR_SUBDOMAIN_NOT_FOUND)) {
    return null;
  }

  throw new Error(`GET workers subdomain failed: HTTP ${res.status} ${excerpt(raw)}`);
}

/**
 * Register the account-level workers.dev subdomain.
 *
 * workers.dev names are globally first-come-first-served: a taken name is
 * reported via error code 10031 (or HTTP 409) and surfaces as
 * {@link SubdomainConflictError} so callers can re-prompt for another name.
 * Any other failure (permissions, network, 5xx) throws a plain Error.
 */
export async function putWorkersSubdomain(opts: {
  creds: CfApiCreds;
  subdomain: string;
}): Promise<void> {
  const { creds, subdomain } = opts;
  const res = await fetch(workersSubdomainApiUrl(creds.accountId), {
    method: 'PUT',
    headers: {
      ...authHeader(creds.apiToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subdomain }),
  });

  if (res.ok) {
    // Drain the body so the connection can be reused.
    await readBodyExcerpt(res);
    return;
  }

  const { envelope, raw } = await parseEnvelope(res);
  if (res.status === 409 || hasErrorCode(envelope, CF_ERROR_SUBDOMAIN_UNAVAILABLE)) {
    throw new SubdomainConflictError(subdomain);
  }

  throw new Error(`PUT workers subdomain failed: HTTP ${res.status} ${excerpt(raw)}`);
}
