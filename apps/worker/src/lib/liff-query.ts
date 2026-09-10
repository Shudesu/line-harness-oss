type DirectQueryReader = (key: string) => string | undefined;

/**
 * LIFF puts its additional path/query/fragment in liff.state. Read only the
 * query part as fallback; never rewrite liff.state or the request URL.
 * Hono has decoded the outer value already, so do not decode it again.
 */
export function createLiffQueryReader(readDirect: DirectQueryReader): (key: string) => string {
  const state = (readDirect('liff.state') ?? '').split('#', 1)[0];
  const queryStart = state.indexOf('?');
  // Additional LIFF information is a path, not an absolute/protocol-relative URL.
  const hasAuthority = /^\s*(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(state);
  // URLSearchParams itself removes one leading '?'. Keep the delimiter so a
  // second '?' stays part of the first key, just as it does in a direct URL.
  const stateParams = new URLSearchParams(!hasAuthority && queryStart >= 0 ? state.slice(queryStart) : '');

  // A present empty direct value deliberately overrides a value hidden in state.
  // Both Hono.query and URLSearchParams.get retain first-value duplicate semantics.
  return (key) => readDirect(key) ?? stateParams.get(key) ?? '';
}
