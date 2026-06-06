/**
 * Phase 1-G: Channel Access Token 暗号化
 *
 * line_accounts.channel_access_token は LINE Messaging API への push 権限を持つ高価値シークレット。
 * D1 に平文保存していると、DB ダンプ流出時に LINE OA を乗っ取られる。
 *
 * 設計:
 *  - 暗号化キー: Worker secret `LINE_TOKEN_ENC_KEY` (32 byte / base64)
 *    `wrangler secret put LINE_TOKEN_ENC_KEY` で設定。
 *  - 平文を「enc1:<iv_b64>:<ciphertext_b64>」フォーマットで保存。
 *  - 復号時にプレフィックス無しなら平文として返す (=後方互換、既存平文行も読める)。
 *  - キー未設定なら平文のまま (=機能無効化、既存挙動と一致)。
 *
 * AES-GCM (256bit) を採用。Web Crypto は Cloudflare Worker でフル対応。
 *
 * ローテーション戦略:
 *  - 旧キーで復号 → 新キーで暗号化、を全行に対して走らせる管理 API (/admin/rotate-token-key) を別途用意。
 */

const PREFIX = 'enc1:';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

let importedKeyCache: { rawB64: string; key: CryptoKey } | null = null;

async function getKey(rawKeyB64: string): Promise<CryptoKey> {
  if (importedKeyCache && importedKeyCache.rawB64 === rawKeyB64) {
    return importedKeyCache.key;
  }
  const raw = base64ToBytes(rawKeyB64);
  if (raw.length !== 32) {
    throw new Error(
      `LINE_TOKEN_ENC_KEY は 32 byte (base64 で 44 文字程度) である必要があります。実際: ${raw.length} byte`,
    );
  }
  const key = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  importedKeyCache = { rawB64: rawKeyB64, key };
  return key;
}

export function isEncrypted(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return false;
  // Codex 指摘 (中): prefix だけだと偶然 "enc1:" で始まる平文を暗号文と誤認しうる。
  // フォーマット (enc1:<iv_b64>:<ciphertext_b64>) を厳密に検証する。
  // IV: 12 bytes → base64 16 文字。CT: 最低 16 bytes (タグ含む) → base64 24 文字以上。
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 2) return false;
  const [ivB64, ctB64] = parts;
  if (ivB64.length !== 16) return false;
  if (ctB64.length < 24) return false;
  // base64 URL-safe ではない標準 base64 のみ受理
  const b64re = /^[A-Za-z0-9+/]+=*$/;
  if (!b64re.test(ivB64) || !b64re.test(ctB64)) return false;
  return true;
}

export async function encryptToken(
  plaintext: string,
  rawKeyB64: string | undefined,
): Promise<string> {
  if (!rawKeyB64 || rawKeyB64.length === 0) return plaintext; // キー未設定 → 平文のまま
  if (isEncrypted(plaintext)) return plaintext; // 既に暗号文 (二重暗号化防止)
  const key = await getKey(rawKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext),
  );
  return `${PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptToken(
  value: string | null | undefined,
  rawKeyB64: string | undefined,
): Promise<string | null> {
  if (!value) return null;
  if (!isEncrypted(value)) return value; // 平文行は素通し
  if (!rawKeyB64 || rawKeyB64.length === 0) {
    throw new Error('暗号化トークンを読もうとしましたが LINE_TOKEN_ENC_KEY が未設定です');
  }
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 2) {
    throw new Error('暗号化トークンのフォーマットが不正です');
  }
  const iv = base64ToBytes(parts[0]);
  const ct = base64ToBytes(parts[1]);
  const key = await getKey(rawKeyB64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plain);
}

/**
 * 既存の平文 token を一括暗号化する管理ユースケース用。
 * 戻り値: {scanned, encrypted, skipped}
 * skipped = 既に暗号化済みのもの。
 */
export async function bulkEncryptLineAccountTokens(
  db: D1Database,
  rawKeyB64: string | undefined,
): Promise<{ scanned: number; encrypted: number; skipped: number; errors: number }> {
  if (!rawKeyB64) {
    return { scanned: 0, encrypted: 0, skipped: 0, errors: 0 };
  }
  const rows = await db
    .prepare(
      'SELECT id, channel_access_token FROM line_accounts WHERE channel_access_token IS NOT NULL',
    )
    .all<{ id: string; channel_access_token: string }>();
  let encrypted = 0;
  let skipped = 0;
  let errors = 0;
  for (const row of rows.results ?? []) {
    if (isEncrypted(row.channel_access_token)) {
      skipped++;
      continue;
    }
    try {
      const encryptedToken = await encryptToken(row.channel_access_token, rawKeyB64);
      await db
        .prepare('UPDATE line_accounts SET channel_access_token = ? WHERE id = ?')
        .bind(encryptedToken, row.id)
        .run();
      encrypted++;
    } catch (err) {
      console.error(`[token-crypto] encrypt failed id=${row.id}:`, err);
      errors++;
    }
  }
  return {
    scanned: rows.results?.length ?? 0,
    encrypted,
    skipped,
    errors,
  };
}
