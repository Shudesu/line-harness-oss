const INTERNAL_LIFF_PARAMS = new Set([
  'liffId',
  'liff.state',
  'liff.referrer',
  'liff.source',
]);

export interface LiffLaunchUrls {
  canonical: string;
  ios: string;
  android: string;
}

/**
 * Preserve campaign/ad parameters while removing LIFF's internal redirect
 * parameters. On the primary redirect, the user-supplied path/query is packed
 * into liff.state; after the secondary redirect it is already on currentUrl.
 */
export function buildLiffLaunchUrls(currentUrl: string, liffId: string): LiffLaunchUrls {
  const current = new URL(currentUrl);
  const state = current.searchParams.get('liff.state');
  const stateUrl = state ? new URL(state, current.origin) : null;
  const path = stateUrl?.pathname && stateUrl.pathname !== '/'
    ? stateUrl.pathname
    : current.pathname === '/' ? '' : current.pathname;
  const params = new URLSearchParams();

  for (const [key, value] of current.searchParams) {
    if (!INTERNAL_LIFF_PARAMS.has(key)) params.append(key, value);
  }
  if (stateUrl) {
    for (const [key, value] of stateUrl.searchParams) {
      if (!INTERNAL_LIFF_PARAMS.has(key)) params.set(key, value);
    }
  }

  const query = params.toString();
  const suffix = `${path}${query ? `?${query}` : ''}`;
  const canonical = `https://liff.line.me/${liffId}${suffix}`;

  return {
    canonical,
    // LINE's custom scheme is deprecated, but remains the only reliable iOS
    // Safari hand-off used by L-Step. The canonical URL stays available as a
    // fallback and can replace it once iOS universal-link behavior permits.
    ios: `line://app/${liffId}${suffix}`,
    android:
      `intent://liff.line.me/${liffId}${suffix}`
      + '#Intent;scheme=https;action=android.intent.action.VIEW;'
      + 'category=android.intent.category.BROWSABLE;package=jp.naver.line.android;end',
  };
}
