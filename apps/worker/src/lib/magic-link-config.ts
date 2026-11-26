import { webauthnConfig } from './webauthn-config.js';
export interface MagicLinkEnv {
  MAGIC_LINK_EMAIL_PROVIDER?: string;
  MAGIC_LINK_FROM?: string;
  RESEND_API_KEY?: string;
  MAGIC_LINK_EMAIL?: SendEmail;
  ADMIN_ORIGIN?: string;
  SECURITY_MIGRATION_STAGE?: string;
}
export const validLoginEmail = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
    value,
  );
export function magicLinkEnabled(env: MagicLinkEnv) {
  return (
    !!webauthnConfig(env) &&
    validLoginEmail(env.MAGIC_LINK_FROM) &&
    ((env.MAGIC_LINK_EMAIL_PROVIDER === 'resend' && !!env.RESEND_API_KEY) ||
      (env.MAGIC_LINK_EMAIL_PROVIDER === 'cloudflare' &&
        !!env.MAGIC_LINK_EMAIL))
  );
}
