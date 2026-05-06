import { resolveBindingValue, type SecretLike } from './bindings.js';

export interface LineBindingEnv {
  LINE_CHANNEL_ACCESS_TOKEN?: SecretLike;
  LINE_CHANNEL_SECRET?: SecretLike;
  LINE_LOGIN_CHANNEL_ID?: SecretLike;
  LINE_LOGIN_CHANNEL_SECRET?: SecretLike;
  LIFF_URL?: SecretLike;
  WORKER_URL?: SecretLike;
}

export async function defaultLineAccessToken(env: LineBindingEnv): Promise<string> {
  return resolveBindingValue(env.LINE_CHANNEL_ACCESS_TOKEN);
}

export async function defaultLineChannelSecret(env: LineBindingEnv): Promise<string> {
  return resolveBindingValue(env.LINE_CHANNEL_SECRET);
}

export async function defaultLineLoginChannelId(env: LineBindingEnv): Promise<string> {
  return resolveBindingValue(env.LINE_LOGIN_CHANNEL_ID);
}

export async function defaultLineLoginChannelSecret(env: LineBindingEnv): Promise<string> {
  return resolveBindingValue(env.LINE_LOGIN_CHANNEL_SECRET);
}

export async function defaultLiffUrl(env: LineBindingEnv): Promise<string> {
  return resolveBindingValue(env.LIFF_URL);
}

export async function workerBaseUrl(env: LineBindingEnv, requestUrl?: string): Promise<string> {
  return (await resolveBindingValue(env.WORKER_URL)) || (requestUrl ? new URL(requestUrl).origin : '');
}
