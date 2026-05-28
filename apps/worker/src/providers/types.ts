export type ProviderColors = {
  primary: string;
  accent: string;
  background: string;
  text: string;
};

export type ProviderAssets = {
  logoUrl: string;
  heroImageUrl: string;
  faviconUrl: string;
};

export type ProviderReservationConfig = {
  title: string;
  introTitle: string;
  introBody: string;
  lineLinkTitle: string;
  lineLinkBody: string;
  enableCafeTab: boolean;
  enableLineLinkPanel: boolean;
};

export type ProviderEmailConfig = {
  fromName: string;
  footerText: string;
  heroImageUrl: string;
};

export type ProviderExternalImportConfig = {
  enabled: boolean;
  label: string;
  provider: 'jalan' | 'custom' | 'none';
  defaultFromEmail: string;
  defaultQuery: string;
  defaultLabels: {
    unprocessed: string;
    processed: string;
    review: string;
    failed: string;
  };
};

export type ProviderConfig = {
  id: string;
  name: string;
  displayName: string;
  shortName: string;
  description: string;
  address: string;
  phone: string;
  siteUrl: string;
  colors: ProviderColors;
  assets: ProviderAssets;
  reservation: ProviderReservationConfig;
  email: ProviderEmailConfig;
  externalImport: ProviderExternalImportConfig;
};
