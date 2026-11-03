import { createRemoteJWKSet, jwtVerify } from 'jose';
export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}
export function accessConfig(
  env: AccessEnv,
): { issuer: string; audience: string } | null {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const host = env.ACCESS_TEAM_DOMAIN.trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/$/, '');
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(
      host,
    ) ||
    !env.ACCESS_AUD.trim()
  )
    return null;
  return { issuer: 'https://' + host, audience: env.ACCESS_AUD.trim() };
}
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyAccessJwt(
  token: string | undefined,
  env: AccessEnv,
): Promise<{ email: string; exp: number } | null> {
  const config = accessConfig(env);
  if (!config || !token || token.length > 16384) return null;
  try {
    let keys = keySets.get(config.issuer);
    if (!keys) {
      if (keySets.size >= 16) keySets.clear();
      keys = createRemoteJWKSet(
        new URL(config.issuer + '/cdn-cgi/access/certs'),
        {
          cacheMaxAge: 3600000,
          cooldownDuration: 30000,
          timeoutDuration: 5000,
        },
      );
      keySets.set(config.issuer, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['RS256'],
      clockTolerance: 60,
      requiredClaims: ['exp', 'iat', 'email'],
    });
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.email !== 'string' ||
      !payload.email.trim() ||
      payload.email.length > 320 ||
      typeof payload.iat !== 'number' ||
      payload.iat > now + 60 ||
      typeof payload.exp !== 'number' ||
      payload.exp <= now
    )
      return null;
    return { email: payload.email.trim().toLowerCase(), exp: payload.exp };
  } catch {
    return null;
  }
}
