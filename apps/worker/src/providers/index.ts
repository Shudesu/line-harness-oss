import { aonisaiProviderConfig } from './aonisai/config.js';
import { genericProviderConfig } from './generic/config.js';
import type { ProviderConfig } from './types.js';

const providers: Record<string, ProviderConfig> = {
  [genericProviderConfig.id]: genericProviderConfig,
  [aonisaiProviderConfig.id]: aonisaiProviderConfig,
};

export function getProviderDefaults(providerId: string | null | undefined): ProviderConfig {
  const id = providerId?.trim().toLowerCase();
  if (!id) return aonisaiProviderConfig;
  return providers[id] ?? genericProviderConfig;
}

export type { ProviderConfig };
