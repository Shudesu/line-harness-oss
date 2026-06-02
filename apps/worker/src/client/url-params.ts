export interface LocationLike {
  search: string;
  pathname: string;
  origin?: string;
}

export interface EffectiveLocationParts {
  pathname: string;
  params: URLSearchParams;
}

const LIFF_STATE_PARAM = 'liff.state';

function parseQueryString(query: string): URLSearchParams {
  return new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
}

function candidateStateValues(rawState: string): string[] {
  const values = [rawState];
  if (/%[0-9a-f]{2}/i.test(rawState)) {
    try {
      const decoded = decodeURIComponent(rawState);
      if (decoded && decoded !== rawState) values.push(decoded);
    } catch {
      // Keep the original value when percent-decoding fails.
    }
  }
  return values;
}

function parseLiffState(rawState: string | null, origin: string): EffectiveLocationParts | null {
  if (!rawState) return null;

  for (const state of candidateStateValues(rawState)) {
    const trimmed = state.trim();
    if (!trimmed) continue;

    try {
      // LINE commonly wraps the original endpoint path/query as `/?liffId=...&ref=...`.
      if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) {
        const url = new URL(trimmed, origin);
        return { pathname: url.pathname || '/', params: parseQueryString(url.search) };
      }

      // Also accept a bare query string (`?liffId=...`) or path+query (`book?liffId=...`).
      if (trimmed.startsWith('?')) {
        return { pathname: '/', params: parseQueryString(trimmed) };
      }
      if (trimmed.includes('?')) {
        const url = new URL(`/${trimmed.replace(/^\/+/, '')}`, origin);
        return { pathname: url.pathname || '/', params: parseQueryString(url.search) };
      }

      // Last fallback: treat the state as a query-string payload.
      return { pathname: '/', params: parseQueryString(trimmed) };
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function getEffectiveLocationParts(locationLike: LocationLike): EffectiveLocationParts {
  const origin = locationLike.origin || 'https://liff.local';
  const directParams = parseQueryString(locationLike.search || '');
  const stateParts = parseLiffState(directParams.get(LIFF_STATE_PARAM), origin);

  const params = new URLSearchParams(stateParts?.params ?? undefined);
  for (const [key, value] of directParams) {
    if (key === LIFF_STATE_PARAM) continue;
    params.set(key, value);
  }

  const directPathname = locationLike.pathname || '/';
  const pathname = directPathname !== '/'
    ? directPathname
    : (stateParts?.pathname || directPathname);

  return { pathname, params };
}

export function getEffectiveSearchParams(): URLSearchParams {
  return getEffectiveLocationParts(window.location).params;
}

export function getEffectivePathname(): string {
  return getEffectiveLocationParts(window.location).pathname;
}

export function getEffectiveQueryParam(name: string): string | null {
  return getEffectiveSearchParams().get(name);
}
