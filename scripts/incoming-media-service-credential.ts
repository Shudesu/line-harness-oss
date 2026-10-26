#!/usr/bin/env tsx
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const CREDENTIAL_ID = /^[0-9a-f]{32}$/;
const SECRET = /^[0-9a-f]{64}$/;
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export type CredentialInput = {
  accountId: string;
  label: string;
  notBefore: string;
  expiresAt: string;
  createdAt: string;
  credentialId: string;
  secret: string;
};

export type CredentialArtifacts = Record<'credential.env' | 'apply.sql' | 'manifest.json', string>;

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizedTime(value: string, name: string): string {
  if (!ISO_8601_UTC.test(value)) {
    throw new Error(`${name} must be an ISO-8601 UTC timestamp`);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`${name} must be an ISO-8601 UTC timestamp`);
  return new Date(millis).toISOString();
}

export function buildCredentialArtifacts(input: CredentialInput): CredentialArtifacts {
  if (!SAFE_IDENTIFIER.test(input.accountId)) throw new Error('accountId must match SAFE_IDENTIFIER');
  if (!CREDENTIAL_ID.test(input.credentialId)) throw new Error('credentialId must be 32 lowercase hex');
  if (!SECRET.test(input.secret)) throw new Error('secret must be 64 lowercase hex');
  if (!input.label.trim() || input.label.length > 80 || /[\u0000-\u001f\u007f]/.test(input.label)) {
    throw new Error('label must be 1-80 characters without control characters');
  }
  const notBefore = normalizedTime(input.notBefore, 'notBefore');
  const expiresAt = normalizedTime(input.expiresAt, 'expiresAt');
  const createdAt = normalizedTime(input.createdAt, 'createdAt');
  if (notBefore >= expiresAt) throw new Error('notBefore must be earlier than expiresAt');
  if (createdAt > expiresAt) throw new Error('createdAt must not be later than expiresAt');

  const token = `lhim_v1.${input.credentialId}.${input.secret}`;
  const tokenSha256 = createHash('sha256').update(token).digest('hex');
  const applySql = [
    '-- External D1 write. Item-specific KEN approval is required before execution.',
    'INSERT INTO incoming_media_service_credentials (',
    '  id, line_account_id, scope, token_sha256, label,',
    '  not_before, expires_at, revoked_at, created_at',
    ') VALUES (',
    `  ${sqlLiteral(input.credentialId)}, ${sqlLiteral(input.accountId)}, 'incoming_media_read',`,
    `  ${sqlLiteral(tokenSha256)}, ${sqlLiteral(input.label.trim())},`,
    `  ${sqlLiteral(notBefore)}, ${sqlLiteral(expiresAt)}, NULL, ${sqlLiteral(createdAt)}`,
    ');',
  ].join('\n');
  const manifest = {
    schema_version: 1,
    issue: 5229,
    mode: 'offline-credential-plan',
    credential_id: input.credentialId,
    line_account_id: input.accountId,
    scope: 'incoming_media_read',
    token_sha256: tokenSha256,
    label: input.label.trim(),
    not_before: notBefore,
    expires_at: expiresAt,
    created_at: createdAt,
    d1_insert_count: 1,
    provider_calls: 0,
    external_write_requires: 'item-specific KEN approval',
    plaintext_location: 'credential.env only',
  };
  return {
    'credential.env': [
      '# Store this value only in the approved accounting runtime secret store.',
      `LINE_ACCOUNTING_HARNESS_MEDIA_READ_CREDENTIAL=${token}`,
      '',
    ].join('\n'),
    'apply.sql': `${applySql}\n`,
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

export function writeCredentialArtifacts(artifacts: CredentialArtifacts, outputDir: string): void {
  const target = resolve(outputDir);
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('output directory must be a real directory');
    if ((stat.mode & 0o777) !== 0o700) throw new Error('existing output directory must have mode 0700');
    if (readdirSync(target).length !== 0) throw new Error('output directory must not already contain files');
  } else {
    mkdirSync(target, { recursive: false, mode: 0o700 });
    chmodSync(target, 0o700);
  }
  for (const [name, body] of Object.entries(artifacts)) {
    const path = resolve(target, name);
    writeFileSync(path, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(path, 0o600);
  }
}

function requiredArg(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function main(args: string[]): void {
  const credentialId = randomBytes(16).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const artifacts = buildCredentialArtifacts({
    accountId: requiredArg(args, '--account-id'),
    label: requiredArg(args, '--label'),
    notBefore: requiredArg(args, '--not-before'),
    expiresAt: requiredArg(args, '--expires-at'),
    createdAt: new Date().toISOString(),
    credentialId,
    secret,
  });
  const outputDir = requiredArg(args, '--output-dir');
  writeCredentialArtifacts(artifacts, outputDir);
  process.stdout.write(
    `Prepared offline #5229 credential artifacts for id ${credentialId}. Provider calls: 0.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'credential planning failed'}\n`);
    process.exitCode = 1;
  }
}
