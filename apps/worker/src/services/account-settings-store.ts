import {
  decryptSettingValue,
  encryptSettingValue,
  isEncryptedSettingValue,
  maskSettingValue,
  type SettingsEnv,
} from './encrypted-settings.js';

export type SettingCategory = 'discord' | 'email' | 'provider' | 'system';

export type SettingDefinition = {
  key: string;
  label: string;
  category: SettingCategory;
  secret: boolean;
  description: string;
};

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'discord.webhook_url',
    label: 'Discord共通Webhook URL',
    category: 'discord',
    secret: true,
    description: '個別Webhookが未設定のときに使う共通通知先です。',
  },
  {
    key: 'discord.reservation_webhook_url',
    label: 'Discord予約通知Webhook URL',
    category: 'discord',
    secret: true,
    description: '新規予約・キャンセル・来園済み通知の送信先です。',
  },
  {
    key: 'discord.daily_webhook_url',
    label: 'Discord当日予約Webhook URL',
    category: 'discord',
    secret: true,
    description: '朝の当日予約サマリーの送信先です。',
  },
  {
    key: 'discord.review_webhook_url',
    label: 'Discord要確認Webhook URL',
    category: 'discord',
    secret: true,
    description: 'じゃらん/Gmail取り込みの要確認・失敗通知の送信先です。',
  },
  {
    key: 'discord.form_webhook_url',
    label: 'Discordフォーム回答Webhook URL',
    category: 'discord',
    secret: true,
    description: 'フォーム回答が送信されたときの通知先です。',
  },
  {
    key: 'discord.reservation_thread_id',
    label: 'Discord予約通知スレッドID',
    category: 'discord',
    secret: false,
    description: '同じチャンネル内で予約通知を分ける場合に設定します。',
  },
  {
    key: 'discord.daily_thread_id',
    label: 'Discord当日予約スレッドID',
    category: 'discord',
    secret: false,
    description: '同じチャンネル内で当日予約サマリーを分ける場合に設定します。',
  },
  {
    key: 'discord.review_thread_id',
    label: 'Discord要確認スレッドID',
    category: 'discord',
    secret: false,
    description: '同じチャンネル内で要確認通知を分ける場合に設定します。',
  },
  {
    key: 'discord.form_thread_id',
    label: 'Discordフォーム回答スレッドID',
    category: 'discord',
    secret: false,
    description: '同じチャンネル内でフォーム回答通知を分ける場合に設定します。',
  },
  {
    key: 'email.resend_api_key',
    label: 'Resend API Key',
    category: 'email',
    secret: true,
    description: 'Web予約確認メールなどをResendで送るためのAPIキーです。',
  },
  {
    key: 'email.from_email',
    label: '送信元メールアドレス',
    category: 'email',
    secret: false,
    description: '予約確認メールのFromに使います。',
  },
  {
    key: 'email.from_name',
    label: '送信者名',
    category: 'email',
    secret: false,
    description: '予約確認メールの表示名に使います。',
  },
  {
    key: 'email.reply_to',
    label: '返信先メールアドレス',
    category: 'email',
    secret: false,
    description: '顧客がメールに返信した場合の受信先です。',
  },
];

export const SETTING_DEFINITION_MAP = new Map(SETTING_DEFINITIONS.map((item) => [item.key, item]));

export function settingScope(accountId?: string | null): string {
  return accountId?.trim() || 'system';
}

export function serializeStoredSettingValue(definition: SettingDefinition, rawValue: string | null) {
  if (rawValue === null) {
    return { value: '', configured: false, encrypted: false };
  }
  return {
    value: definition.secret ? maskSettingValue(rawValue) : rawValue,
    configured: rawValue.trim().length > 0,
    encrypted: isEncryptedSettingValue(rawValue),
  };
}

export async function getAccountSetting(
  db: D1Database,
  env: SettingsEnv,
  key: string,
  accountId?: string | null,
): Promise<string> {
  const definition = SETTING_DEFINITION_MAP.get(key);
  if (!definition) throw new Error(`Unknown settings key: ${key}`);

  const row = await db
    .prepare(`SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?`)
    .bind(settingScope(accountId), key)
    .first<{ value: string }>();
  if (!row?.value) return '';
  return definition.secret ? decryptSettingValue(row.value, env) : row.value;
}

export async function setAccountSetting(
  db: D1Database,
  env: SettingsEnv,
  key: string,
  value: string,
  accountId?: string | null,
): Promise<{ configured: boolean; encrypted: boolean }> {
  const definition = SETTING_DEFINITION_MAP.get(key);
  if (!definition) throw new Error(`Unknown settings key: ${key}`);

  const scope = settingScope(accountId);
  const normalized = value.trim();
  if (!normalized) {
    await db
      .prepare(`DELETE FROM account_settings WHERE line_account_id = ? AND key = ?`)
      .bind(scope, key)
      .run();
    return { configured: false, encrypted: false };
  }

  const storedValue = definition.secret ? await encryptSettingValue(normalized, env) : normalized;
  const id = crypto.randomUUID();
  const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');
  await db
    .prepare(
      `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (line_account_id, key)
       DO UPDATE SET value = ?, updated_at = ?`,
    )
    .bind(id, scope, key, storedValue, now, now, storedValue, now)
    .run();
  return { configured: true, encrypted: isEncryptedSettingValue(storedValue) };
}
