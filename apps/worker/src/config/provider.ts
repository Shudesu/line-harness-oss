import type { Env } from '../index.js';
import { resolveBindingValue, type SecretLike } from '../services/bindings.js';
import { getProviderDefaults, type ProviderConfig } from '../providers/index.js';

type EnvBindings = Env['Bindings'] & Record<string, SecretLike>;

async function readEnv(env: EnvBindings, key: string): Promise<string> {
  return resolveBindingValue(env[key]);
}

function overrideString(current: string, next: string): string {
  return next.trim() || current;
}

function overrideBoolean(current: boolean, next: string): boolean {
  const normalized = next.trim().toLowerCase();
  if (!normalized) return current;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export async function resolveProviderConfig(env: Env['Bindings']): Promise<ProviderConfig> {
  const bindings = env as EnvBindings;
  const providerId = await readEnv(bindings, 'PROVIDER_ID');
  const defaults = getProviderDefaults(providerId);

  const [
    name,
    displayName,
    shortName,
    description,
    address,
    phone,
    siteUrl,
    primary,
    accent,
    background,
    text,
    logoUrl,
    heroImageUrl,
    faviconUrl,
    reservationTitle,
    introTitle,
    introBody,
    lineLinkTitle,
    lineLinkBody,
    enableCafeTab,
    enableLineLinkPanel,
    emailFromName,
    emailFooterText,
    emailHeroImageUrl,
    externalImportEnabled,
    externalImportLabel,
    externalImportProvider,
    externalImportDefaultFromEmail,
    externalImportDefaultQuery,
  ] = await Promise.all([
    readEnv(bindings, 'PROVIDER_NAME'),
    readEnv(bindings, 'PROVIDER_DISPLAY_NAME'),
    readEnv(bindings, 'PROVIDER_SHORT_NAME'),
    readEnv(bindings, 'PROVIDER_DESCRIPTION'),
    readEnv(bindings, 'PROVIDER_ADDRESS'),
    readEnv(bindings, 'PROVIDER_PHONE'),
    readEnv(bindings, 'PROVIDER_SITE_URL'),
    readEnv(bindings, 'PROVIDER_PRIMARY_COLOR'),
    readEnv(bindings, 'PROVIDER_ACCENT_COLOR'),
    readEnv(bindings, 'PROVIDER_BACKGROUND_COLOR'),
    readEnv(bindings, 'PROVIDER_TEXT_COLOR'),
    readEnv(bindings, 'PROVIDER_LOGO_URL'),
    readEnv(bindings, 'PROVIDER_HERO_IMAGE_URL'),
    readEnv(bindings, 'PROVIDER_FAVICON_URL'),
    readEnv(bindings, 'BOOKING_TITLE'),
    readEnv(bindings, 'BOOKING_INTRO_TITLE'),
    readEnv(bindings, 'BOOKING_INTRO_BODY'),
    readEnv(bindings, 'BOOKING_LINE_LINK_TITLE'),
    readEnv(bindings, 'BOOKING_LINE_LINK_BODY'),
    readEnv(bindings, 'BOOKING_ENABLE_CAFE_TAB'),
    readEnv(bindings, 'BOOKING_ENABLE_LINE_LINK_PANEL'),
    readEnv(bindings, 'EMAIL_FROM_NAME'),
    readEnv(bindings, 'EMAIL_FOOTER_TEXT'),
    readEnv(bindings, 'EMAIL_HERO_IMAGE_URL'),
    readEnv(bindings, 'EXTERNAL_IMPORT_ENABLED'),
    readEnv(bindings, 'EXTERNAL_IMPORT_LABEL'),
    readEnv(bindings, 'EXTERNAL_IMPORT_PROVIDER'),
    readEnv(bindings, 'EXTERNAL_IMPORT_DEFAULT_FROM_EMAIL'),
    readEnv(bindings, 'EXTERNAL_IMPORT_DEFAULT_QUERY'),
  ]);

  const provider: ProviderConfig = {
    ...defaults,
    name: overrideString(defaults.name, name),
    displayName: overrideString(defaults.displayName, displayName),
    shortName: overrideString(defaults.shortName, shortName),
    description: overrideString(defaults.description, description),
    address: overrideString(defaults.address, address),
    phone: overrideString(defaults.phone, phone),
    siteUrl: overrideString(defaults.siteUrl, siteUrl),
    colors: {
      primary: overrideString(defaults.colors.primary, primary),
      accent: overrideString(defaults.colors.accent, accent),
      background: overrideString(defaults.colors.background, background),
      text: overrideString(defaults.colors.text, text),
    },
    assets: {
      logoUrl: overrideString(defaults.assets.logoUrl, logoUrl),
      heroImageUrl: overrideString(defaults.assets.heroImageUrl, heroImageUrl),
      faviconUrl: overrideString(defaults.assets.faviconUrl, faviconUrl),
    },
    reservation: {
      title: overrideString(defaults.reservation.title, reservationTitle),
      introTitle: overrideString(defaults.reservation.introTitle, introTitle),
      introBody: overrideString(defaults.reservation.introBody, introBody),
      lineLinkTitle: overrideString(defaults.reservation.lineLinkTitle, lineLinkTitle),
      lineLinkBody: overrideString(defaults.reservation.lineLinkBody, lineLinkBody),
      enableCafeTab: overrideBoolean(defaults.reservation.enableCafeTab, enableCafeTab),
      enableLineLinkPanel: overrideBoolean(defaults.reservation.enableLineLinkPanel, enableLineLinkPanel),
    },
    email: {
      fromName: overrideString(defaults.email.fromName, emailFromName),
      footerText: overrideString(defaults.email.footerText, emailFooterText),
      heroImageUrl: overrideString(defaults.email.heroImageUrl, emailHeroImageUrl),
    },
    externalImport: {
      ...defaults.externalImport,
      enabled: overrideBoolean(defaults.externalImport.enabled, externalImportEnabled),
      label: overrideString(defaults.externalImport.label, externalImportLabel),
      provider: externalImportProvider === 'jalan' || externalImportProvider === 'custom' || externalImportProvider === 'none'
        ? externalImportProvider
        : defaults.externalImport.provider,
      defaultFromEmail: overrideString(defaults.externalImport.defaultFromEmail, externalImportDefaultFromEmail),
      defaultQuery: overrideString(defaults.externalImport.defaultQuery, externalImportDefaultQuery),
    },
  };

  return provider;
}
