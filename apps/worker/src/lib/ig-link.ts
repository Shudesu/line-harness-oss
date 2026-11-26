import { verifyIgLinkToken, type IgLinkPayload, type IgLinkTokenEnv } from '@line-crm/shared';

export interface ResolvedIgLink {
  igsid: string;
  token?: IgLinkPayload;
  awardMileage: boolean;
}
/** No token/secret or caller-controlled value may be logged here. */
export async function resolveIgLink(env: IgLinkTokenEnv, input: { ig?: unknown; igt?: unknown }): Promise<ResolvedIgLink | null> {
  if (input.igt !== undefined) {
    const token = await verifyIgLinkToken(env, input.igt);
    if (!token) {
      console.warn('[ig-link] invalid_token');
      return null; // Never fall back to an unsigned ig when a token is invalid.
    }
    return { igsid: token.igsid, token, awardMileage: true };
  }
  const igsid = typeof input.ig === 'string' ? input.ig : '';
  const policy = env.IG_LINK_TOKEN_POLICY || 'off';
  if (policy === 'require') {
    if (igsid) console.warn('[ig-link] unsigned_ig_param');
    return null;
  }
  if (policy === 'prefer' && igsid) console.warn('[ig-link] unsigned_ig_param');
  return { igsid, awardMileage: policy === 'off' };
}
