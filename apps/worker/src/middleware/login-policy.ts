export type ApiKeyLoginMode = 'allow' | 'break-glass' | 'disabled';
export function apiKeyLoginMode(env: {
  API_KEY_LOGIN_MODE?: string;
}): ApiKeyLoginMode {
  const value = env.API_KEY_LOGIN_MODE?.trim();
  return !value || value === 'allow'
    ? 'allow'
    : value === 'break-glass'
      ? 'break-glass'
      : 'disabled';
}
