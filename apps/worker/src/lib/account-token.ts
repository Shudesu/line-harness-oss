/**
 * Phase 1-G: line_accounts.channel_access_token を安全に取り出すヘルパ。
 *
 * 全ての LineClient 生成サイトでこの関数を通してから token を渡すことで、
 * 暗号化されている行も平文の行も透過的に扱える。
 *
 * - キー (LINE_TOKEN_ENC_KEY) 未設定 + 平文行: そのまま返す (既存挙動と同じ)
 * - キー設定済 + 平文行: そのまま返す (まだ migrate されていない)
 * - キー設定済 + 暗号化行: 復号して返す
 * - キー未設定 + 暗号化行: 例外 (運用ミスをハードに検知させる)
 */

import { decryptToken } from './token-crypto.js';

interface MinEnv {
  LINE_TOKEN_ENC_KEY?: string;
}

export async function resolveAccessToken(
  env: MinEnv,
  encryptedOrPlain: string | null | undefined,
): Promise<string> {
  if (!encryptedOrPlain) return '';
  const result = await decryptToken(encryptedOrPlain, env.LINE_TOKEN_ENC_KEY);
  return result ?? '';
}
